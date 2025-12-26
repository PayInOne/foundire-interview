import { createAdminClient } from '../supabase/admin'
import { DigitalHumanConversationAdapter } from '../interview/digital-human/conversation-adapter'
import type { ConversationMessage } from '../interview/core/types'
import { INTERVIEW_MODES, normalizeInterviewMode } from '../interview/modes'

type InterviewWithJob = {
  id: string
  status: string | null
  job_id: string
  candidate_id: string
  interview_mode: string | null
  conversation_state: unknown
  jobs: {
    title: string
    description: string
    requirements: string | null
    questions: unknown
  } | null
  candidates: {
    name: string | null
    resume_text: string | null
  } | null
}

export interface ConversationRequest {
  interviewId: string
  userMessage: string
  currentTopic: string
  topicsCovered: unknown
  conversationHistory: unknown
  isScreenSharing: boolean
  remainingMinutes: number
  language?: string
  allTopics?: unknown
}

export type ConversationResponse =
  | { status: 200; body: { success: true; aiResponse: string; action: unknown; assessment: unknown } }
  | { status: number; body: { error: string; details?: unknown } }

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function normalizeHistory(history: unknown): ConversationMessage[] {
  if (!Array.isArray(history)) return []
  const now = new Date().toISOString()

  return history
    .map((message) => {
      if (!message || typeof message !== 'object' || Array.isArray(message)) return null
      const record = message as Record<string, unknown>
      const speaker = typeof record.speaker === 'string' ? record.speaker : 'candidate'
      const text = typeof record.text === 'string' ? record.text : ''
      if (!text) return null
      const timestamp = typeof record.timestamp === 'string' && record.timestamp ? record.timestamp : now
      const topicTag = typeof record.topicTag === 'string' ? record.topicTag : undefined
      return { speaker, text, timestamp, ...(topicTag ? { topicTag } : {}) }
    })
    .filter((m): m is ConversationMessage => m !== null)
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
}

function extractTopicList(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const topics: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim()
      if (trimmed) topics.push(trimmed)
      continue
    }

    const record = asRecord(entry)
    if (!record) continue

    const topic = typeof record.topic === 'string' ? record.topic : null
    const skill = typeof record.skill === 'string' ? record.skill : null
    const question = typeof record.question === 'string' ? record.question : null
    const title = typeof record.title === 'string' ? record.title : null

    const candidate = (topic || skill || question || title || '').trim()
    if (candidate) topics.push(candidate)
  }

  return Array.from(new Set(topics)).slice(0, 30)
}

export async function handleConversation(request: ConversationRequest): Promise<ConversationResponse> {
  const supabase = createAdminClient()

  const { data: interview, error: interviewError } = await supabase
    .from('interviews')
    .select(
      `
        id,
        status,
        job_id,
        candidate_id,
        interview_mode,
        conversation_state,
        jobs!job_id (
          title,
          description,
          requirements,
          questions
        ),
        candidates!candidate_id (
          name,
          resume_text
        )
      `
    )
    .eq('id', request.interviewId)
    .single()

  if (interviewError || !interview) {
    return { status: 404, body: { error: 'Interview not found or not active', details: interviewError?.message } }
  }

  const interviewData = interview as unknown as InterviewWithJob

  const interviewStatus = interviewData.status as string | null
  if (interviewStatus === 'paused') {
    return { status: 423, body: { error: 'Interview is paused' } }
  }

  if (interviewStatus !== 'in-progress') {
    return { status: 400, body: { error: 'Interview is not active' } }
  }

  if (normalizeInterviewMode(interviewData.interview_mode) !== INTERVIEW_MODES.AI_DIALOGUE) {
    return { status: 400, body: { error: 'This API is only for conversational interviews' } }
  }

  if (!interviewData.jobs) {
    return { status: 404, body: { error: 'Job not found for interview' } }
  }

  const job = interviewData.jobs
  const jobTopics = extractTopicList(job.questions)

  const conversationHistory = normalizeHistory(request.conversationHistory)
  const topicsCovered = normalizeStringArray(request.topicsCovered)

  const allTopics = Array.isArray(request.allTopics) && request.allTopics.length > 0
    ? normalizeStringArray(request.allTopics)
    : jobTopics

  const requestedLanguage = typeof request.language === 'string' ? request.language : undefined
  const language = requestedLanguage || (conversationHistory.length > 0 && /[\u4e00-\u9fa5]/.test(conversationHistory[0].text) ? 'zh' : 'en')

  const requiredSkills = allTopics.length > 0 ? allTopics : ['General Technical Skills']

  const adapter = new DigitalHumanConversationAdapter()
  const candidateName = interviewData.candidates?.name ?? undefined
  const candidateResumeText = interviewData.candidates?.resume_text ?? undefined

  const result = await adapter.handleUserMessage({
    interviewId: request.interviewId,
    userMessage: request.userMessage,
    currentTopic: request.currentTopic,
    topicsCovered,
    conversationHistory,
    isScreenSharing: Boolean(request.isScreenSharing),
    remainingMinutes: Number.isFinite(request.remainingMinutes) ? request.remainingMinutes : 0,
    language,
    jobTitle: job.title,
    jobDescription: job.description,
    requirements: job.requirements ?? undefined,
    requiredSkills,
    candidateName,
    candidateResumeText,
    conversationState: interviewData.conversation_state,
  })

  // 持久化技能覆盖状态（skillsState）到 conversation_state，避免每次请求都从零开始
  try {
    const existingState = asRecord(interviewData.conversation_state) ?? {}
    const mergedState = {
      ...existingState,
      ...adapter.exportState(),
      lastUpdated: new Date().toISOString(),
    }

    await supabase
      .from('interviews')
      .update({ conversation_state: mergedState })
      .eq('id', request.interviewId)
  } catch (error) {
    console.error('Failed to persist conversation_state skillsState:', error)
  }

  return {
    status: 200,
    body: {
      success: true,
      aiResponse: result.aiResponse,
      action: result.action,
      assessment: result.assessment
        ? {
            ...result.assessment,
            currentTopicScore: result.assessment.score,
          }
        : null,
    },
  }
}
