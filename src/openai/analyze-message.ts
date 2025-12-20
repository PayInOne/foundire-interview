import { openai } from './core'

export interface AnalyzeMessageResult {
  isQuestion: boolean
  questionType: 'simple' | 'complex' | 'none'
  isOffTopic: boolean
  relevanceScore: number
  reasoning: string
}

export async function analyzeCandidateMessage(params: {
  message: string
  currentTopic: string
  language?: string
}): Promise<AnalyzeMessageResult> {
  const { message, currentTopic, language = 'en' } = params

  const systemPrompts: Record<string, string> = {
    zh: `你是一个智能面试助手，负责分析候选人的消息。

任务:
1. 检测消息是否是候选人的提问（不是修辞或填充语）
2. 检测消息是否答非所问（与当前话题无关）

当前话题: "${currentTopic}"

返回 JSON 对象:
{
  "isQuestion": boolean,
  "questionType": "simple" | "complex" | "none",
  "isOffTopic": boolean,
  "relevanceScore": number (0-10，10表示高度相关),
  "reasoning": string
}

准则:
- isQuestion: 候选人在询问信息/澄清时为 true
- questionType: "simple" 可从职位描述回答，"complex" 需要HR/详细讨论
- isOffTopic: 回答明显与当前话题无关时为 true (relevanceScore < 4)
- relevanceScore: 消息与"${currentTopic}"的相关度

示例:
- "工资范围是多少？" → question: true, type: complex, relevance: 取决于话题
- "我不知道" → question: false, relevance: low
- "我之前的工作中..." (话题是经验) → question: false, relevance: high
- "能介绍下团队文化吗" → question: true, type: complex`,
    es: `Eres un asistente de entrevistas inteligente que analiza los mensajes de los candidatos.

Tu tarea:
1. Detectar si el mensaje es una PREGUNTA del candidato (no solo retórica o relleno)
2. Detectar si el mensaje está FUERA DE TEMA respecto al tema actual de la entrevista

Tema actual: "${currentTopic}"

Devuelve un objeto JSON con:
{
  "isQuestion": boolean,
  "questionType": "simple" | "complex" | "none",
  "isOffTopic": boolean,
  "relevanceScore": number (0-10, donde 10 es altamente relevante),
  "reasoning": string
}

Directrices:
- isQuestion: true si el candidato está pidiendo información/aclaración
- questionType: "simple" si se puede responder con la descripción del puesto, "complex" si requiere discusión detallada
- isOffTopic: true si la respuesta claramente no está relacionada con el tema actual (relevanceScore < 4)
- relevanceScore: ¿Qué tan relevante es el mensaje para "${currentTopic}"?`,
    fr: `Vous êtes un assistant d'entretien intelligent qui analyse les messages des candidats.

Votre tâche :
1. Détecter si le message est une QUESTION du candidat (pas juste rhétorique ou de remplissage)
2. Détecter si le message est HORS SUJET par rapport au sujet actuel de l'entretien

Sujet actuel : "${currentTopic}"

Retournez un objet JSON avec :
{
  "isQuestion": boolean,
  "questionType": "simple" | "complex" | "none",
  "isOffTopic": boolean,
  "relevanceScore": number (0-10, où 10 est très pertinent),
  "reasoning": string
}

Directives :
- isQuestion : true si le candidat demande des informations/clarifications
- questionType : "simple" si répondable à partir de la description du poste, "complex" si nécessite une discussion détaillée
- isOffTopic : true si la réponse n'est clairement pas liée au sujet actuel (relevanceScore < 4)
- relevanceScore : Quelle est la pertinence du message par rapport à "${currentTopic}" ?`,
    en: `You are an intelligent interview assistant that analyzes candidate messages.

Your task:
1. Detect if the message is a QUESTION from the candidate (not just rhetorical or filler)
2. Detect if the message is OFF-TOPIC relative to the current interview topic

Current Topic: "${currentTopic}"

Return a JSON object with:
{
  "isQuestion": boolean,
  "questionType": "simple" | "complex" | "none",
  "isOffTopic": boolean,
  "relevanceScore": number (0-10, where 10 is highly relevant),
  "reasoning": string
}

Guidelines:
- isQuestion: true if candidate is asking for information/clarification
- questionType: "simple" if answerable from job description, "complex" if requires HR/detailed discussion
- isOffTopic: true if answer is clearly unrelated to current topic (relevanceScore < 4)
- relevanceScore: How relevant is the message to "${currentTopic}"?

Examples:
- "What's the salary range?" → question: true, type: complex, relevance: depends on topic
- "I don't know" → question: false, relevance: low
- "In my previous role..." (when topic is about experience) → question: false, relevance: high
- "Tell me about the team culture" → question: true, type: complex`,
  }

  const systemPrompt = systemPrompts[language] || systemPrompts.en

  const response = await openai.responses.create({
    model: 'gpt-5.2',
    instructions: systemPrompt,
    input: `Analyze this message:\n\n"${message}"\n\nPlease respond in JSON format.`,
    text: {
      format: { type: 'json_object' },
    },
    max_output_tokens: 300,
  })

  const analysisText = response.output_text
  if (!analysisText) {
    throw new Error('Empty response from GPT')
  }

  const analysis = JSON.parse(analysisText) as Partial<AnalyzeMessageResult>

  return {
    isQuestion: Boolean(analysis.isQuestion),
    questionType: analysis.questionType && ['simple', 'complex', 'none'].includes(analysis.questionType)
      ? analysis.questionType
      : 'none',
    isOffTopic: Boolean(analysis.isOffTopic),
    relevanceScore: Math.max(0, Math.min(10, Number(analysis.relevanceScore) || 0)),
    reasoning: typeof analysis.reasoning === 'string' ? analysis.reasoning : '',
  }
}

