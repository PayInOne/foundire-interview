import { createAdminClient } from '../supabase/admin'

export type GetInterviewResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 404 | 500; body: { error: string } }

export async function handleGetInterview(interviewId: string): Promise<GetInterviewResponse> {
  if (!interviewId) {
    return { status: 400, body: { error: 'Missing interview ID' } }
  }

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('interviews')
      .select('id, interview_mode, interview_duration, status, started_at')
      .eq('id', interviewId)
      .single()

    if (error || !data) {
      return { status: 404, body: { error: 'Interview not found' } }
    }

    return { status: 200, body: data as Record<string, unknown> }
  } catch (error) {
    console.error('Error fetching interview:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return { status: 500, body: { error: message } }
  }
}

