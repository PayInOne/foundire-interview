import { conversationAnalyzer } from '../core/shared-analyzer'
import { SkillTracker } from '../core/skill-tracker'
import { buildConversationPrompt } from '../core/prompt-builder'
import type { InterviewContext, DigitalHumanOutput, ConversationMessage, AnalysisResult } from '../core/types'
import { openai } from '../../openai/core'

export class DigitalHumanConversationAdapter {
  private skillTracker: SkillTracker

  constructor() {
    this.skillTracker = new SkillTracker('ai_dialogue')
  }

  async handleUserMessage(params: {
    interviewId: string
    userMessage: string
    currentTopic: string
    topicsCovered: string[]
    conversationHistory: ConversationMessage[]
    isScreenSharing: boolean
    remainingMinutes: number
    language: string
    jobTitle: string
    jobDescription: string
    requirements?: string
    requiredSkills: string[]
  }): Promise<DigitalHumanOutput> {
    const context: InterviewContext = {
      job: {
        title: params.jobTitle,
        description: params.jobDescription,
        requirements: params.requirements,
        requiredSkills: params.requiredSkills,
      },
      conversation: {
        history: params.conversationHistory,
        currentTopic: params.currentTopic,
        topicsCovered: params.topicsCovered,
        language: (params.language as InterviewContext['conversation']['language']) || 'en',
      },
      skills: this.skillTracker.buildContext(params.requiredSkills),
      timing: {
        remainingMinutes: params.remainingMinutes,
        durationMinutes: 30,
      },
      context: {
        isScreenSharing: params.isScreenSharing,
        interviewMode: 'ai_dialogue',
      },
    }

    const analysis = await conversationAnalyzer.quickAnalyze(context, 8)

    for (const skill of analysis.skillsCoverage.discussedSkills) {
      await this.skillTracker.markSkillEvaluated(skill, {
        quality: analysis.quality.score >= 7 ? 'deep' : 'shallow',
        timestamp: new Date().toISOString(),
      })
    }

    const conversationPrompt = buildConversationPrompt(context, analysis)

    const inputMessages = [
      ...params.conversationHistory.map((message) => ({
        role: (message.speaker === 'ai' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: message.text,
      })),
      { role: 'user' as const, content: params.userMessage },
    ]

    const response = await openai.responses.create({
      model: 'gpt-5.2',
      instructions: conversationPrompt,
      input: inputMessages,
      max_output_tokens: 500,
    })

    const aiResponse = response.output_text || "I apologize, I didn't catch that."

    const action = this.decideAction(analysis, params.topicsCovered, params.remainingMinutes)

    return {
      aiResponse,
      action,
      assessment: {
        score: analysis.quality.score,
        shouldIncreaseDifficulty: analysis.quality.shouldIncreaseDifficulty,
      },
    }
  }

  private decideAction(
    analysis: AnalysisResult,
    topicsCovered: string[],
    remainingMinutes: number
  ): DigitalHumanOutput['action'] {
    if (remainingMinutes <= 0) {
      return { type: 'end' }
    }

    if (analysis.suggestedActions.nextTopic && analysis.skillsCoverage.missingSkills.length > 0) {
      return {
        type: 'switch_topic',
        nextTopic: analysis.suggestedActions.nextTopic || analysis.skillsCoverage.missingSkills[0],
      }
    }

    if (analysis.skillsCoverage.coveragePercentage >= 90) {
      return { type: 'end' }
    }

    return { type: 'continue' }
  }

  exportState() {
    return {
      skillsState: this.skillTracker.exportState(),
    }
  }

  restoreState(state: Record<string, unknown>) {
    if (state && typeof state === 'object' && 'skillsState' in state) {
      this.skillTracker.restoreState(
        (state.skillsState as Record<string, import('../core/skill-tracker').SkillEvaluation>) || {}
      )
    }
  }
}

