import crypto from 'node:crypto'
import { createAdminClient } from '../supabase/admin'
import { asRecord, getOptionalString } from '../utils/parse'
import { AISuggestionAdapter, type AISuggestion } from '../interview/ai-assisted/suggestion-adapter'
import type { LiveKitRegion } from '../livekit/geo-routing'
import { broadcastSuggestionsToInterviewers } from './suggestion-pusher'

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  const normalized = value
    .map((v) => normalizeText(v))
    .filter(Boolean)
    .map((v) => v.toLowerCase())
  return normalized.slice(0, limit)
}

function generateContentHash(suggestion: {
  type: string
  title: string
  content?: string
  suggestedQuestions?: string[]
  relatedSkills?: string[]
}): string {
  // Warning 类（回答质量偏低）容易刷屏：保持更强去重（只按 type + title）
  if (suggestion.type === 'warning') {
    const content = JSON.stringify({
      type: suggestion.type,
      title: suggestion.title.trim().toLowerCase(),
    })
    return crypto.createHash('md5').update(content).digest('hex')
  }

  const content = JSON.stringify({
    type: suggestion.type,
    title: suggestion.title.trim().toLowerCase(),
    content: normalizeText(suggestion.content).toLowerCase(),
    suggestedQuestions: (suggestion.suggestedQuestions ?? []).map((q) => q.trim().toLowerCase()).filter(Boolean).slice(0, 5),
    relatedSkills: (suggestion.relatedSkills ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 10),
  })
  return crypto.createHash('md5').update(content).digest('hex')
}

async function checkDuplicateSuggestion(
  supabase: ReturnType<typeof createAdminClient>,
  aiInterviewId: string,
  contentHash: string
): Promise<boolean> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  try {
    const { data, error } = await supabase
      .from('ai_suggestions')
      .select('id, created_at, suggestion_type, content, acknowledged_at')
      .eq('ai_interview_id', aiInterviewId)
      .gte('created_at', fiveMinutesAgo)
      .is('acknowledged_at', null)
      .limit(50)

    if (error || !data) {
      return false
    }

    const reverseTypeMap: Record<string, string> = {
      follow_up_question: 'follow_up',
      skill_coverage: 'skill_probe',
      red_flag: 'warning',
      insight: 'summary',
    }

    for (const existing of data) {
      const existingContent = asRecord((existing as { content?: unknown }).content) ?? {}
      const existingTitle = typeof existingContent.title === 'string' ? existingContent.title : ''
      const existingText = typeof existingContent.content === 'string' ? existingContent.content : ''
      const existingSuggestedQuestions = normalizeStringArray(existingContent.suggestedQuestions, 5)
      const existingRelatedSkills = normalizeStringArray(existingContent.relatedSkills, 10)
      const existingHash = generateContentHash({
        type: reverseTypeMap[(existing as { suggestion_type: string }).suggestion_type] || (existing as { suggestion_type: string }).suggestion_type,
        title: existingTitle,
        content: existingText,
        suggestedQuestions: existingSuggestedQuestions,
        relatedSkills: existingRelatedSkills,
      })

      if (existingHash === contentHash) {
        return true
      }
    }

    return false
  } catch (err) {
    console.error('Error checking duplicate suggestion:', err)
    return false
  }
}

export type CopilotSuggestPostResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 404 | 500; body: Record<string, unknown> }

type RawTranscriptMessage = {
  speaker: string
  text: string
  timestamp: string
  confidence?: number
}

function normalizeTranscriptMessages(transcripts: unknown[]): RawTranscriptMessage[] {
  const normalized: RawTranscriptMessage[] = []

  for (const entry of transcripts) {
    const messageRecord = asRecord(entry)
    if (!messageRecord) continue

    const speaker = typeof messageRecord.speaker === 'string' ? messageRecord.speaker : 'candidate'
    const text = typeof messageRecord.text === 'string' ? messageRecord.text.trim() : ''
    if (!text) continue

    const rawTimestamp = messageRecord.timestamp
    const timestamp = typeof rawTimestamp === 'string' && rawTimestamp ? new Date(rawTimestamp).toISOString() : new Date().toISOString()

    const confidenceRaw = messageRecord.confidence
    const confidence = typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw) ? confidenceRaw : undefined

    // 过滤明显噪声：极短且低置信度（常见于ASR断句/口头禅）
    if (confidence !== undefined && confidence < 0.35 && text.length < 20) continue
    if (text.length < 2) continue

    normalized.push({ speaker, text, timestamp, ...(confidence !== undefined ? { confidence } : {}) })
  }

  return normalized
}

