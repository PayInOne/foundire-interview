import { createAdminClient } from '../supabase/admin'
import { normalizeInterviewDurationMinutes } from '../interviews/constants'
import { processHeartbeatBillingWithAutoEnd } from '../interviews/heartbeat-billing'

export type CoseatHeartbeatResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 404 | 500; body: Record<string, unknown> }

export async function handleCoseatHeartbeat(coseatInterviewId: string): Promise<CoseatHeartbeatResponse> {
  try {
    const adminSupabase = createAdminClient()

    const { data: coseatInterview, error: fetchError } = await adminSupabase
      .from('coseat_interviews')
      .select(
        `
        id,
        interview_id,
        company_id,
        candidate_id,
        session_status,
        started_at,
        interview:interviews(
          id,
          started_at,
          credits_deducted,
          interview_duration
        )
      `
      )
      .eq('id', coseatInterviewId)
      .single()

    if (fetchError || !coseatInterview) {
      console.error('❌ CoSeat heartbeat - interview not found:', {
        coseatInterviewId,
        fetchError: fetchError?.message,
        fetchErrorCode: fetchError?.code,
      })
      return {
        status: 404,
        body: { success: false, error: 'CoSeat interview not found', details: fetchError?.message },
      }
    }

    const record = coseatInterview as unknown as {
      id: string
      interview_id: string
      company_id: string
      candidate_id: string
      session_status: string | null
      started_at: string | null
      interview: {
        id: string
        started_at: string | null
        credits_deducted: number | null
        interview_duration: unknown
      } | null
    }

    if (record.session_status !== 'active') {
      return { status: 400, body: { success: false, error: 'Session is not active' } }
    }

    if (!record.interview) {
      return { status: 404, body: { success: false, error: 'Interview not found for CoSeat session' } }
    }

    const interviewDurationMinutes = normalizeInterviewDurationMinutes(record.interview.interview_duration)

    const startedAt = record.interview.started_at
      ? new Date(record.interview.started_at)
      : record.started_at
        ? new Date(record.started_at)
        : new Date()

    const billingResult = await processHeartbeatBillingWithAutoEnd({
      interviewId: record.interview_id,
      companyId: record.company_id,
      startedAt,
      creditsDeducted: record.interview.credits_deducted || 0,
      supabase: adminSupabase,
      maxDeductPerCall: 5,
      descriptionPrefix: 'CoSeat interview',
      candidateId: record.candidate_id,
      extendedTableName: 'coseat_interviews',
      extendedTableId: coseatInterviewId,
      statusFieldName: 'session_status',
      interviewDurationMinutes,
    })

    return {
      status: 200,
      body: {
        success: true,
        data: {
          lastActiveAt: new Date().toISOString(),
          creditsDeducted: billingResult.creditsDeducted,
          totalCreditsDeducted: (record.interview.credits_deducted || 0) + billingResult.creditsDeducted,
          minutesElapsed: billingResult.minutesElapsed,
          newBalance: billingResult.newBalance,
          creditWarning: billingResult.creditWarning,
        },
      },
    }
  } catch (error) {
    console.error('Error in POST /internal/coseat/[id]/heartbeat:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

