import { conversationAnalyzer } from '../core/shared-analyzer'
import { SkillTracker } from '../core/skill-tracker'
import type { InterviewContext, AnalysisResult, ConversationMessage } from '../core/types'
import { formatMessage, getAiSuggestionMessages, type SupportedLocale } from './messages'
import type { AISuggestion } from './suggestion-adapter'

export class CoseatSuggestionAdapter {
  async generateSuggestions(params: {
    conversationHistory: ConversationMessage[]
    jobTitle: string
    jobDescription: string
    requirements?: string
    requiredSkills: string[]
    language: SupportedLocale
  }): Promise<AISuggestion[]> {
    const context: InterviewContext = {
      job: {
        title: params.jobTitle,
        description: params.jobDescription,
        requirements: params.requirements,
        requiredSkills: params.requiredSkills,
      },
      conversation: {
        history: params.conversationHistory,
        currentTopic: undefined,
        topicsCovered: [],
        language: params.language,
      },
      // CoSeat 目前没有技能进度持久化：每次调用重新构建上下文，避免跨面试污染
      skills: new SkillTracker('assisted_voice').buildContext(params.requiredSkills),
      timing: {
        remainingMinutes: 30,
        durationMinutes: 0,
      },
      context: {
        isScreenSharing: false,
        interviewMode: 'assisted_voice',
      },
    }

    const analysisWindowMessages = 8
    const analysis = await conversationAnalyzer.quickAnalyze(context, analysisWindowMessages)

    const recentWindow = context.conversation.history.slice(-analysisWindowMessages)
    const recentCandidateChars = recentWindow
      .filter((m) => m.speaker === 'candidate')
      .map((m) => m.text.trim())
      .filter(Boolean)
      .join(' ')
      .length

    return this.convertToSuggestions(analysis, params.language, { recentCandidateChars }).slice(0, 3)
  }

  private convertToSuggestions(
    analysis: AnalysisResult,
    language: SupportedLocale,
    signals?: { recentCandidateChars?: number }
  ): AISuggestion[] {
    const suggestions: AISuggestion[] = []
    const l = getAiSuggestionMessages(language)

    if (analysis.suggestedActions.followUpQuestions.length > 0) {
      const limitedFollowUps = analysis.suggestedActions.followUpQuestions.slice(0, 3)
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
      const limitedMissingSkills = analysis.skillsCoverage.missingSkills.slice(0, 3)
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
}

export const coseatSuggestionAdapter = new CoseatSuggestionAdapter()
