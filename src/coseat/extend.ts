import { createAdminClient } from '../supabase/admin'
import {
  DEFAULT_INTERVIEW_DURATION_MINUTES,
  EXTEND_INTERVIEW_CONFIG,
  MAX_INTERVIEW_DURATION_MINUTES,
  normalizeInterviewDurationMinutes,
} from '../interviews/constants'
import { asRecord, getString } from '../utils/parse'

export type CoseatExtendResponse =
  | {
      status: 200
      body: {
        success: true
        previousDuration: number
        newDuration: number
        extendedBy: number
        creditsRemaining: number
      }
    }
  | { status: 400 | 401 | 403 | 404 | 409 | 500; body: Record<string, unknown> }
  | { status: 402; body: Record<string, unknown> }

async function checkCredits(
  supabase: ReturnType<typeof createAdminClient>,
  companyId: string,
  requiredCredits: number
): Promise<{ hasCredits: boolean; remaining: number; message?: string }> {
  const { data: company, error } = await supabase
    .from('companies')
    .select('credits_remaining')
    .eq('id', companyId)
    .single()

  if (error || !company) {
    return { hasCredits: false, remaining: 0, message: 'Company not found or error fetching credits' }
  }

  const remaining = (company as { credits_remaining: number | null }).credits_remaining ?? 0
  return {
    hasCredits: remaining >= requiredCredits,
    remaining,
    message: remaining < requiredCredits ? `Insufficient credits. Required: ${requiredCredits}, Available: ${remaining}` : undefined,
  }
}

export async function handleExtendCoseatInterview(
  coseatInterviewId: string,
  body: unknown
): Promise<CoseatExtendResponse> {
  try {
    const record = asRecord(body) ?? {}
    const userId = getString(record, 'userId')
    if (!userId) {
      return { status: 401, body: { error: 'Unauthorized' } }
    }

    const minutes = EXTEND_INTERVIEW_CONFIG.MINUTES_PER_EXTENSION
    const adminSupabase = createAdminClient()

    const { data: coseatInterview, error: fetchError } = await adminSupabase
      .from('coseat_interviews')
      .select('interview_id, company_id, interviewer_id, session_status')
      .eq('id', coseatInterviewId)
      .single()

    if (fetchError || !coseatInterview) {
      return { status: 404, body: { error: 'CoSeat interview not found' } }
    }

    const meta = coseatInterview as {
      interview_id: string
      company_id: string
      interviewer_id: string
      session_status: string | null
    }

    if (meta.interviewer_id !== userId) {
      return { status: 403, body: { error: 'You are not the interviewer for this session' } }
    }

    const allowedStatuses = ['active']
    if (!allowedStatuses.includes(meta.session_status ?? '')) {
      return { status: 409, body: { error: `Cannot extend interview in status: ${meta.session_status}` } }
    }

    const { data: interview, error: interviewError } = await adminSupabase
      .from('interviews')
      .select('interview_duration')
      .eq('id', meta.interview_id)
      .single()

    if (interviewError || !interview) {
      return { status: 404, body: { error: 'Interview record not found' } }
    }

    const currentDuration = normalizeInterviewDurationMinutes((interview as { interview_duration?: unknown }).interview_duration)
    const newDuration = currentDuration + minutes

    const baseDuration = DEFAULT_INTERVIEW_DURATION_MINUTES
    const alreadyExtended = Math.max(0, currentDuration - baseDuration)
    const totalExtensionAfter = alreadyExtended + minutes

    if (totalExtensionAfter > EXTEND_INTERVIEW_CONFIG.MAX_EXTENSION_TOTAL_MINUTES) {
      const remainingExtension = Math.max(0, EXTEND_INTERVIEW_CONFIG.MAX_EXTENSION_TOTAL_MINUTES - alreadyExtended)
      return {
        status: 400,
        body: {
          error: 'Maximum extension limit reached',
          message:
            `You can only extend the interview by ${EXTEND_INTERVIEW_CONFIG.MAX_EXTENSION_TOTAL_MINUTES} minutes total. ` +
            `Already extended: ${alreadyExtended} minutes. Remaining: ${remainingExtension} minutes.`,
          alreadyExtended,
          maxExtensionTotal: EXTEND_INTERVIEW_CONFIG.MAX_EXTENSION_TOTAL_MINUTES,
          remainingExtension,
        },
      }
    }

    if (newDuration > MAX_INTERVIEW_DURATION_MINUTES) {
      return { status: 400, body: { error: `Cannot extend beyond ${MAX_INTERVIEW_DURATION_MINUTES} minutes` } }
    }

    const creditCheck = await checkCredits(adminSupabase, meta.company_id, minutes)
    if (!creditCheck.hasCredits) {
      return {
        status: 402,
        body: {
          error: 'Insufficient credits',
          message: creditCheck.message,
          required: minutes,
          available: creditCheck.remaining,
        },
      }
    }

    const { error: updateError } = await adminSupabase
      .from('interviews')
      .update({ interview_duration: newDuration })
      .eq('id', meta.interview_id)

    if (updateError) {
      console.error('Error updating interview duration:', updateError)
      return { status: 500, body: { error: 'Failed to extend interview duration' } }
    }

    return {
      status: 200,
      body: {
        success: true,
        previousDuration: currentDuration,
        newDuration,
        extendedBy: minutes,
        creditsRemaining: creditCheck.remaining,
      },
    }
  } catch (error) {
    console.error('Error in coseat extend:', error)
    return { status: 500, body: { error: 'Internal server error' } }
  }
}
