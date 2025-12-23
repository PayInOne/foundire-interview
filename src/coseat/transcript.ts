import { createAdminClient } from '../supabase/admin'
import { asRecord, getBoolean, getNumber, getOptionalString, getString } from '../utils/parse'

type Speaker = 'interviewer' | 'candidate'

export type TranscriptMessage = {
  speaker: Speaker
  text: string
  timestamp: string
  offsetSeconds?: number
  confidence?: number
  durationMs?: number
}

export type CoseatTranscriptPostResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401 | 403 | 404 | 500; body: Record<string, unknown> }

export async function handlePostCoseatTranscript(
  coseatInterviewId: string,
  body: unknown
): Promise<CoseatTranscriptPostResponse> {
  try {
    const record = asRecord(body) ?? {}
    const userId = getString(record, 'userId')
    const speaker = getOptionalString(record, 'speaker') as Speaker | undefined
    const text = getOptionalString(record, 'text') || ''
    const merge = getBoolean(record, 'merge') ?? false
    const confidence = getNumber(record, 'confidence')
    const offsetSeconds = getNumber(record, 'offsetSeconds')
    const durationMs = getNumber(record, 'durationMs')

    if (!userId) {
      return { status: 401, body: { success: false, error: 'Unauthorized' } }
    }

    if (!speaker || !text) {
      return { status: 400, body: { success: false, error: 'speaker and text are required' } }
    }

    if (speaker !== 'interviewer' && speaker !== 'candidate') {
      return { status: 400, body: { success: false, error: 'Invalid speaker type' } }
    }

    const adminSupabase = createAdminClient()

    const { data: coseatInterview, error: fetchError } = await adminSupabase
      .from('coseat_interviews')
      .select('id, interview_id, company_id, session_status, transcript_count')
      .eq('id', coseatInterviewId)
      .single()

    if (fetchError || !coseatInterview) {
      return { status: 404, body: { success: false, error: 'CoSeat interview not found' } }
    }

    const meta = coseatInterview as unknown as {
      interview_id: string
      company_id: string
      session_status: string | null
      transcript_count: number | null
    }

    const { data: membership } = await adminSupabase
      .from('company_members')
      .select('id')
      .eq('company_id', meta.company_id)
      .eq('user_id', userId)
      .single()

    if (!membership) {
      return { status: 403, body: { success: false, error: 'Access denied' } }
    }

    if (meta.session_status !== 'active') {
      return { status: 400, body: { success: false, error: 'Session is not active' } }
    }

    const newMessage: TranscriptMessage = {
      speaker,
      text,
      timestamp: new Date().toISOString(),
      ...(offsetSeconds !== null ? { offsetSeconds } : {}),
      ...(confidence !== null ? { confidence } : {}),
      ...(durationMs !== null ? { durationMs } : {}),
    }

    const { data: appendResult, error: appendError } = await adminSupabase.rpc('append_interview_transcript', {
      p_interview_id: meta.interview_id,
      p_entry: newMessage,
      p_merge: merge,
    })

    if (appendError) {
      console.error('Error appending transcript:', appendError)
      return { status: 500, body: { success: false, error: 'Failed to save transcript' } }
    }

    const row = Array.isArray(appendResult) ? appendResult[0] : null
    const saved = (row && typeof row === 'object' && 'updated_entry' in row
      ? (row as { updated_entry: TranscriptMessage }).updated_entry
      : newMessage)
    const transcriptLength = (row && typeof row === 'object' && 'transcript_length' in row
      ? (row as { transcript_length: number }).transcript_length
      : null)

    if (typeof transcriptLength === 'number' && Number.isFinite(transcriptLength)) {
      await adminSupabase
        .from('coseat_interviews')
        .update({ transcript_count: transcriptLength })
        .eq('id', coseatInterviewId)
    }

    return { status: 200, body: { success: true, data: saved } }
  } catch (error) {
    console.error('Error in POST /internal/coseat/[id]/transcript:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

export type CoseatTranscriptGetResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 401 | 403 | 404 | 500; body: Record<string, unknown> }

export async function handleGetCoseatTranscript(
  coseatInterviewId: string,
  userId: string
): Promise<CoseatTranscriptGetResponse> {
  try {
    if (!userId) {
      return { status: 401, body: { success: false, error: 'Unauthorized' } }
    }

    const adminSupabase = createAdminClient()

    const { data: coseatInterview, error: fetchError } = await adminSupabase
      .from('coseat_interviews')
      .select('id, interview_id, company_id')
      .eq('id', coseatInterviewId)
      .single()

    if (fetchError || !coseatInterview) {
      return { status: 404, body: { success: false, error: 'CoSeat interview not found' } }
    }

    const meta = coseatInterview as unknown as { interview_id: string; company_id: string }

    const { data: membership } = await adminSupabase
      .from('company_members')
      .select('id')
      .eq('company_id', meta.company_id)
      .eq('user_id', userId)
      .single()

    if (!membership) {
      return { status: 403, body: { success: false, error: 'Access denied' } }
    }

    const { data: interview, error: interviewError } = await adminSupabase
      .from('interviews')
      .select('transcript')
      .eq('id', meta.interview_id)
      .single()

    if (interviewError) {
      console.error('Error fetching transcript:', interviewError)
      return { status: 500, body: { success: false, error: 'Failed to fetch transcript' } }
    }

    const transcript = ((interview as { transcript?: unknown } | null)?.transcript as TranscriptMessage[] | null) || []
    return { status: 200, body: { success: true, data: Array.isArray(transcript) ? transcript : [] } }
  } catch (error) {
    console.error('Error in GET /internal/coseat/[id]/transcript:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}
