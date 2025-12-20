export type SupportedLocale = 'en' | 'zh' | 'es' | 'fr'

export function normalizeLocale(locale: string): SupportedLocale {
  if (locale.startsWith('zh')) return 'zh'
  if (locale.startsWith('es')) return 'es'
  if (locale.startsWith('fr')) return 'fr'
  return 'en'
}

export const COMMON_I18N: Record<
  SupportedLocale,
  {
    notProvided: string
    notSpecified: string
    candidate: string
    interviewer: string
    aiInterviewer: string
    question: string
    answer: string
    topic: string
    companyBackground: string
    companyName: string
    companyOverview: string
  }
> = {
  en: {
    notProvided: 'Not provided',
    notSpecified: 'Not specified',
    candidate: 'Candidate',
    interviewer: 'Interviewer',
    aiInterviewer: 'AI Interviewer',
    question: 'Q',
    answer: 'A',
    topic: 'Topic',
    companyBackground: 'Company Background',
    companyName: 'Name',
    companyOverview: 'Overview',
  },
  zh: {
    notProvided: '未提供',
    notSpecified: '未指定',
    candidate: '候选人',
    interviewer: '面试官',
    aiInterviewer: 'AI 面试官',
    question: '问题',
    answer: '回答',
    topic: '话题',
    companyBackground: '公司背景',
    companyName: '名称',
    companyOverview: '简介',
  },
  es: {
    notProvided: 'No proporcionado',
    notSpecified: 'No especificado',
    candidate: 'Candidato',
    interviewer: 'Entrevistador',
    aiInterviewer: 'Entrevistador IA',
    question: 'P',
    answer: 'R',
    topic: 'Tema',
    companyBackground: 'Información de la Empresa',
    companyName: 'Nombre',
    companyOverview: 'Descripción',
  },
  fr: {
    notProvided: 'Non fourni',
    notSpecified: 'Non spécifié',
    candidate: 'Candidat',
    interviewer: 'Recruteur',
    aiInterviewer: 'Recruteur IA',
    question: 'Q',
    answer: 'R',
    topic: 'Sujet',
    companyBackground: "Informations sur l'Entreprise",
    companyName: 'Nom',
    companyOverview: 'Présentation',
  },
}
