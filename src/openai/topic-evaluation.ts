import { openai } from './core'
import { normalizeLocale, type SupportedLocale } from './i18n'

export interface ConversationMessage {
  speaker: 'ai' | 'candidate' | 'interviewer' | string
  text: string
  timestamp?: string
}

export interface TopicEvaluation {
  score: number
  depth: 'superficial' | 'moderate' | 'deep'
  strengths: string[]
  concerns: string[]
  shouldIncreaseDifficulty: boolean
  summary: string
}

type TopicEvaluationI18n = Record<
  SupportedLocale,
  {
    labels: {
      interviewer: string
      candidate: string
    }
    systemPrompt: string
    userPrompt: (topic: string, conversationText: string) => string
  }
>

const TOPIC_EVALUATION_I18N: TopicEvaluationI18n = {
  en: {
    labels: {
      interviewer: 'Interviewer',
      candidate: 'Candidate',
    },
    systemPrompt: `You are an expert interview evaluator. Assess the candidate's performance on a specific topic.

Evaluation criteria:
1. Depth: Are answers thorough, specific, with real examples?
2. Technical accuracy: Are technical details correct?
3. Communication: Is expression clear and logical?
4. Experience validation: Does the candidate demonstrate real work experience?

Output JSON format with the following fields:
- score: 1-10 rating
- depth: "superficial" | "moderate" | "deep"
- strengths: List of strengths (max 3)
- concerns: List of concerns (max 3)
- shouldIncreaseDifficulty: true/false
- summary: Brief summary (1-2 sentences)`,
    userPrompt: (topic, conversationText) => `Evaluate the candidate's performance on the topic "${topic}".

Conversation:
${conversationText}

Provide your evaluation in JSON format.`,
  },
  zh: {
    labels: {
      interviewer: '面试官',
      candidate: '候选人',
    },
    systemPrompt: `你是一位资深的面试评估专家。请评估候选人在特定话题的表现。

评估标准：
1. 深度：回答是否深入、具体，有实际案例
2. 技术准确性：技术细节是否准确
3. 沟通能力：表达是否清晰、逻辑性强
4. 经验验证：是否展示了真实的工作经验

输出 JSON 格式，包含以下字段：
- score: 1-10 的评分
- depth: "superficial" | "moderate" | "deep"
- strengths: 优点列表（最多 3 个）
- concerns: 疑虑列表（最多 3 个）
- shouldIncreaseDifficulty: true/false（是否应增加难度）
- summary: 简短总结（1-2 句话）`,
    userPrompt: (topic, conversationText) => `请评估候选人在话题 "${topic}" 的表现。

对话内容：
${conversationText}

请提供 JSON 格式的评估结果。`,
  },
  es: {
    labels: {
      interviewer: 'Entrevistador',
      candidate: 'Candidato',
    },
    systemPrompt: `Eres un evaluador de entrevistas experto. Evalúa el desempeño del candidato en un tema específico.

Criterios de evaluación:
1. Profundidad: ¿Las respuestas son completas, específicas, con ejemplos reales?
2. Precisión técnica: ¿Los detalles técnicos son correctos?
3. Comunicación: ¿La expresión es clara y lógica?
4. Validación de experiencia: ¿El candidato demuestra experiencia laboral real?

Formato de salida JSON con los siguientes campos:
- score: puntuación de 1-10
- depth: "superficial" | "moderate" | "deep"
- strengths: Lista de fortalezas (máx. 3)
- concerns: Lista de preocupaciones (máx. 3)
- shouldIncreaseDifficulty: true/false
- summary: Resumen breve (1-2 oraciones)`,
    userPrompt: (topic, conversationText) => `Evalúa el desempeño del candidato en el tema "${topic}".

Conversación:
${conversationText}

Proporciona tu evaluación en formato JSON.`,
  },
  fr: {
    labels: {
      interviewer: 'Recruteur',
      candidate: 'Candidat',
    },
    systemPrompt: `Vous êtes un évaluateur d'entretiens expert. Évaluez la performance du candidat sur un sujet spécifique.

Critères d'évaluation :
1. Profondeur : Les réponses sont-elles complètes, spécifiques, avec des exemples concrets ?
2. Précision technique : Les détails techniques sont-ils corrects ?
3. Communication : L'expression est-elle claire et logique ?
4. Validation de l'expérience : Le candidat démontre-t-il une expérience professionnelle réelle ?

Format de sortie JSON avec les champs suivants :
- score : note de 1 à 10
- depth : "superficial" | "moderate" | "deep"
- strengths : Liste des points forts (max 3)
- concerns : Liste des préoccupations (max 3)
- shouldIncreaseDifficulty : true/false
- summary : Résumé bref (1-2 phrases)`,
    userPrompt: (topic, conversationText) => `Évaluez la performance du candidat sur le sujet "${topic}".

Conversation :
${conversationText}

Fournissez votre évaluation au format JSON.`,
  },
}

export async function evaluateTopicPerformance(params: {
  topic: string
  conversation: ConversationMessage[]
  language?: string
}): Promise<TopicEvaluation> {
  const { topic, conversation, language = 'en' } = params

  if (!topic) {
    throw new Error('Topic is required for evaluation')
  }

  if (!conversation || conversation.length === 0) {
    throw new Error('Conversation messages are required for evaluation')
  }

  const normalizedLocale = normalizeLocale(language)
  const i18n = TOPIC_EVALUATION_I18N[normalizedLocale]

  const conversationText = conversation
    .map((message) => {
      const speaker = typeof message.speaker === 'string' ? message.speaker : 'candidate'
      const isInterviewer = speaker === 'ai' || speaker === 'interviewer' || speaker.startsWith('interviewer_')
      const speakerLabel = isInterviewer ? i18n.labels.interviewer : i18n.labels.candidate
      return `${speakerLabel}: ${message.text}`
    })
    .join('\n\n')

  const response = await openai.responses.create({
    model: 'gpt-5.2',
    instructions: i18n.systemPrompt,
    input: i18n.userPrompt(topic, conversationText) + '\n\nPlease respond in JSON format.',
    text: {
      format: { type: 'json_object' },
    },
  })

  const evaluationText = response.output_text
  if (!evaluationText) {
    throw new Error('No evaluation response from GPT')
  }

  const parsed = JSON.parse(evaluationText) as Partial<TopicEvaluation>

  return {
    score: Math.max(1, Math.min(10, parsed.score ?? 5)),
    depth: parsed.depth && ['superficial', 'moderate', 'deep'].includes(parsed.depth)
      ? parsed.depth
      : 'moderate',
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 3).filter((s): s is string => typeof s === 'string') : [],
    concerns: Array.isArray(parsed.concerns) ? parsed.concerns.slice(0, 3).filter((s): s is string => typeof s === 'string') : [],
    shouldIncreaseDifficulty: Boolean(parsed.shouldIncreaseDifficulty),
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
  }
}