function mergeConsecutiveBySpeaker(messages: RawTranscriptMessage[]): RawTranscriptMessage[] {
  const merged: RawTranscriptMessage[] = []
  for (const message of messages) {
    const last = merged[merged.length - 1]
    if (last && last.speaker === message.speaker) {
      last.text = `${last.text} ${message.text}`.trim()
      last.timestamp = message.timestamp
      last.confidence =
        last.confidence !== undefined && message.confidence !== undefined
          ? (last.confidence + message.confidence) / 2
          : (last.confidence ?? message.confidence)
      continue
    }
    merged.push({ ...message })
  }
  return merged
}

function extractRequiredSkills(questionsRaw: unknown): string[] {
  if (!Array.isArray(questionsRaw)) return []

  const skills: string[] = []
  for (const q of questionsRaw) {
    if (typeof q === 'string') {
      const trimmed = q.trim()
      if (!trimmed) continue
      const looksLikeQuestion = trimmed.endsWith('?') || trimmed.endsWith('？')
      if (!looksLikeQuestion && trimmed.length <= 32) {
        skills.push(trimmed)
      }
      continue
    }

    const questionRecord = asRecord(q)
    if (!questionRecord) continue
    const skill = questionRecord.skill
    const topic = questionRecord.topic
    const value = typeof skill === 'string' ? skill : typeof topic === 'string' ? topic : ''
    const trimmed = value.trim()
    if (trimmed) skills.push(trimmed)
  }

  // 去重 + 限制长度，避免提示词过长
  return Array.from(new Set(skills)).slice(0, 20)
}

