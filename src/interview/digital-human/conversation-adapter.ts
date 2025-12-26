import { conversationAnalyzer } from '../core/shared-analyzer'
import { SkillTracker } from '../core/skill-tracker'
import { buildConversationPrompt } from '../core/prompt-builder'
import type { InterviewContext, DigitalHumanOutput, ConversationMessage, AnalysisResult } from '../core/types'
import { openai } from '../../openai/core'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function normalizeLocale(locale: string): InterviewContext['conversation']['language'] {
  if (locale === 'zh' || locale.startsWith('zh')) return 'zh'
  if (locale === 'es' || locale.startsWith('es')) return 'es'
  if (locale === 'fr' || locale.startsWith('fr')) return 'fr'
  return 'en'
}

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
    candidateName?: string
    candidateResumeText?: string
    conversationState?: unknown
  }): Promise<DigitalHumanOutput> {
    const restored = asRecord(params.conversationState)
    if (restored) {
      this.restoreState(restored)
    }

    const context: InterviewContext = {
      job: {
        title: params.jobTitle,
        description: params.jobDescription,
        requirements: params.requirements,
        requiredSkills: params.requiredSkills,
      },
      candidate: params.candidateResumeText
        ? {
            name: params.candidateName,
            resumeText: params.candidateResumeText,
          }
        : undefined,
      conversation: {
        history: params.conversationHistory,
        currentTopic: params.currentTopic,
        topicsCovered: params.topicsCovered,
        language: normalizeLocale(params.language),
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

    const analysisWindowMessages = 8
    const analysis = await conversationAnalyzer.quickAnalyze(context, analysisWindowMessages)

    const skillsToMark = new Set<string>(analysis.skillsCoverage.discussedSkills)
    // 当前话题可以视为已评估（深度由质量分决定），避免覆盖率永远停留在 0
    if (params.currentTopic && params.requiredSkills.includes(params.currentTopic)) {
      skillsToMark.add(params.currentTopic)
    }

    for (const skill of skillsToMark) {
      await this.skillTracker.markSkillEvaluated(skill, {
        quality: analysis.quality.score >= 7 ? 'deep' : 'shallow',
        timestamp: new Date().toISOString(),
      })
    }

    const coveragePercentage = this.skillTracker.getCoveragePercentage(params.requiredSkills)
    const missingSkills = this.skillTracker.getUnevaluatedSkills(params.requiredSkills)

    const action = this.decideAction({
      analysis,
      missingSkills,
      coveragePercentage,
      remainingMinutes: params.remainingMinutes,
    })

    const conversationPrompt = buildConversationPrompt(context, analysis, action)

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

    return {
      aiResponse,
      action,
      assessment: {
        score: analysis.quality.score,
        shouldIncreaseDifficulty: analysis.quality.shouldIncreaseDifficulty,
      },
    }
  }

  private decideAction(params: {
    analysis: AnalysisResult
    missingSkills: string[]
    coveragePercentage: number
    remainingMinutes: number
  }): DigitalHumanOutput['action'] {
    const { analysis, missingSkills, coveragePercentage, remainingMinutes } = params

    if (remainingMinutes <= 0) {
      return { type: 'end' }
    }

    if (analysis.suggestedActions.nextTopic && missingSkills.length > 0) {
      return {
        type: 'switch_topic',
        nextTopic: analysis.suggestedActions.nextTopic || missingSkills[0],
      }
    }

    if (missingSkills.length === 0 || coveragePercentage >= 90) {
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
