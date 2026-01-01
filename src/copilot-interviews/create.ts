import { createAdminClient } from '../supabase/admin'
import { createCopilotInterview } from './manager'
import { asRecord, getString } from '../utils/parse'

export type CopilotCreateResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401 | 402 | 403 | 404 | 500; body: Record<string, unknown> }

async function checkCredits(
  supabase: ReturnType<typeof createAdminClient>,
  companyId: string,
  requiredCredits: number
): Promise<{ hasCredits: boolean; remaining: number; required: number; message?: string; recordingEnabled: boolean }> {
  const { data: company, error } = await supabase
    .from('companies')
    .select('credits_remaining, recording_enabled')
    .eq('id', companyId)
    .single()

  if (error || !company) {
    return {
      hasCredits: false,
      remaining: 0,
      required: requiredCredits,
      message: 'Company not found or error fetching credits',
      recordingEnabled: true,
    }
  }

  const remaining = (company as { credits_remaining: number | null }).credits_remaining ?? 0
  const recordingEnabled = (company as { recording_enabled?: boolean | null }).recording_enabled ?? true
  return {
    hasCredits: remaining >= requiredCredits,
    remaining,
    required: requiredCredits,
    message:
      remaining < requiredCredits
        ? `Insufficient credits. Required: ${requiredCredits}, Available: ${remaining}`
        : undefined,
    recordingEnabled,
  }
}

export async function handleCreateCopilotInterview(body: unknown): Promise<CopilotCreateResponse> {
  try {
    const record = asRecord(body)
    if (!record) return { status: 400, body: { error: 'Invalid request body' } }

    const userId = getString(record, 'userId')
    if (!userId) return { status: 401, body: { error: 'Unauthorized' } }

    const interviewId = getString(record, 'interviewId')
    const candidateId = getString(record, 'candidateId')
    if (!interviewId || !candidateId) {
      return { status: 400, body: { error: 'interviewId and candidateId are required' } }
    }

    const supabase = createAdminClient()

    const { data: interview, error: interviewError } = await supabase
      .from('interviews')
      .select('id, candidate_id, job_id')
      .eq('id', interviewId)
      .single()

    if (interviewError || !interview) {
      return { status: 404, body: { error: 'Interview not found' } }
    }

    const { data: candidate, error: candidateError } = await supabase
      .from('candidates')
      .select('id, company_id, job_id')
      .eq('id', candidateId)
      .single()

    if (candidateError || !candidate) {
      return { status: 404, body: { error: 'Candidate not found' } }
    }

    const companyId = (candidate as { company_id: string }).company_id
    const jobId = (candidate as { job_id: string }).job_id

    const { data: membership } = await supabase
      .from('company_members')
      .select('company_id')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .single()

    if (!membership) {
      return { status: 403, body: { error: 'Unauthorized: You are not a member of this company' } }
    }

    const creditCheck = await checkCredits(supabase, companyId, 60)
    if (!creditCheck.hasCredits) {
      return {
        status: 402,
        body: {
          error: 'Insufficient credits',
          message: creditCheck.message,
          remaining: creditCheck.remaining,
        },
      }
    }
    const recordingEnabled = creditCheck.recordingEnabled

    const { data: existing } = await supabase
      .from('copilot_interviews')
      .select('id')
      .eq('interview_id', interviewId)
      .single()

    if (existing) {
      return {
        status: 200,
        body: {
          success: true,
          data: existing,
          message: 'AI interview already exists',
        },
      }
    }

    const result = await createCopilotInterview(
      {
        interviewId,
        interviewerId: userId,
        candidateId,
        jobId,
        companyId,
        recordingEnabled,
      },
      supabase
    )

    if (!result.success) {
      return { status: 500, body: { error: result.error || 'Failed to create AI interview' } }
    }

    return { status: 200, body: { success: true, data: result.data } }
  } catch (error) {
    console.error('Error creating AI interview:', error)
    return {
      status: 500,
      body: {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    }
  }
}
