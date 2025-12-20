import { createAdminClient } from '../supabase/admin'
import { normalizeInterviewMode } from '../interview/modes'
import {
  DEFAULT_INTERVIEW_DURATION_MINUTES,
  isAllowedInterviewDurationMinutes,
} from './constants'

export type CreateInterviewResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 402 | 404 | 500; body: { error: string; [key: string]: unknown } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function checkCredits(
  supabase: ReturnType<typeof createAdminClient>,
  companyId: string,
  requiredCredits: number
): Promise<{ hasCredits: boolean; remaining: number; required: number; message?: string }> {
  const { data: company, error } = await supabase
    .from('companies')
    .select('credits_remaining')
    .eq('id', companyId)
    .single()

  if (error || !company) {
    return {
      hasCredits: false,
      remaining: 0,
      required: requiredCredits,
      message: 'Company not found or error fetching credits',
    }
  }

  const remaining = (company as { credits_remaining: number | null }).credits_remaining ?? 0
  return {
    hasCredits: remaining >= requiredCredits,
    remaining,
    required: requiredCredits,
    message:
      remaining < requiredCredits
        ? `Insufficient credits. Required: ${requiredCredits}, Available: ${remaining}`
        : undefined,
  }
}

export async function handleCreateInterview(body: unknown): Promise<CreateInterviewResponse> {
  const record = isRecord(body) ? body : null

  const candidateId = typeof record?.candidateId === 'string' ? record.candidateId : ''
  const jobId = typeof record?.jobId === 'string' ? record.jobId : ''
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

    const { data: interviewCode } = await supabase
      .from('interview_codes')
      .select('interview_duration')
      .eq('job_id', jobId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const interviewDurationFromCode = (interviewCode as unknown as { interview_duration?: number | null } | null)
      ?.interview_duration
    const interviewDuration = interviewDurationFromCode ?? DEFAULT_INTERVIEW_DURATION_MINUTES

    if (interviewDurationFromCode !== null && interviewDurationFromCode !== undefined) {
      if (!isAllowedInterviewDurationMinutes(interviewDurationFromCode)) {
        return {
          status: 400,
          body: { error: 'Interview duration must be 15, 30, 45, or 60 minutes' },
        }
      }
    }

    const finalInterviewMode = normalizeInterviewMode(candidateData.interview_mode || interviewMode)

    const creditCheck = await checkCredits(supabase, candidateData.company_id, interviewDuration)
    if (!creditCheck.hasCredits) {
      return {
        status: 402,
        body: {
          error: 'Insufficient credits',
          message: creditCheck.message,
          remaining: creditCheck.remaining,
          required: creditCheck.required,
        },
      }
    }

    const { data: existingInterview } = await supabase
      .from('interviews')
      .select('id, status, transcript, interview_mode, conversation_state')
      .eq('candidate_id', candidateId)
      .eq('job_id', jobId)
      .eq('status', 'in-progress')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (existingInterview) {
      const existing = existingInterview as unknown as {
        id: string
        transcript: unknown
        interview_mode: string | null
        conversation_state: unknown
      }

      const transcript = Array.isArray(existing.transcript) ? existing.transcript : []
      const normalizedMode = normalizeInterviewMode(existing.interview_mode)

      return {
        status: 200,
        body: {
          interviewId: existing.id,
          existing: true,
          interviewMode: normalizedMode,
          answeredQuestions: transcript.length,
          transcript,
          conversationState: existing.conversation_state || null,
        },
      }
    }

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
