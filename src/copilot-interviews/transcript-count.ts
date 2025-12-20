import { createAdminClient } from '../supabase/admin'

export type CopilotTranscriptCountResponse =
  | { status: 200; body: { success: true; count: number } }
  | { status: 200; body: { success: false; count: 0 } }

export async function handleGetCopilotTranscriptCount(copilotInterviewId: string): Promise<CopilotTranscriptCountResponse> {
  try {
    const adminSupabase = createAdminClient()

    const { data: copilotInterview, error: copilotError } = await adminSupabase
      .from('copilot_interviews')
      .select('interview_id')
      .eq('id', copilotInterviewId)
      .single()

    if (copilotError || !copilotInterview) {
      return { status: 200, body: { success: false, count: 0 } }
    }

    const interviewId = (copilotInterview as { interview_id: string }).interview_id

    const { data: interviewData, error: interviewError } = await adminSupabase
      .from('interviews')
      .select('transcript')
      .eq('id', interviewId)
      .single()

    if (interviewError || !interviewData) {
      return { status: 200, body: { success: false, count: 0 } }
    }

    const transcript = (interviewData as { transcript?: unknown }).transcript
    const count = Array.isArray(transcript) ? transcript.length : 0

    return { status: 200, body: { success: true, count } }
  } catch {
    return { status: 200, body: { success: false, count: 0 } }
  }
}

