import type { SupabaseClient } from '@supabase/supabase-js'
import { conversationAnalyzer } from '../core/shared-analyzer'
import { SkillTracker, type SkillEvaluation } from '../core/skill-tracker'
import type { InterviewContext, AnalysisResult, ConversationMessage } from '../core/types'
import { formatMessage, getAiSuggestionMessages, type SupportedLocale } from './messages'
import {
  normalizeFollowUpQuestions,
  selectTopQuestions,
  buildSkillGapQuestions,
  type SuggestedQuestionMeta,
} from './question-selection'

export interface AISuggestion {
  type: 'follow_up' | 'skill_probe' | 'topic_switch' | 'warning' | 'summary'
  priority: 'high' | 'medium' | 'low'
  title: string
  content: string
  suggestedQuestions?: string[]
  suggestedQuestionMeta?: SuggestedQuestionMeta[]
  relatedSkills?: string[]
}

export class AISuggestionAdapter {
  private skillTracker: SkillTracker
  private hasLoadedSkillState = false

  constructor(
    requiredSkills: string[],
    aiInterviewId: string,
    private supabaseClient: SupabaseClient
  ) {
    this.aiInterviewId = aiInterviewId
    this.skillTracker = new SkillTracker('assisted_video', async (skill, evaluation) => {
      await this.persistSkillEvaluation(aiInterviewId, skill, evaluation)
    })

    if (requiredSkills.length > 0) {
      // pre-warm context on initialization
      this.skillTracker.buildContext(requiredSkills)
    }
  }

  private aiInterviewId: string

  private async loadPersistedSkillState(): Promise<void> {
    if (this.hasLoadedSkillState) return
    this.hasLoadedSkillState = true

    try {
      const { data, error } = await this.supabaseClient
        .from('skill_evaluation_progress')
        .select('skill_name, evaluation_quality, evaluated_at, offset_seconds, evaluated')
        .eq('ai_interview_id', this.aiInterviewId)
        .eq('evaluated', true)
        .limit(200)

      if (error || !data) return

      const state: Record<string, SkillEvaluation> = {}
      for (const row of data as unknown as Array<{
        skill_name?: unknown
        evaluation_quality?: unknown
        evaluated_at?: unknown
        offset_seconds?: unknown
        evaluated?: unknown
      }>) {
        const skill = typeof row.skill_name === 'string' ? row.skill_name.trim() : ''
        if (!skill) continue

        const quality = row.evaluation_quality === 'deep' ? 'deep' : 'shallow'
        const timestamp = typeof row.evaluated_at === 'string' && row.evaluated_at ? row.evaluated_at : new Date().toISOString()
        const offsetSeconds = typeof row.offset_seconds === 'number' && Number.isFinite(row.offset_seconds) ? row.offset_seconds : undefined

        state[skill] = { quality, timestamp, ...(offsetSeconds !== undefined ? { offsetSeconds } : {}) }
      }

      if (Object.keys(state).length > 0) {
        this.skillTracker.restoreState(state)
      }
    } catch (err) {
      // ignore skill state load errors (best effort)
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
    await this.loadPersistedSkillState()

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

    const analysisWindowMessages = 8
    const analysis = await conversationAnalyzer.quickAnalyze(context, analysisWindowMessages)

    for (const skill of analysis.skillsCoverage.discussedSkills) {
      await this.skillTracker.markSkillEvaluated(skill, {
        quality: analysis.quality.score >= 7 ? 'deep' : 'shallow',
        timestamp: new Date().toISOString(),
      })
    }

    const recentWindow = context.conversation.history.slice(-analysisWindowMessages)
    const recentCandidateChars = recentWindow
      .filter((m) => m.speaker === 'candidate')
      .map((m) => m.text.trim())
      .filter(Boolean)
      .join(' ')
      .length

    return this.convertToSuggestions(analysis, params.language, {
      recentCandidateChars,
    })
  }

  private convertToSuggestions(
    analysis: AnalysisResult,
    language: SupportedLocale,
    signals?: {
      recentCandidateChars?: number
    }
  ): AISuggestion[] {
    const suggestions: AISuggestion[] = []
    const l = getAiSuggestionMessages(language)

    const followUpMeta = selectTopQuestions(
      normalizeFollowUpQuestions(
        analysis.suggestedActions.followUpQuestionsDetailed,
        analysis.suggestedActions.followUpQuestions
      ),
      2
    )

    if (followUpMeta.length > 0) {
      suggestions.push({
        type: 'follow_up',
        priority: 'high',
        title: l.followUp,
        content: l.followUpContent,
        suggestedQuestions: followUpMeta.map((q) => q.text),
        suggestedQuestionMeta: followUpMeta,
        relatedSkills: analysis.skillsCoverage.discussedSkills,
      })
      return suggestions
    }

    if (analysis.skillsCoverage.missingSkills.length > 0) {
      const skillsSeparator = language === 'zh' ? '、' : ', '
      const limitedMissingSkills = analysis.skillsCoverage.missingSkills.slice(0, 2)
      const skillMeta = buildSkillGapQuestions(
        limitedMissingSkills,
        1,
        (skill) => formatMessage(l.tellAboutSkill, { skill })
      )

      if (skillMeta.length > 0) {
        suggestions.push({
          type: 'skill_probe',
          priority: 'medium',
          title: l.skillsAlert,
          content: formatMessage(l.skillsNotEvaluated, { skills: limitedMissingSkills.join(skillsSeparator) }),
          suggestedQuestions: skillMeta.map((q) => q.text),
          suggestedQuestionMeta: skillMeta,
          relatedSkills: limitedMissingSkills,
        })
        return suggestions
      }
    }

    if (analysis.suggestedActions.nextTopic) {
      suggestions.push({
        type: 'topic_switch',
        priority: 'medium',
        title: l.topicSwitch,
        content: formatMessage(l.letsTalkAbout, { topic: analysis.suggestedActions.nextTopic }),
        relatedSkills: [],
      })
      return suggestions
    }

    if (analysis.quality.score <= 3) {
      // 避免 ASR 碎片/信息不足导致的“低质量”刷屏：候选人内容太少时不给 warning
      const candidateChars = signals?.recentCandidateChars ?? 0
      if (candidateChars < 30) return suggestions

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
