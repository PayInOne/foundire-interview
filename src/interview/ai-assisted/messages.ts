export type SupportedLocale = 'en' | 'zh' | 'es' | 'fr'

export interface AiSuggestionMessages {
  followUp: string
  followUpContent: string
  skillsAlert: string
  skillsNotEvaluated: string
  tellAboutSkill: string
  topicSwitch: string
  letsTalkAbout: string
  qualityLow: string
  qualityLowContent: string
  interviewSummary: string
}

const AI_SUGGESTION_MESSAGES: Record<SupportedLocale, AiSuggestionMessages> = {
  en: {
    followUp: 'Follow-up Questions',
    followUpContent: 'Candidate can elaborate more, suggest asking:',
    skillsAlert: 'Skills Coverage Alert',
    skillsNotEvaluated: 'The following skills have not been evaluated: {skills}',
    tellAboutSkill: 'Tell me about your {skill} experience',
    topicSwitch: 'Suggest Topic Switch',
    letsTalkAbout: "Let's talk about {topic}",
    qualityLow: 'Answer Quality Low',
    qualityLowContent:
      "Candidate's answer quality is low ({score}/10), consider rephrasing or asking from different angle.",
    interviewSummary: 'Interview Summary',
  },
  zh: {
    followUp: '建议追问',
    followUpContent: '候选人回答可以更深入，建议追问：',
    skillsAlert: '技能覆盖提醒',
    skillsNotEvaluated: '以下技能尚未评估：{skills}',
    tellAboutSkill: '请谈谈你的{skill}经验',
    topicSwitch: '建议切换话题',
    letsTalkAbout: '让我们聊聊{topic}',
    qualityLow: '回答质量偏低',
    qualityLowContent: '候选人回答质量较低 ({score}/10)，建议重新引导或换个角度提问。',
    interviewSummary: '面试总结',
  },
  es: {
    followUp: 'Preguntas de Seguimiento',
    followUpContent: 'El candidato puede elaborar más, sugiero preguntar:',
    skillsAlert: 'Alerta de Cobertura de Habilidades',
    skillsNotEvaluated: 'Las siguientes habilidades no han sido evaluadas: {skills}',
    tellAboutSkill: 'Cuéntame sobre tu experiencia en {skill}',
    topicSwitch: 'Sugerir Cambio de Tema',
    letsTalkAbout: 'Hablemos de {topic}',
    qualityLow: 'Calidad de Respuesta Baja',
    qualityLowContent:
      'La calidad de respuesta del candidato es baja ({score}/10), considera reformular o preguntar desde otro ángulo.',
    interviewSummary: 'Resumen de la Entrevista',
  },
  fr: {
    followUp: 'Questions de Suivi',
    followUpContent: 'Le candidat peut approfondir, suggérer de demander :',
    skillsAlert: 'Alerte de Couverture des Compétences',
    skillsNotEvaluated: "Les compétences suivantes n'ont pas été évaluées : {skills}",
    tellAboutSkill: 'Parlez-moi de votre expérience en {skill}',
    topicSwitch: 'Suggestion de Changement de Sujet',
    letsTalkAbout: 'Parlons de {topic}',
    qualityLow: 'Qualité de Réponse Faible',
    qualityLowContent:
      "La qualité de la réponse du candidat est faible ({score}/10), envisagez de reformuler ou de demander sous un autre angle.",
    interviewSummary: "Résumé de l'Entretien",
  },
}

export function normalizeLocale(locale: string): SupportedLocale {
  if (locale === 'zh' || locale.startsWith('zh')) return 'zh'
  if (locale === 'es' || locale.startsWith('es')) return 'es'
  if (locale === 'fr' || locale.startsWith('fr')) return 'fr'
  return 'en'
}

export function getAiSuggestionMessages(locale: string): AiSuggestionMessages {
  const normalized = normalizeLocale(locale)
  return AI_SUGGESTION_MESSAGES[normalized]
}

export function formatMessage(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ''))
}

