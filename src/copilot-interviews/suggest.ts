import crypto from 'node:crypto'
import { createAdminClient } from '../supabase/admin'
import { asRecord, getOptionalString } from '../utils/parse'
import { AISuggestionAdapter, type AISuggestion } from '../interview/ai-assisted/suggestion-adapter'
import type { LiveKitRegion } from '../livekit/geo-routing'
import { broadcastSuggestionsToInterviewers } from './suggestion-pusher'

function generateContentHash(suggestion: { type: string; title: string }): string {
  const content = JSON.stringify({
    type: suggestion.type,
    title: suggestion.title.trim().toLowerCase(),
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
      const existingHash = generateContentHash({
        type: reverseTypeMap[(existing as { suggestion_type: string }).suggestion_type] || (existing as { suggestion_type: string }).suggestion_type,
        title: existingTitle,
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
    const questions = Array.isArray(questionsRaw) ? questionsRaw : []
    const requiredSkills = questions
      .map((q) => {
        const questionRecord = asRecord(q)
        if (!questionRecord) return ''
        const skill = questionRecord.skill
        const topic = questionRecord.topic
        const value = typeof skill === 'string' ? skill : typeof topic === 'string' ? topic : ''
        return value.trim()
      })
      .filter(Boolean)

    const { data: interviewData } = await adminSupabase
      .from('interviews')
      .select('transcript')
      .eq('id', copilot.interview.id)
      .single()

    const transcriptRaw = (interviewData as { transcript?: unknown } | null)?.transcript
    const transcripts = Array.isArray(transcriptRaw) ? transcriptRaw : []

    const conversationHistory = transcripts
      .map((t) => {
        const messageRecord = asRecord(t)
        if (!messageRecord) return null

        const speaker = typeof messageRecord.speaker === 'string' ? messageRecord.speaker : 'candidate'
        const text = typeof messageRecord.text === 'string' ? messageRecord.text : ''
        if (!text) return null

        const rawTimestamp = messageRecord.timestamp
        const timestamp = typeof rawTimestamp === 'string' ? new Date(rawTimestamp).toISOString() : new Date().toISOString()

        return { speaker, text, timestamp }
      })
      .filter((t): t is { speaker: string; text: string; timestamp: string } => t !== null)

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
    let duplicateCount = 0

    for (const s of suggestions) {
      const contentHash = generateContentHash(s)
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
          relatedSkills: s.relatedSkills || [],
        },
      })
    }

    if (suggestionsToSave.length > 0) {
      const { error: saveError } = await adminSupabase.from('ai_suggestions').insert(suggestionsToSave)
      if (saveError) {
        console.error('Failed to save suggestions:', saveError)
      }
    }

    if (copilot.livekit_room_name) {
      await broadcastSuggestionsToInterviewers({
        roomName: copilot.livekit_room_name,
        suggestions,
        region: (copilot.livekit_region as LiveKitRegion | null) ?? null,
      })
    }

    return {
      status: 200,
      body: {
        success: true,
        data: { suggestions, savedCount: suggestionsToSave.length, duplicateCount },
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

    const { data, error } = await adminSupabase
      .from('ai_suggestions')
      .select('*')
      .eq('ai_interview_id', copilotInterviewId)
      .order('created_at', { ascending: true })
      .limit(20)

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
      const relatedSkills = Array.isArray(content.relatedSkills) ? content.relatedSkills.map((value) => String(value)) : []

      return {
        id: (suggestion as { id: string }).id,
        created_at: (suggestion as { created_at?: string | null }).created_at,
        type: (suggestion as { suggestion_type: string }).suggestion_type,
        priority: (suggestion as { priority?: number | null }).priority,
        title,
        content: text,
        suggestedQuestions,
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
