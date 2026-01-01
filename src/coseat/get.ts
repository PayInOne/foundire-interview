import { createAdminClient } from '../supabase/admin'
import { normalizeInterviewDurationMinutes } from '../interviews/constants'

export type CoseatGetResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 401 | 403 | 404 | 500; body: Record<string, unknown> }

export async function handleGetCoseatInterview(coseatInterviewId: string, userId: string): Promise<CoseatGetResponse> {
  try {
    if (!userId) {
      return { status: 401, body: { success: false, error: 'Unauthorized' } }
    }

    const adminSupabase = createAdminClient()

    const { data: coseatInterview, error: fetchError } = await adminSupabase
      .from('coseat_interviews')
      .select(
        `
        id,
        interview_id,
        company_id,
        interviewer_id,
        candidate_id,
        job_id,
        session_status,
        started_at,
        ended_at,
        ai_enabled,
        transcript_count,
        interview:interviews(
          interview_duration,
          recording_enabled
        ),
        candidate:candidates(
          id,
          name,
          email,
          phone
        ),
        job:jobs(
          id,
          title,
          department,
          requirements
        )
      `
      )
      .eq('id', coseatInterviewId)
      .single()

    if (fetchError || !coseatInterview) {
      return { status: 404, body: { success: false, error: 'CoSeat interview not found' } }
    }

    const record = coseatInterview as unknown as {
      id: string
      interview_id: string
      interviewer_id: string
      session_status: string | null
      started_at: string | null
      ai_enabled: boolean | null
      transcript_count: number | null
      interview:
        | { interview_duration: number; recording_enabled?: boolean | null }
        | { interview_duration: number; recording_enabled?: boolean | null }[]
        | null
      candidate:
        | { id: string; name: string; email: string; phone: string | null }
        | { id: string; name: string; email: string; phone: string | null }[]
        | null
      job:
        | { id: string; title: string; department: string | null; requirements: string | null }
        | { id: string; title: string; department: string | null; requirements: string | null }[]
        | null
    }

    if (record.interviewer_id !== userId) {
      return { status: 403, body: { success: false, error: 'Access denied' } }
    }

    const interview = Array.isArray(record.interview) ? record.interview[0] ?? null : record.interview
    const candidate = Array.isArray(record.candidate) ? record.candidate[0] ?? null : record.candidate
    const job = Array.isArray(record.job) ? record.job[0] ?? null : record.job

    if (!candidate || !job) {
      return { status: 500, body: { success: false, error: 'CoSeat interview relations are missing' } }
    }

    return {
      status: 200,
      body: {
        success: true,
        data: {
          id: record.id,
          interviewId: record.interview_id,
          sessionStatus: record.session_status ?? 'pending',
          startedAt: record.started_at ?? new Date().toISOString(),
          aiEnabled: record.ai_enabled ?? true,
          transcriptCount: record.transcript_count ?? 0,
          interviewDuration: normalizeInterviewDurationMinutes(interview?.interview_duration),
          recordingEnabled: interview?.recording_enabled ?? true,
          candidate: {
            id: candidate.id,
            name: candidate.name,
            email: candidate.email,
            ...(candidate.phone ? { phone: candidate.phone } : {}),
          },
          job: {
            id: job.id,
            title: job.title,
            ...(job.department ? { department: job.department } : {}),
            ...(job.requirements ? { requirements: job.requirements } : {}),
          },
        },
      },
    }
  } catch (error) {
    console.error('Error in GET /internal/coseat/[id]:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}
