import { createAdminClient } from '../supabase/admin'
import { normalizeInterviewMode } from '../interview/modes'
import {
  DEFAULT_INTERVIEW_DURATION_MINUTES,
  isAllowedInterviewDurationMinutes,
} from './constants'

export type CreateInterviewResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 404 | 500; body: { error: string; [key: string]: unknown } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export async function handleCreateInterview(body: unknown): Promise<CreateInterviewResponse> {
  const record = isRecord(body) ? body : null

  const candidateId = typeof record?.candidateId === 'string' ? record.candidateId : ''
  const jobId = typeof record?.jobId === 'string' ? record.jobId : ''
  const codeId = typeof record?.codeId === 'string' ? record.codeId : ''
  const interviewMode = typeof record?.interviewMode === 'string' ? record.interviewMode : undefined

  if (!candidateId || !jobId) {
    return { status: 400, body: { error: 'Missing required fields' } }
  }

  try {
    const supabase = createAdminClient()

    const { data: candidate, error: candidateError } = await supabase
      .from('candidates')
      .select('id, company_id, interview_mode')
      .eq('id', candidateId)
      .eq('job_id', jobId)
      .single()

    if (candidateError || !candidate) {
      return { status: 404, body: { error: 'Candidate not found' } }
    }

    const candidateData = candidate as unknown as { id: string; company_id: string; interview_mode?: string | null }

    const { data: latestInterview } = await supabase
      .from('interviews')
      .select('id, status, transcript, interview_mode, conversation_state')
      .eq('candidate_id', candidateId)
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const latestInterviewRecord = latestInterview as
      | { id: string; status: string; transcript: unknown; interview_mode: string | null; conversation_state: unknown }
      | null

    if (latestInterviewRecord && ['in-progress', 'paused'].includes(latestInterviewRecord.status)) {
      const transcript = Array.isArray(latestInterviewRecord.transcript) ? latestInterviewRecord.transcript : []
      const normalizedMode = normalizeInterviewMode(latestInterviewRecord.interview_mode)

      return {
        status: 200,
        body: {
          interviewId: latestInterviewRecord.id,
          existing: true,
          interviewMode: normalizedMode,
          answeredQuestions: transcript.length,
          transcript,
          conversationState: latestInterviewRecord.conversation_state || null,
        },
      }
    }

    const hasPriorInterview = Boolean(latestInterviewRecord)

    type InterviewCodeData = {
      id: string
      job_id: string
      interview_duration?: number | null
      recording_enabled?: boolean | null
      interview_mode?: string | null
      expires_at?: string | null
      max_uses?: number | null
      used_count?: number | null
    }

    const getCodeObject = (value: unknown): InterviewCodeData | null => {
      if (!value || typeof value !== 'object') return null
      return value as InterviewCodeData
    }

    const getMaybeCode = (value: unknown): InterviewCodeData | null => {
      if (Array.isArray(value)) {
        return getCodeObject(value[0])
      }
      return getCodeObject(value)
    }

    const nowIso = new Date().toISOString()
    let interviewCodeData: InterviewCodeData | null = null
    let candidateInvitationUsed = false

    if (codeId) {
      const { data: explicitCode } = await supabase
        .from('interview_codes')
        .select('id, job_id, interview_duration, recording_enabled, interview_mode, expires_at, max_uses, used_count')
        .eq('id', codeId)
        .maybeSingle()

      const explicit = explicitCode as InterviewCodeData | null
      if (!explicit || explicit.job_id !== jobId) {
        return { status: 400, body: { error: 'Invalid interview link' } }
      }

      const { data: candidateInvitation } = await supabase
        .from('candidate_invitations')
        .select('code_used')
        .eq('candidate_id', candidateId)
        .eq('interview_code_id', codeId)
        .order('invited_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      candidateInvitationUsed = Boolean(candidateInvitation?.code_used)

      if (explicit.expires_at && new Date(explicit.expires_at).toISOString() <= nowIso) {
        return { status: 400, body: { error: 'Interview code has expired' } }
      }

      if (
        explicit.max_uses !== null &&
        explicit.max_uses !== undefined &&
        (explicit.used_count ?? 0) >= explicit.max_uses &&
        (!candidateInvitationUsed || hasPriorInterview)
      ) {
        return { status: 400, body: { error: 'Interview code has already been used' } }
      }

      interviewCodeData = explicit
    } else {
      const { data: pendingInvitation } = await supabase
        .from('candidate_invitations')
        .select(
          'interview_codes (id, job_id, interview_duration, recording_enabled, interview_mode, expires_at, max_uses, used_count)'
        )
        .eq('candidate_id', candidateId)
        .eq('job_id', jobId)
        .eq('code_used', false)
        .order('invited_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const pendingCode = getMaybeCode((pendingInvitation as { interview_codes?: unknown } | null)?.interview_codes)
      if (!pendingCode || pendingCode.job_id !== jobId) {
        return { status: 400, body: { error: 'Invalid interview link' } }
      }

      if (pendingCode.expires_at && new Date(pendingCode.expires_at).toISOString() <= nowIso) {
        return { status: 400, body: { error: 'Interview code has expired' } }
      }

      if (
        pendingCode.max_uses !== null &&
        pendingCode.max_uses !== undefined &&
        (pendingCode.used_count ?? 0) >= pendingCode.max_uses
      ) {
        return { status: 400, body: { error: 'Interview code has already been used' } }
      }

      interviewCodeData = pendingCode
    }

    if (!interviewCodeData) {
      return { status: 400, body: { error: 'Invalid interview link' } }
    }

    const interviewDurationFromCode = interviewCodeData?.interview_duration
    const interviewDuration = interviewDurationFromCode ?? DEFAULT_INTERVIEW_DURATION_MINUTES

    if (interviewDurationFromCode !== null && interviewDurationFromCode !== undefined) {
      if (!isAllowedInterviewDurationMinutes(interviewDurationFromCode)) {
        return {
          status: 400,
          body: { error: 'Interview duration must be 15, 30, 45, or 60 minutes' },
        }
      }
    }

    const finalInterviewMode = normalizeInterviewMode(
      interviewCodeData?.interview_mode || candidateData.interview_mode || interviewMode
    )

    const recordingEnabled = interviewCodeData?.recording_enabled ?? true

    const now = new Date().toISOString()
    const interviewInsert = {
      candidate_id: candidateId,
      job_id: jobId,
      company_id: candidateData.company_id,
      status: 'in-progress',
      started_at: now,
      last_active_at: now,
      interview_duration: interviewDuration,
      interview_mode: finalInterviewMode,
      recording_enabled: recordingEnabled,
    }

    const { data: interview, error: interviewError } = await supabase
      .from('interviews')
      .insert(interviewInsert)
      .select()
      .single()

    if (interviewError || !interview) {
      console.error('Error creating interview:', interviewError)
      return { status: 500, body: { error: 'Failed to create interview' } }
    }

    await supabase
      .from('candidates')
      .update({ status: 'interviewing' })
      .eq('id', candidateId)

    return {
      status: 200,
      body: {
        interviewId: (interview as { id: string }).id,
        existing: false,
        answeredQuestions: 0,
        transcript: [],
      },
    }
  } catch (error) {
    console.error('Error creating interview:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return { status: 500, body: { error: message } }
  }
}
