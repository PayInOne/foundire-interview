import { createAdminClient } from '../supabase/admin'
import { normalizeInterviewDurationMinutes } from '../interviews/constants'
import { processHeartbeatBillingWithAutoEnd } from '../interviews/heartbeat-billing'
import type { LiveKitRegion } from '../livekit/geo-routing'
import { updateParticipantHeartbeat } from './manager'
import { asRecord, getOptionalString } from '../utils/parse'

export type CopilotHeartbeatResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 404; body: { error: string } }
  | { status: 409; body: { error: string; status?: string } }
  | { status: 500; body: { error: string; message?: string } }

export async function handleCopilotInterviewHeartbeat(
  copilotInterviewId: string,
  body: unknown
): Promise<CopilotHeartbeatResponse> {
  try {
    const record = asRecord(body) ?? {}
    const userId = getOptionalString(record, 'userId')

    const supabase = createAdminClient()

    const { data: copilotInterview, error: fetchCopilotError } = await supabase
      .from('copilot_interviews')
      .select(
        'interview_id, company_id, room_status, candidate_id, livekit_egress_id, livekit_room_name, created_at, updated_at, livekit_region'
      )
      .eq('id', copilotInterviewId)
      .single()

    if (fetchCopilotError || !copilotInterview) {
      return { status: 404, body: { error: 'Copilot interview not found' } }
    }

    const copilot = copilotInterview as {
      interview_id: string
      company_id: string
      room_status: string
      candidate_id: string
      livekit_egress_id: string | null
      livekit_room_name: string | null
      created_at: string | null
      updated_at: string | null
      livekit_region: string | null
    }

    const allowedStatuses = ['waiting_interviewer', 'waiting_candidate', 'both_ready', 'in_progress']
    if (!allowedStatuses.includes(copilot.room_status)) {
      if (copilot.room_status === 'completed') {
        return {
          status: 200,
          body: {
            success: true,
            status: 'completed',
            message: 'Interview has been completed',
            shouldDisconnect: true,
          },
        }
      }

      return {
        status: 409,
        body: {
          error: `Copilot interview is not active (status: ${copilot.room_status})`,
          status: copilot.room_status,
        },
      }
    }

    const { data: interview, error: fetchInterviewError } = await supabase
      .from('interviews')
      .select('started_at, credits_deducted, status, interview_duration')
      .eq('id', copilot.interview_id)
      .single()

    if (fetchInterviewError || !interview) {
      return { status: 404, body: { error: 'Interview record not found' } }
    }

    const interviewRecord = interview as {
      started_at: string | null
      credits_deducted: number | null
      status: string | null
      interview_duration: unknown
    }

    let effectiveStartedAt = interviewRecord.started_at ? new Date(interviewRecord.started_at) : null
    if (!effectiveStartedAt && copilot.room_status === 'in_progress') {
      const now = new Date()
      effectiveStartedAt = now
      await supabase
        .from('interviews')
        .update({
          started_at: now.toISOString(),
          status: 'in-progress',
        })
        .eq('id', copilot.interview_id)
    }

    const interviewDurationMinutes = normalizeInterviewDurationMinutes(interviewRecord.interview_duration)

    const billingResult = await processHeartbeatBillingWithAutoEnd({
      interviewId: copilot.interview_id,
      companyId: copilot.company_id,
      startedAt: effectiveStartedAt,
      creditsDeducted: interviewRecord.credits_deducted || 0,
      supabase,
      maxDeductPerCall: 5,
      descriptionPrefix: 'Copilot interview',
      candidateId: copilot.candidate_id,
      extendedTableName: 'copilot_interviews',
      extendedTableId: copilotInterviewId,
      statusFieldName: 'room_status',
      interviewDurationMinutes,
      livekitRoomName: copilot.livekit_room_name ?? undefined,
      livekitRegion: (copilot.livekit_region as LiveKitRegion | null) ?? null,
    })

    if (billingResult.autoEnded) {
      const message =
        billingResult.autoEndReason === 'duration_exceeded'
          ? 'Interview ended automatically due to duration limit exceeded'
          : 'Interview ended automatically due to insufficient credits'

      return {
        status: 200,
        body: {
          success: true,
          status: 'completed',
          minutesElapsed: billingResult.minutesElapsed,
          creditsDeducted: billingResult.creditsDeducted,
          newBalance: billingResult.newBalance,
          creditWarning: billingResult.creditWarning,
          autoEnded: true,
          autoEndReason: billingResult.autoEndReason,
          message,
        },
      }
    }

    await supabase
      .from('copilot_interviews')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', copilotInterviewId)

    if (userId) {
      await updateParticipantHeartbeat(copilotInterviewId, userId, supabase)
    }

    return {
      status: 200,
      body: {
        success: true,
        status: copilot.room_status,
        minutesElapsed: billingResult.minutesElapsed,
        creditsDeducted: billingResult.creditsDeducted,
        newBalance: billingResult.newBalance,
        creditWarning: billingResult.creditWarning,
        companyId: copilot.company_id,
        interviewDuration: interviewDurationMinutes,
        startedAt: effectiveStartedAt?.toISOString() ?? null,
        isRecording: Boolean(copilot.livekit_egress_id),
      },
    }
  } catch (error) {
    console.error('Error in copilot heartbeat:', error)
    return {
      status: 500,
      body: {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    }
  }
}
