import { createAdminClient } from '../supabase/admin'
import { INTERVIEW_MODES } from '../interview/modes'
import {
  DEFAULT_INTERVIEW_DURATION_MINUTES,
  isAllowedInterviewDurationMinutes,
  normalizeInterviewDurationMinutes,
} from '../interviews/constants'
import { asRecord, getBoolean, getString } from '../utils/parse'

export type CoseatSchedulePostResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401 | 403 | 404 | 409 | 500; body: Record<string, unknown> }

export async function handleScheduleCoseatInterview(body: unknown): Promise<CoseatSchedulePostResponse> {
  try {
    const record = asRecord(body) ?? {}

    const candidateId = getString(record, 'candidateId')
    const jobId = getString(record, 'jobId')
    const userId = getString(record, 'userId')
    const interviewDuration = record.interviewDuration
    const recordingEnabled = getBoolean(record, 'recordingEnabled') ?? true

    if (!candidateId || !jobId) {
      return { status: 400, body: { success: false, error: 'Missing required fields' } }
    }

    if (!userId) {
      return { status: 401, body: { success: false, error: 'Unauthorized' } }
    }

    if (
      interviewDuration !== undefined &&
      interviewDuration !== null &&
      !isAllowedInterviewDurationMinutes(interviewDuration)
    ) {
      return {
        status: 400,
        body: { success: false, error: 'Interview duration must be 15, 30, 45, or 60 minutes' },
      }
    }

    const finalInterviewDuration =
      interviewDuration !== undefined && interviewDuration !== null
        ? normalizeInterviewDurationMinutes(interviewDuration)
        : DEFAULT_INTERVIEW_DURATION_MINUTES

    const adminSupabase = createAdminClient()

    const { data: candidate, error: candidateError } = await adminSupabase
      .from('candidates')
      .select('id, job_id, company_id')
      .eq('id', candidateId)
      .single()

    if (candidateError || !candidate) {
      console.error('Candidate query error:', candidateError)
      return { status: 404, body: { success: false, error: 'Candidate not found' } }
    }

    const candidateCompanyId = (candidate as { company_id: string }).company_id

    const { data: membership } = await adminSupabase
      .from('company_members')
      .select('id')
      .eq('company_id', candidateCompanyId)
      .eq('user_id', userId)
      .single()

    if (!membership) {
      return { status: 403, body: { success: false, error: 'Access denied: candidate does not belong to your company' } }
    }

    const { data: job, error: jobError } = await adminSupabase
      .from('jobs')
      .select('id, company_id')
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      console.error('Job query error:', jobError)
      return { status: 404, body: { success: false, error: 'Job not found' } }
    }

    if ((job as { company_id: string }).company_id !== candidateCompanyId) {
      return { status: 403, body: { success: false, error: 'Access denied: job does not belong to your company' } }
    }

    const { data: activeInterviews } = await adminSupabase
      .from('coseat_interviews')
      .select('id, interview_id, session_status, created_at')
      .eq('candidate_id', candidateId)
      .not('session_status', 'in', '(completed,cancelled)')
      .order('created_at', { ascending: false })
      .limit(1)

    if (activeInterviews && activeInterviews.length > 0) {
      return {
        status: 409,
        body: {
          success: false,
          error: 'Candidate already has an active CoSeat interview',
          data: activeInterviews[0],
        },
      }
    }

    const { data: interview, error: interviewError } = await adminSupabase
      .from('interviews')
      .insert({
        candidate_id: candidateId,
        job_id: jobId,
        company_id: candidateCompanyId,
        status: 'pending',
        interview_mode: INTERVIEW_MODES.ASSISTED_VOICE,
        interview_duration: finalInterviewDuration,
        recording_enabled: recordingEnabled,
      })
      .select()
      .single()

    if (interviewError || !interview) {
      console.error('Interview insert error:', interviewError)
      return { status: 500, body: { success: false, error: 'Failed to create interview record' } }
    }

    const { data: coseatInterview, error: coseatInterviewError } = await adminSupabase
      .from('coseat_interviews')
      .insert({
        interview_id: (interview as { id: string }).id,
        company_id: candidateCompanyId,
        interviewer_id: userId,
        candidate_id: candidateId,
        job_id: jobId,
        session_status: 'pending',
        ai_enabled: true,
      })
      .select()
      .single()

    if (coseatInterviewError || !coseatInterview) {
      console.error('CoSeat interview insert error:', coseatInterviewError)
      await adminSupabase.from('interviews').delete().eq('id', (interview as { id: string }).id)
      return { status: 500, body: { success: false, error: 'Failed to create CoSeat interview record' } }
    }

    await adminSupabase
      .from('candidates')
      .update({ status: 'interviewing', interview_mode: INTERVIEW_MODES.ASSISTED_VOICE })
      .eq('id', candidateId)

    return {
      status: 200,
      body: {
        success: true,
        data: {
          coseatInterviewId: (coseatInterview as { id: string }).id,
          interviewId: (interview as { id: string }).id,
          createdAt: (coseatInterview as { created_at?: string | null }).created_at ?? null,
        },
      },
    }
  } catch (error) {
    console.error('Schedule CoSeat interview error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

export type CoseatScheduleGetResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401 | 404 | 500; body: Record<string, unknown> }

export async function handleGetActiveCoseatInterview(
  candidateId: string,
  userId: string,
  includeAll: boolean = false
): Promise<CoseatScheduleGetResponse> {
  try {
    if (!candidateId) {
      return { status: 400, body: { success: false, error: 'candidateId is required' } }
    }

    if (!userId) {
      return { status: 401, body: { success: false, error: 'Unauthorized' } }
    }

    const adminSupabase = createAdminClient()

    const { data: candidate } = await adminSupabase
      .from('candidates')
      .select('id, company_id')
      .eq('id', candidateId)
      .single()

    const candidateCompanyId = (candidate as { company_id?: string | null } | null)?.company_id
    if (!candidateCompanyId) {
      return { status: 404, body: { success: false, error: 'Candidate not found or access denied' } }
    }

    const { data: membership } = await adminSupabase
      .from('company_members')
      .select('id')
      .eq('company_id', candidateCompanyId)
      .eq('user_id', userId)
      .single()

    if (!membership) {
      return { status: 404, body: { success: false, error: 'Candidate not found or access denied' } }
    }

    let query = adminSupabase
      .from('coseat_interviews')
      .select('id, interview_id, interviewer_id, session_status, created_at, started_at, ended_at, interview:interviews(recording_enabled)')
      .eq('candidate_id', candidateId)

    // 如果不包含所有状态，过滤掉 cancelled（但保留 completed 以显示完成状态）
    if (!includeAll) {
      query = query.not('session_status', 'eq', 'cancelled')
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) {
      console.error('Get active CoSeat interview error:', error)
      return { status: 500, body: { success: false, error: error.message } }
    }

    const activeInterview = data && data.length > 0 ? data[0] : null
    if (!activeInterview) {
      return {
        status: 200,
        body: {
          success: true,
          data: null,
        },
      }
    }

    const interviewJoin = (activeInterview as { interview?: { recording_enabled: boolean | null } | { recording_enabled: boolean | null }[] | null }).interview
    const recordingEnabled = Array.isArray(interviewJoin)
      ? interviewJoin[0]?.recording_enabled
      : interviewJoin?.recording_enabled

    const { interview, ...rest } = activeInterview as { interview?: unknown } & Record<string, unknown>

    return {
      status: 200,
      body: {
        success: true,
        data: {
          ...rest,
          recording_enabled: recordingEnabled ?? true,
        },
      },
    }
  } catch (error) {
    console.error('Get active CoSeat interview error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}
