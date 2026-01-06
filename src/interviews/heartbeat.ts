import { createAdminClient } from '../supabase/admin'
import type { LiveKitRegion } from '../livekit/geo-routing'
import { normalizeInterviewDurationMinutes } from './constants'
import { handleInterviewAutoEnd, processHeartbeatBillingWithAutoEnd } from './heartbeat-billing'
import { isTalentApplicantCandidate } from './talent'

export type HeartbeatResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 404 | 409 | 500; body: { error: string } }

export async function handleInterviewHeartbeat(interviewId: string): Promise<HeartbeatResponse> {
  if (!interviewId) {
    return { status: 400, body: { error: 'interviewId is required' } }
  }

  const supabase = createAdminClient()

  let interview: unknown = null
  let fetchError: { code?: string } | null = null

  ;({ data: interview, error: fetchError } = await supabase
    .from('interviews')
    .select(
      'started_at, company_id, candidate_id, credits_deducted, status, interview_duration, livekit_room_name, livekit_region'
    )
    .eq('id', interviewId)
    .single())

  if (fetchError?.code === '42703') {
    ;({ data: interview, error: fetchError } = await supabase
      .from('interviews')
      .select('started_at, company_id, candidate_id, credits_deducted, status, interview_duration, livekit_room_name')
      .eq('id', interviewId)
      .single())
  }

  if (fetchError || !interview) {
    return { status: 404, body: { error: 'Interview not found or not active' } }
  }

  const record = interview as unknown as {
    started_at: string | null
    company_id: string
    candidate_id: string | null
    credits_deducted: number | null
    status: string | null
    interview_duration: unknown
    livekit_room_name: string | null
    livekit_region?: unknown
  }

  if (record.status !== 'in-progress' && record.status !== 'paused') {
    return { status: 409, body: { error: `Interview is not active (status: ${record.status})` } }
  }

  let effectiveStartedAt = record.started_at ? new Date(record.started_at) : null
  if (!effectiveStartedAt && record.status === 'in-progress') {
    const now = new Date()
    effectiveStartedAt = now
    await supabase
      .from('interviews')
      .update({ started_at: now.toISOString() })
      .eq('id', interviewId)
  }

  const interviewDurationMinutes = normalizeInterviewDurationMinutes(record.interview_duration)

  const isTalentApplicant = await isTalentApplicantCandidate(supabase, record.candidate_id)
  if (isTalentApplicant) {
    const now = new Date()
    const minutesElapsed = effectiveStartedAt
      ? Math.ceil((now.getTime() - effectiveStartedAt.getTime()) / 1000 / 60)
      : 0

    await supabase
      .from('interviews')
      .update({ last_active_at: now.toISOString() })
      .eq('id', interviewId)

    if (interviewDurationMinutes && minutesElapsed > 0) {
      const bufferMinutes = 2
      if (minutesElapsed >= interviewDurationMinutes + bufferMinutes) {
        await handleInterviewAutoEnd({
          interviewId,
          candidateId: record.candidate_id ?? undefined,
          supabase,
          reason: 'duration_exceeded',
          livekitRoomName: record.livekit_room_name ?? undefined,
          livekitRegion: (record.livekit_region as LiveKitRegion | null) ?? null,
        })

        return {
          status: 200,
          body: {
            success: true,
            status: 'completed',
            minutesElapsed,
            creditsDeducted: 0,
            newBalance: 0,
            creditWarning: null,
            autoEnded: true,
            autoEndReason: 'duration_exceeded',
            message: 'Interview ended automatically due to duration limit exceeded',
            companyId: record.company_id,
            interviewDuration: interviewDurationMinutes,
            startedAt: effectiveStartedAt?.toISOString() ?? null,
          },
        }
      }
    }

    return {
      status: 200,
      body: {
        success: true,
        status: record.status,
        minutesElapsed,
        creditsDeducted: 0,
        newBalance: 0,
        creditWarning: null,
        companyId: record.company_id,
        interviewDuration: interviewDurationMinutes,
        startedAt: effectiveStartedAt?.toISOString() ?? null,
      },
    }
  }

  const billingResult = await processHeartbeatBillingWithAutoEnd({
    interviewId,
    companyId: record.company_id,
    startedAt: effectiveStartedAt,
    creditsDeducted: record.credits_deducted || 0,
    supabase,
    descriptionPrefix: 'AI Interview',
    candidateId: record.candidate_id ?? undefined,
    interviewDurationMinutes,
    livekitRoomName: record.livekit_room_name ?? undefined,
    livekitRegion: (record.livekit_region as LiveKitRegion | null) ?? null,
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
        companyId: record.company_id,
        interviewDuration: interviewDurationMinutes,
        startedAt: effectiveStartedAt?.toISOString() ?? null,
      },
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      status: record.status,
      minutesElapsed: billingResult.minutesElapsed,
      creditsDeducted: billingResult.creditsDeducted,
      newBalance: billingResult.newBalance,
      creditWarning: billingResult.creditWarning,
      companyId: record.company_id,
      interviewDuration: interviewDurationMinutes,
      startedAt: effectiveStartedAt?.toISOString() ?? null,
    },
  }
}
