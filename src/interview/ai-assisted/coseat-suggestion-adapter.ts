import { conversationAnalyzer } from '../core/shared-analyzer'
import { SkillTracker } from '../core/skill-tracker'
import type { InterviewContext, AnalysisResult, ConversationMessage } from '../core/types'
import { formatMessage, getAiSuggestionMessages, type SupportedLocale } from './messages'
import type { AISuggestion } from './suggestion-adapter'

export class CoseatSuggestionAdapter {
  private skillTracker: SkillTracker

  constructor() {
    this.skillTracker = new SkillTracker('assisted_voice')
  }

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
      skills: this.skillTracker.buildContext(params.requiredSkills),
      timing: {
        remainingMinutes: 30,
        durationMinutes: 0,
      },
      context: {
        isScreenSharing: false,
        interviewMode: 'assisted_voice',
      },
    }

    const analysis = await conversationAnalyzer.quickAnalyze(context, 5)

    for (const skill of analysis.skillsCoverage.discussedSkills) {
      await this.skillTracker.markSkillEvaluated(skill, {
        quality: analysis.quality.score >= 7 ? 'deep' : 'shallow',
        timestamp: new Date().toISOString(),
      })
    }

    return this.convertToSuggestions(analysis, params.language).slice(0, 3)
  }

  private convertToSuggestions(analysis: AnalysisResult, language: SupportedLocale): AISuggestion[] {
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

