import type { SupabaseClient } from '@supabase/supabase-js'
import { conversationAnalyzer } from '../core/shared-analyzer'
import { SkillTracker, type SkillEvaluation } from '../core/skill-tracker'
import type { InterviewContext, AnalysisResult, ConversationMessage } from '../core/types'
import { formatMessage, getAiSuggestionMessages, type SupportedLocale } from './messages'

export interface AISuggestion {
  type: 'follow_up' | 'skill_probe' | 'topic_switch' | 'warning' | 'summary'
  priority: 'high' | 'medium' | 'low'
  title: string
  content: string
  suggestedQuestions?: string[]
  relatedSkills?: string[]
}

export class AISuggestionAdapter {
  private skillTracker: SkillTracker

  constructor(
    requiredSkills: string[],
    aiInterviewId: string,
    private supabaseClient: SupabaseClient
  ) {
    this.skillTracker = new SkillTracker('assisted_video', async (skill, evaluation) => {
      await this.persistSkillEvaluation(aiInterviewId, skill, evaluation)
    })

    if (requiredSkills.length > 0) {
      // pre-warm context on initialization
      this.skillTracker.buildContext(requiredSkills)
    }
  }

  async generateSuggestions(params: {
    conversationHistory: ConversationMessage[]
    currentTopic?: string
    jobTitle: string
    jobDescription: string
    requirements?: string
    requiredSkills: string[]
    interviewDurationMinutes: number
    language: SupportedLocale
    candidateName?: string
    candidateResumeText?: string
  }): Promise<AISuggestion[]> {
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
        topicsCovered: [],
        language: params.language,
      },
      skills: this.skillTracker.buildContext(params.requiredSkills),
      timing: {
        remainingMinutes: Math.max(0, 30 - params.interviewDurationMinutes),
        durationMinutes: params.interviewDurationMinutes,
      },
      context: {
        isScreenSharing: false,
        interviewMode: 'assisted_video',
      },
    }

    const analysis = await conversationAnalyzer.quickAnalyze(context, 5)

    for (const skill of analysis.skillsCoverage.discussedSkills) {
      await this.skillTracker.markSkillEvaluated(skill, {
        quality: analysis.quality.score >= 7 ? 'deep' : 'shallow',
        timestamp: new Date().toISOString(),
      })
    }

    return this.convertToSuggestions(analysis, params.language)
  }

  private convertToSuggestions(analysis: AnalysisResult, language: SupportedLocale): AISuggestion[] {
    const suggestions: AISuggestion[] = []
    const l = getAiSuggestionMessages(language)

    if (analysis.suggestedActions.followUpQuestions.length > 0) {
      const limitedFollowUps = analysis.suggestedActions.followUpQuestions.slice(0, 5)
      suggestions.push({
        type: 'follow_up',
        priority: 'high',
        title: l.followUp,
        content: l.followUpContent,
        suggestedQuestions: limitedFollowUps,
        relatedSkills: analysis.skillsCoverage.discussedSkills,
      })
    }

    if (analysis.skillsCoverage.missingSkills.length > 0) {
      const skillsSeparator = language === 'zh' ? '、' : ', '
      const limitedMissingSkills = analysis.skillsCoverage.missingSkills.slice(0, 5)
      suggestions.push({
        type: 'skill_probe',
        priority: 'medium',
        title: l.skillsAlert,
        content: formatMessage(l.skillsNotEvaluated, { skills: limitedMissingSkills.join(skillsSeparator) }),
        suggestedQuestions: limitedMissingSkills.map((skill) => formatMessage(l.tellAboutSkill, { skill })),
        relatedSkills: limitedMissingSkills,
      })
    }

    if (analysis.suggestedActions.nextTopic) {
      suggestions.push({
        type: 'topic_switch',
        priority: 'medium',
        title: l.topicSwitch,
        content: formatMessage(l.letsTalkAbout, { topic: analysis.suggestedActions.nextTopic }),
        suggestedQuestions: [formatMessage(l.letsTalkAbout, { topic: analysis.suggestedActions.nextTopic })],
        relatedSkills: [],
      })
    }

    if (analysis.quality.score <= 4) {
      suggestions.push({
        type: 'warning',
        priority: 'high',
        title: l.qualityLow,
        content: formatMessage(l.qualityLowContent, { score: analysis.quality.score }),
        relatedSkills: analysis.skillsCoverage.discussedSkills,
      })
    }

    return suggestions
  }

  private async persistSkillEvaluation(aiInterviewId: string, skill: string, evaluation: SkillEvaluation) {
    await this.supabaseClient.from('skill_evaluation_progress').upsert({
      ai_interview_id: aiInterviewId,
      skill_name: skill,
      evaluated: true,
      evaluation_quality: evaluation.quality,
      evaluated_at: evaluation.timestamp,
    })
  }
}

