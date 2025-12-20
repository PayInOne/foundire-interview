import { createAdminClient } from '../supabase/admin'
import { coseatSuggestionAdapter } from '../interview/ai-assisted/coseat-suggestion-adapter'
import type { ConversationMessage } from '../interview/core/types'
import { asRecord, getOptionalString, getString } from '../utils/parse'

interface AISuggestion {
  id: string
  type: string
  title: string
  content: string
  priority: string
  suggestedQuestions?: string[]
  relatedSkills?: string[]
  created_at: string
  is_read: boolean
}

type SupportedLocale = 'en' | 'zh' | 'es' | 'fr'

function normalizeLocale(locale: string): SupportedLocale {
  if (locale.startsWith('zh')) return 'zh'
  if (locale.startsWith('es')) return 'es'
  if (locale.startsWith('fr')) return 'fr'
  return 'en'
}

const priorityToString: Record<number, string> = {
  1: 'high',
  2: 'medium',
  3: 'low',
}

const priorityToNumber: Record<string, number> = {
  high: 1,
  medium: 2,
  low: 3,
}

const typeMap: Record<string, string> = {
  follow_up: 'follow_up_question',
  skill_probe: 'skill_coverage',
  topic_switch: 'skill_coverage',
  warning: 'red_flag',
  insight: 'insight',
}

const typeMapReverse: Record<string, string> = {
  follow_up_question: 'follow_up',
  skill_coverage: 'skill_probe',
  red_flag: 'warning',
  answer_quality: 'insight',
  insight: 'insight',
}

export type CoseatSuggestionsGetResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 500; body: Record<string, unknown> }

