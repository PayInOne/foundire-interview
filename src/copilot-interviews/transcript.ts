import { createAdminClient } from '../supabase/admin'
import { asRecord, getOptionalString, getString } from '../utils/parse'

type SpeakerRole = 'candidate' | 'interviewer' | 'interviewer_0' | 'interviewer_1' | 'interviewer_2'

export interface CopilotTranscriptMessage {
  speaker: SpeakerRole
  text: string
  timestamp: string
  offset_seconds?: number
  confidence?: number
  duration_ms?: number
  speaker_name?: string
}

export type CopilotTranscriptPostResponse =
  | { status: 200; body: { success: true; data: CopilotTranscriptMessage } }
  | { status: 400 | 401 | 403 | 404 | 500; body: { error: string; status?: string } }

export async function handlePostCopilotTranscript(
  copilotInterviewId: string,
  body: unknown
): Promise<CopilotTranscriptPostResponse> {
  try {
    const record = asRecord(body)
    if (!record) return { status: 400, body: { error: 'Invalid request body' } }

    const speaker = getString(record, 'speaker') as SpeakerRole | null
    const text = getString(record, 'text')
    const userId = getString(record, 'userId')

    const confidence = typeof record.confidence === 'number' ? record.confidence : undefined
    const offset_seconds = typeof record.offset_seconds === 'number' ? record.offset_seconds : undefined
    const duration_ms = typeof record.duration_ms === 'number' ? record.duration_ms : undefined
    const speaker_name = getOptionalString(record, 'speaker_name')

    if (!speaker || !text) {
      return { status: 400, body: { error: 'Missing required fields: speaker, text' } }
    }

    const validSpeakers: SpeakerRole[] = ['candidate', 'interviewer', 'interviewer_0', 'interviewer_1', 'interviewer_2']
    if (!validSpeakers.includes(speaker)) {
      return {
        status: 400,
        body: { error: 'Invalid speaker type. Must be "candidate", "interviewer", or "interviewer_0/1/2"' },
      }
    }

    if (!userId) {
      return { status: 401, body: { error: 'Unauthorized' } }
    }

    const adminSupabase = createAdminClient()

    const { data: copilotInterview, error: fetchError } = await adminSupabase
      .from('copilot_interviews')
      .select('id, interview_id, company_id, room_status')
      .eq('id', copilotInterviewId)
      .single()

    if (fetchError || !copilotInterview) {
      return { status: 404, body: { error: 'AI interview not found' } }
    }

    const interviewMeta = copilotInterview as {
      interview_id: string
      company_id: string
      room_status: string
    }

    const { data: membership } = await adminSupabase
      .from('company_members')
      .select('id')
      .eq('company_id', interviewMeta.company_id)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single()

    if (!membership) {
      return { status: 403, body: { error: 'Unauthorized: You do not have access to this interview' } }
    }

    const allowedStatuses = ['both_ready', 'in_progress']
    if (!allowedStatuses.includes(interviewMeta.room_status)) {
      return {
        status: 400,
        body: { error: `Cannot save transcript: interview is ${interviewMeta.room_status}`, status: interviewMeta.room_status },
      }
    }

    const newMessage: CopilotTranscriptMessage = {
      speaker,
      text,
      timestamp: new Date().toISOString(),
      offset_seconds,
      confidence,
      duration_ms,
      speaker_name,
    }

    const { data: appendResult, error: appendError } = await adminSupabase.rpc('append_interview_transcript', {
      p_interview_id: interviewMeta.interview_id,
      p_entry: newMessage,
      p_merge: false,
    })

    if (appendError) {
      console.error('Error appending transcript:', appendError)
      return { status: 500, body: { error: 'Failed to update transcript' } }
    }

    const row = Array.isArray(appendResult) ? appendResult[0] : null
    const saved = (row && typeof row === 'object' && 'updated_entry' in row ? (row as { updated_entry: CopilotTranscriptMessage }).updated_entry : newMessage)
    return { status: 200, body: { success: true, data: saved } }
  } catch (error) {
    console.error('Error in copilot transcript POST:', error)
    return { status: 500, body: { error: 'Internal server error' } }
  }
}

export type CopilotTranscriptGetResponse =
  | { status: 200; body: { success: true; data: CopilotTranscriptMessage[] } }
  | { status: 401 | 403 | 404 | 500; body: { error: string } }

export async function handleGetCopilotTranscript(
  copilotInterviewId: string,
  userId: string
): Promise<CopilotTranscriptGetResponse> {
  try {
    if (!userId) return { status: 401, body: { error: 'Unauthorized' } }

    const adminSupabase = createAdminClient()

    const { data: copilotInterview, error: fetchError } = await adminSupabase
      .from('copilot_interviews')
      .select('id, interview_id, company_id')
      .eq('id', copilotInterviewId)
      .single()

    if (fetchError || !copilotInterview) {
      return { status: 404, body: { error: 'AI interview not found' } }
    }

    const interviewMeta = copilotInterview as { interview_id: string; company_id: string }

    const { data: membership } = await adminSupabase
      .from('company_members')
      .select('id')
      .eq('company_id', interviewMeta.company_id)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single()

    if (!membership) {
      return { status: 403, body: { error: 'Unauthorized: You do not have access to this interview' } }
    }

    const { data: interview, error: interviewError } = await adminSupabase
      .from('interviews')
      .select('transcript')
      .eq('id', interviewMeta.interview_id)
      .single()

    if (interviewError) {
      console.error('Error fetching transcript:', interviewError)
      return { status: 500, body: { error: 'Failed to fetch transcript' } }
    }

    const transcript = ((interview as { transcript?: unknown } | null)?.transcript as CopilotTranscriptMessage[] | null) || []

    return { status: 200, body: { success: true, data: transcript } }
  } catch (error) {
    console.error('Error in copilot transcript GET:', error)
    return { status: 500, body: { error: 'Internal server error' } }
  }
}