export async function handleGenerateCopilotSuggestions(
  copilotInterviewId: string,
  body: unknown
): Promise<CopilotSuggestPostResponse> {
  try {
    const adminSupabase = createAdminClient()
    const record = asRecord(body) ?? {}

    const rawLocale = getOptionalString(record, 'locale') || 'zh'
    const supportedLocales = ['en', 'zh', 'es', 'fr'] as const
    const locale = (supportedLocales.includes(rawLocale as (typeof supportedLocales)[number]) ? rawLocale : 'en') as
      | 'en'
      | 'zh'
      | 'es'
      | 'fr'

    const { data: copilotInterview, error: copilotInterviewError } = await adminSupabase
      .from('copilot_interviews')
      .select('*, interview:interviews(*)')
      .eq('id', copilotInterviewId)
      .single()

    if (copilotInterviewError || !copilotInterview) {
      return { status: 404, body: { success: false, error: 'AI interview not found' } }
    }

    if (!(copilotInterview as { ai_enabled?: boolean | null }).ai_enabled) {
      return { status: 400, body: { success: false, error: 'AI is disabled for this interview' } }
    }

    const copilot = copilotInterview as {
      id: string
      candidate_id: string
      livekit_room_name: string | null
      livekit_region: string | null
      created_at: string | null
      interview: { id: string }
    }

    const { data: candidate, error: candidateError } = await adminSupabase
      .from('candidates')
      .select('name, resume_text, jobs!job_id(title, description, questions)')
      .eq('id', copilot.candidate_id)
      .single()

    if (candidateError || !candidate) {
      console.error('Failed to fetch candidate/job:', candidateError)
      return { status: 404, body: { success: false, error: 'Job information not found' } }
    }

    const candidateName = (candidate as { name?: string | null }).name || undefined
    const candidateResumeText = (candidate as { resume_text?: string | null }).resume_text || undefined

    const jobRaw = (candidate as { jobs?: unknown }).jobs
    const jobRecord = asRecord(jobRaw)
    if (!jobRecord) {
      return { status: 404, body: { success: false, error: 'Job information not found' } }
    }

    const jobTitle = typeof jobRecord.title === 'string' ? jobRecord.title : ''
    const jobDescription = typeof jobRecord.description === 'string' ? jobRecord.description : ''

    const questionsRaw = jobRecord.questions
    const requiredSkills = extractRequiredSkills(questionsRaw)

    const { data: interviewData } = await adminSupabase
      .from('interviews')
      .select('transcript')
      .eq('id', copilot.interview.id)
      .single()

    const transcriptRaw = (interviewData as { transcript?: unknown } | null)?.transcript
    const transcripts = Array.isArray(transcriptRaw) ? transcriptRaw : []

    const conversationHistory = mergeConsecutiveBySpeaker(normalizeTranscriptMessages(transcripts))
      .map((m) => ({ speaker: m.speaker, text: m.text, timestamp: m.timestamp }))

    const startTime = copilot.created_at ? new Date(copilot.created_at).getTime() : Date.now()
    const interviewDuration = Math.floor((Date.now() - startTime) / 60000)

    const adapter = new AISuggestionAdapter(requiredSkills, copilotInterviewId, adminSupabase)
    const suggestions = await adapter.generateSuggestions({
      conversationHistory,
      currentTopic: undefined,
      jobTitle,
      jobDescription,
      requirements: undefined,
      requiredSkills,
      interviewDurationMinutes: interviewDuration,
      language: locale,
      candidateName,
      candidateResumeText,
    })

    const priorityMap: Record<string, number> = { high: 1, medium: 2, low: 3 }
    const typeMap: Record<string, string> = {
      follow_up: 'follow_up_question',
      skill_probe: 'skill_coverage',
      topic_switch: 'skill_coverage',
      warning: 'red_flag',
      summary: 'insight',
    }

    const suggestionsToSave: Array<Record<string, unknown>> = []
    const uniqueSuggestions: AISuggestion[] = []
    let duplicateCount = 0

    for (const s of suggestions) {
      const contentHash = generateContentHash({
        type: s.type,
        title: s.title,
        content: s.content,
        suggestedQuestions: s.suggestedQuestions,
        relatedSkills: s.relatedSkills,
      })
      const isDuplicate = await checkDuplicateSuggestion(adminSupabase, copilotInterviewId, contentHash)
      if (isDuplicate) {
        duplicateCount++
        continue
      }

      suggestionsToSave.push({
        ai_interview_id: copilotInterviewId,
        suggestion_type: typeMap[s.type] || 'insight',
        priority: priorityMap[s.priority] || 2,
        content: {
          title: s.title,
          content: s.content,
          suggestedQuestions: s.suggestedQuestions || [],
          suggestedQuestionMeta: s.suggestedQuestionMeta || [],
          relatedSkills: s.relatedSkills || [],
        },
      })
      uniqueSuggestions.push(s)
    }

    if (suggestionsToSave.length > 0) {
      const { error: saveError } = await adminSupabase.from('ai_suggestions').insert(suggestionsToSave)
      if (saveError) {
        console.error('Failed to save suggestions:', saveError)
      }
    }

    // 记录最后一次生成时间（用于后续节流/分析）
    await adminSupabase
      .from('copilot_interviews')
      .update({ ai_last_suggestion_at: new Date().toISOString() })
      .eq('id', copilotInterviewId)
      .then(({ error }) => {
        if (error) console.error('Failed to update ai_last_suggestion_at:', error)
      })

    if (copilot.livekit_room_name && uniqueSuggestions.length > 0) {
      await broadcastSuggestionsToInterviewers({
        roomName: copilot.livekit_room_name,
        suggestions: uniqueSuggestions,
        region: (copilot.livekit_region as LiveKitRegion | null) ?? null,
      })
    }

    return {
      status: 200,
      body: {
        success: true,
        data: { suggestions: uniqueSuggestions, savedCount: suggestionsToSave.length, duplicateCount },
      },
    }
  } catch (error) {
    console.error('Suggest API error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

export type CopilotSuggestGetResponse =
  | { status: 200; body: { success: true; data: unknown[] } }
  | { status: 500; body: { success: false; error: string } }

export async function handleGetCopilotSuggestions(copilotInterviewId: string): Promise<CopilotSuggestGetResponse> {
  try {
    const adminSupabase = createAdminClient()
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    const { data, error } = await adminSupabase
      .from('ai_suggestions')
      .select('*')
      .eq('ai_interview_id', copilotInterviewId)
      .is('dismissed_at', null)
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: true })
      .limit(50)

    if (error) {
      return { status: 500, body: { success: false, error: error.message } }
    }

    const formattedData = (data || []).map((suggestion) => {
      const content = asRecord((suggestion as { content?: unknown }).content) ?? {}
      const title = typeof content.title === 'string' ? content.title : ''
      const text = typeof content.content === 'string' ? content.content : ''
      const suggestedQuestions = Array.isArray(content.suggestedQuestions)
        ? content.suggestedQuestions.map((value) => String(value))
        : []
      const suggestedQuestionMeta = Array.isArray(content.suggestedQuestionMeta)
        ? content.suggestedQuestionMeta
        : []
      const relatedSkills = Array.isArray(content.relatedSkills) ? content.relatedSkills.map((value) => String(value)) : []

      return {
        id: (suggestion as { id: string }).id,
        created_at: (suggestion as { created_at?: string | null }).created_at,
        type: (suggestion as { suggestion_type: string }).suggestion_type,
        priority: (suggestion as { priority?: number | null }).priority,
        title,
        content: text,
        suggestedQuestions,
        suggestedQuestionMeta,
        relatedSkills,
        is_read: Boolean((suggestion as { acknowledged_at?: string | null }).acknowledged_at),
      }
    })

    return { status: 200, body: { success: true, data: formattedData } }
  } catch (error) {
    console.error('Get suggestions error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}