export async function handleGetCoseatSuggestions(coseatInterviewId: string): Promise<CoseatSuggestionsGetResponse> {
  try {
    const adminSupabase = createAdminClient()
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    const { data, error } = await adminSupabase
      .from('ai_suggestions')
      .select('*')
      .eq('coseat_interview_id', coseatInterviewId)
      .gte('created_at', tenMinutesAgo)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('Failed to fetch suggestions:', error)
      return { status: 500, body: { success: false, error: error.message } }
    }

    const formattedData: AISuggestion[] = (data || []).map((suggestion) => {
      const content = asRecord((suggestion as { content?: unknown }).content) ?? {}
      const title = typeof content.title === 'string' ? content.title : ''
      const text = typeof content.content === 'string' ? content.content : ''
      const suggestedQuestions = Array.isArray(content.suggestedQuestions)
        ? content.suggestedQuestions.map((value) => String(value))
        : []
      const relatedSkills = Array.isArray(content.relatedSkills) ? content.relatedSkills.map((value) => String(value)) : []

      const createdAt = (suggestion as { created_at?: string | null }).created_at ?? new Date().toISOString()
      const suggestionType = (suggestion as { suggestion_type?: string | null }).suggestion_type ?? ''
      const priority = (suggestion as { priority?: number | null }).priority ?? 2
      const acknowledgedAt = (suggestion as { acknowledged_at?: string | null }).acknowledged_at ?? null

      return {
        id: (suggestion as { id: string }).id,
        created_at: createdAt,
        type: typeMapReverse[suggestionType] || suggestionType,
        priority: priorityToString[priority] || 'medium',
        title,
        content: text,
        suggestedQuestions,
        relatedSkills,
        is_read: Boolean(acknowledgedAt),
      }
    })

    return { status: 200, body: { success: true, data: formattedData } }
  } catch (error) {
    console.error('Error in GET /internal/coseat/[id]/suggestions:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

export type CoseatSuggestionsPostResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 401 | 403 | 404 | 500; body: Record<string, unknown> }

export async function handleGenerateCoseatSuggestions(
  coseatInterviewId: string,
  body: unknown
): Promise<CoseatSuggestionsPostResponse> {
  try {
    const record = asRecord(body) ?? {}
    const userId = getString(record, 'userId')
    if (!userId) {
      return { status: 401, body: { success: false, error: 'Unauthorized' } }
    }

    const localeInput = getOptionalString(record, 'locale') || 'zh'
    const normalizedLocale = normalizeLocale(localeInput)

    const adminSupabase = createAdminClient()

    const { data: coseatInterview, error: fetchError } = await adminSupabase
      .from('coseat_interviews')
      .select(
        `
        id,
        interview_id,
        interviewer_id,
        ai_enabled,
        job:jobs(
          id,
          title,
          requirements,
          description
        )
      `
      )
      .eq('id', coseatInterviewId)
      .single()

    if (fetchError || !coseatInterview) {
      console.error('Failed to fetch coseat interview:', fetchError)
      return { status: 404, body: { success: false, error: 'CoSeat interview not found' } }
    }

    const coseat = coseatInterview as unknown as {
      interview_id: string
      interviewer_id: string
      ai_enabled: boolean | null
      job: { title: string; requirements: string | null; description: string } | null
    }

    if (coseat.interviewer_id !== userId) {
      return { status: 403, body: { success: false, error: 'Access denied' } }
    }

    if (!coseat.ai_enabled) {
      return { status: 200, body: { success: true, data: [] } }
    }

    const { data: interviewData } = await adminSupabase
      .from('interviews')
      .select('transcript')
      .eq('id', coseat.interview_id)
      .single()

    const transcriptRaw = (interviewData as { transcript?: unknown } | null)?.transcript
    const transcripts = Array.isArray(transcriptRaw) ? transcriptRaw : []

    if (transcripts.length === 0) {
      return { status: 200, body: { success: true, data: [] } }
    }

    if (!coseat.job) {
      return { status: 404, body: { success: false, error: 'Job not found for CoSeat interview' } }
    }

    const conversationHistory: ConversationMessage[] = transcripts
      .map((t) => {
        const messageRecord = asRecord(t)
        if (!messageRecord) return null

        const speaker = typeof messageRecord.speaker === 'string' ? messageRecord.speaker : 'candidate'
        const text = typeof messageRecord.text === 'string' ? messageRecord.text : ''
        if (!text) return null

        const timestamp =
          typeof messageRecord.timestamp === 'string' ? messageRecord.timestamp : new Date().toISOString()

        return { speaker, text, timestamp }
      })
      .filter((t): t is ConversationMessage => t !== null)

    const suggestions = await coseatSuggestionAdapter.generateSuggestions({
      conversationHistory,
      jobTitle: coseat.job.title,
      jobDescription: coseat.job.description,
      requirements: coseat.job.requirements ?? undefined,
      requiredSkills: [],
      language: normalizedLocale,
    })

    const suggestionsToSave = suggestions.map((s) => ({
      coseat_interview_id: coseatInterviewId,
      suggestion_type: typeMap[s.type] || 'insight',
      priority: priorityToNumber[s.priority] || 2,
      content: {
        title: s.title,
        content: s.content,
        suggestedQuestions: s.suggestedQuestions || [],
        relatedSkills: s.relatedSkills || [],
      },
    }))

    if (suggestionsToSave.length > 0) {
      const { error: saveError } = await adminSupabase.from('ai_suggestions').insert(suggestionsToSave)
      if (saveError) {
        console.error('Failed to save suggestions:', saveError)
      }
    }

    await adminSupabase
      .from('coseat_interviews')
      .update({ ai_last_suggestion_at: new Date().toISOString() })
      .eq('id', coseatInterviewId)

    const now = new Date().toISOString()
    const formattedSuggestions: AISuggestion[] = suggestions.map((s, index) => ({
      id: `suggestion-${Date.now()}-${index}`,
      type: s.type,
      title: s.title,
      content: s.content,
      priority: s.priority,
      suggestedQuestions: s.suggestedQuestions,
      relatedSkills: s.relatedSkills,
      created_at: now,
      is_read: false,
    }))

    return { status: 200, body: { success: true, data: formattedSuggestions } }
  } catch (error) {
    console.error('Error in POST /internal/coseat/[id]/suggestions:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

