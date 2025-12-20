import type { SupportedLocale } from './i18n'

export const INTERVIEW_QUESTIONS_I18N: Record<
  SupportedLocale,
  {
    languageName: string
    labels: {
      jobDescription: string
      jobRequirements: string
      candidateResume: string
    }
    systemWithResume: string
    systemWithoutResume: string
    userPromptIntroWithResume: (jobTitle: string, count: number) => string
    userPromptIntroWithoutResume: (jobTitle: string, count: number) => string
    presetQuestionsNote: (count: number) => string
    presetQuestionsInstruction: (newCount: number, totalCount: number) => string
    presetQuestionsOrdering: string
    avoidDuplicateNote: string
    generateCountNote: (count: number) => string
    questionGuidelinesWithResume: string
    questionGuidelinesWithoutResume: string
    jsonInstruction: string
  }
> = {
  en: {
    languageName: 'English',
    labels: {
      jobDescription: 'Job Description',
      jobRequirements: 'Job Requirements',
      candidateResume: "Candidate's Resume",
    },
    systemWithResume: `You are an expert interviewer. Generate personalized interview questions based on the candidate's resume, job requirements, and company context.

Rules:
- Focus strictly on professional skills and experience.
- Be specific and verify real impact (projects, decisions, tradeoffs, metrics).
- Avoid political content (especially Chinese politics).`,
    systemWithoutResume: `You are an expert interviewer. Generate thoughtful interview questions based on the job requirements and company context.

Rules:
- Focus strictly on professional skills and experience.
- Avoid political content (especially Chinese politics).`,
    userPromptIntroWithResume: (jobTitle, count) =>
      `Based on the candidate's resume and the job requirements, generate ${count} personalized interview questions for the position of ${jobTitle}.`,
    userPromptIntroWithoutResume: (jobTitle, count) =>
      `Generate ${count} interview questions for the position of ${jobTitle}.`,
    presetQuestionsNote: (count) =>
      `IMPORTANT: The following ${count} preset interview questions MUST be included in your final question list:`,
    presetQuestionsInstruction: (newCount, totalCount) =>
      `Generate ${newCount} new questions and mix them with the preset questions to form a logical interview flow. Return a total of ${totalCount} questions. Do NOT put all preset questions together; distribute them naturally.`,
    presetQuestionsOrdering: '',
    avoidDuplicateNote:
      'IMPORTANT: The following are preset interview questions that will also be asked. Ensure your generated questions are distinct and do NOT overlap or duplicate them:',
    generateCountNote: (count) => `You need to generate ${count} new interview questions.`,
    questionGuidelinesWithResume: `Guidelines:
1. Reference specific resume projects/skills and verify depth ("how", "why", "tradeoffs", "metrics").
2. Connect past experience to the role requirements.
3. Include a mix of technical + behavioral questions.
4. Progress from warm-up to deeper questions.
5. Prefer open-ended questions that invite concrete examples.`,
    questionGuidelinesWithoutResume: `Guidelines:
1. Cover core technical skills, problem-solving, collaboration, and ownership.
2. Include a mix of technical + behavioral questions.
3. Progress from warm-up to deeper questions.
4. Prefer open-ended questions that invite concrete examples.`,
    jsonInstruction: 'Return only a JSON object with key "questions" as an array of strings.',
  },
  zh: {
    languageName: '中文',
    labels: {
      jobDescription: '岗位描述',
      jobRequirements: '岗位要求',
      candidateResume: '候选人简历',
    },
    systemWithResume: `你是一位资深面试官。请基于候选人简历、岗位要求和公司背景生成“个性化”的面试问题。

规则：
- 只关注专业能力与工作经验。
- 问题要具体，用于验证真实性与深度（项目细节、取舍、指标、影响）。
- 避免任何政治相关内容（尤其是中国政治）。`,
    systemWithoutResume: `你是一位资深面试官。请基于岗位要求和公司背景生成高质量面试问题。

规则：
- 只关注专业能力与工作经验。
- 避免任何政治相关内容（尤其是中国政治）。`,
    userPromptIntroWithResume: (jobTitle, count) =>
      `请基于候选人简历与岗位要求，为“${jobTitle}”岗位生成 ${count} 个个性化面试问题。`,
    userPromptIntroWithoutResume: (jobTitle, count) =>
      `请为“${jobTitle}”岗位生成 ${count} 个面试问题。`,
    presetQuestionsNote: (count) =>
      `重要：以下 ${count} 个预设问题必须出现在你的最终问题列表中：`,
    presetQuestionsInstruction: (newCount, totalCount) =>
      `请生成 ${newCount} 个新问题，并与预设问题“自然穿插”形成合理的面试流程。最终返回共 ${totalCount} 个问题。不要把预设问题全部堆在一起。`,
    presetQuestionsOrdering: '',
    avoidDuplicateNote:
      '重要：以下为预设问题（也会被问到）。你生成的新问题必须与其明显不同，避免重复或高度重合：',
    generateCountNote: (count) => `请生成 ${count} 个新面试问题。`,
    questionGuidelinesWithResume: `准则：
1. 结合简历中的具体项目/经历追问细节（怎么做、为什么这么做、遇到什么问题、如何权衡、效果指标）。
2. 将过往经验与岗位要求建立关联。
3. 技术题 + 行为题混合。
4. 从热身到深入逐步加难。
5. 尽量用开放式提问，引导给出具体案例。`,
    questionGuidelinesWithoutResume: `准则：
1. 覆盖核心技能、问题解决、协作与责任心。
2. 技术题 + 行为题混合。
3. 从热身到深入逐步加难。
4. 尽量用开放式提问，引导给出具体案例。`,
    jsonInstruction: '只返回 JSON 对象，key 为 "questions"，值为字符串数组。',
  },
  es: {
    languageName: 'Español',
    labels: {
      jobDescription: 'Descripción del Puesto',
      jobRequirements: 'Requisitos del Puesto',
      candidateResume: 'Currículum del Candidato',
    },
    systemWithResume: `Eres un entrevistador experto. Genera preguntas personalizadas basadas en el currículum del candidato, los requisitos del puesto y el contexto de la empresa.

Reglas:
- Enfócate solo en habilidades profesionales y experiencia laboral.
- Sé específico para validar profundidad (detalles de proyectos, decisiones, tradeoffs, métricas).
- Evita contenido político (especialmente política china).`,
    systemWithoutResume: `Eres un entrevistador experto. Genera preguntas de entrevista basadas en los requisitos del puesto y el contexto de la empresa.

Reglas:
- Enfócate solo en habilidades profesionales y experiencia laboral.
- Evita contenido político (especialmente política china).`,
    userPromptIntroWithResume: (jobTitle, count) =>
      `Basándote en el currículum del candidato y los requisitos del puesto, genera ${count} preguntas de entrevista personalizadas para el puesto de ${jobTitle}.`,
    userPromptIntroWithoutResume: (jobTitle, count) =>
      `Genera ${count} preguntas de entrevista para el puesto de ${jobTitle}.`,
    presetQuestionsNote: (count) =>
      `IMPORTANTE: Las siguientes ${count} preguntas predefinidas DEBEN incluirse en la lista final:`,
    presetQuestionsInstruction: (newCount, totalCount) =>
      `Genera ${newCount} preguntas nuevas y mézclalas con las predefinidas para crear un flujo lógico. Devuelve un total de ${totalCount} preguntas. No agrupes todas las preguntas predefinidas juntas.`,
    presetQuestionsOrdering: '',
    avoidDuplicateNote:
      'IMPORTANTE: Las siguientes son preguntas predefinidas (también se harán). Asegúrate de que tus preguntas nuevas sean distintas y no se dupliquen:',
    generateCountNote: (count) => `Necesitas generar ${count} preguntas nuevas de entrevista.`,
    questionGuidelinesWithResume: `Guías:
1. Referencia proyectos/habilidades del currículum y valida profundidad ("cómo", "por qué", tradeoffs, métricas).
2. Conecta experiencia previa con los requisitos del rol.
3. Mezcla preguntas técnicas y conductuales.
4. De fácil a más difícil.
5. Preguntas abiertas con ejemplos concretos.`,
    questionGuidelinesWithoutResume: `Guías:
1. Cubre habilidades técnicas, resolución de problemas, colaboración y ownership.
2. Mezcla preguntas técnicas y conductuales.
3. De fácil a más difícil.
4. Preguntas abiertas con ejemplos concretos.`,
    jsonInstruction: 'Devuelve solo un objeto JSON con la clave "questions" como un array de strings.',
  },
  fr: {
    languageName: 'Français',
    labels: {
      jobDescription: 'Description du Poste',
      jobRequirements: 'Exigences du Poste',
      candidateResume: 'CV du Candidat',
    },
    systemWithResume: `Vous êtes un recruteur expert. Générez des questions d'entretien personnalisées basées sur le CV du candidat, les exigences du poste et le contexte de l'entreprise.

Règles :
- Concentrez-vous uniquement sur les compétences professionnelles et l'expérience.
- Soyez précis pour valider la profondeur (détails de projets, décisions, compromis, métriques).
- Évitez tout contenu politique (en particulier la politique chinoise).`,
    systemWithoutResume: `Vous êtes un recruteur expert. Générez des questions d'entretien basées sur les exigences du poste et le contexte de l'entreprise.

Règles :
- Concentrez-vous uniquement sur les compétences professionnelles et l'expérience.
- Évitez tout contenu politique (en particulier la politique chinoise).`,
    userPromptIntroWithResume: (jobTitle, count) =>
      `À partir du CV du candidat et des exigences du poste, générez ${count} questions d'entretien personnalisées pour le poste de ${jobTitle}.`,
    userPromptIntroWithoutResume: (jobTitle, count) =>
      `Générez ${count} questions d'entretien pour le poste de ${jobTitle}.`,
    presetQuestionsNote: (count) =>
      `IMPORTANT : Les ${count} questions prédéfinies suivantes DOIVENT être incluses dans la liste finale :`,
    presetQuestionsInstruction: (newCount, totalCount) =>
      `Générez ${newCount} nouvelles questions et mélangez-les avec les questions prédéfinies pour créer un flux logique. Retournez un total de ${totalCount} questions. Ne regroupez pas toutes les questions prédéfinies ensemble.`,
    presetQuestionsOrdering: '',
    avoidDuplicateNote:
      "IMPORTANT : Les questions suivantes sont prédéfinies (elles seront aussi posées). Assurez-vous que vos nouvelles questions sont différentes et ne les dupliquent pas :",
    generateCountNote: (count) => `Vous devez générer ${count} nouvelles questions d'entretien.`,
    questionGuidelinesWithResume: `Consignes :
1. Référez-vous à des projets/compétences du CV et validez la profondeur ("comment", "pourquoi", compromis, métriques).
2. Reliez l'expérience passée aux exigences du poste.
3. Mélangez questions techniques et comportementales.
4. Du plus simple au plus difficile.
5. Questions ouvertes avec exemples concrets.`,
    questionGuidelinesWithoutResume: `Consignes :
1. Couvrez compétences techniques, résolution de problèmes, collaboration et ownership.
2. Mélangez questions techniques et comportementales.
3. Du plus simple au plus difficile.
4. Questions ouvertes avec exemples concrets.`,
    jsonInstruction: 'Retournez uniquement un objet JSON avec la clé "questions" contenant un tableau de chaînes.',
  },
}

