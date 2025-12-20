import type { SupabaseClient } from '@supabase/supabase-js'
import { deductCredits } from '../credits/manager'
import { deleteRoomForRegion } from '../livekit/rooms'

export interface HeartbeatBillingParams {
  interviewId: string
  companyId: string
  startedAt: Date | null
  creditsDeducted: number
  supabase: SupabaseClient
  maxDeductPerCall?: number
  descriptionPrefix?: string
}

export interface HeartbeatBillingResult {
  creditsDeducted: number
  newBalance: number
  minutesElapsed: number
  creditWarning: 'low' | 'critical' | 'exhausted' | null
  success: boolean
  error?: string
}

export interface HeartbeatBillingWithAutoEndParams extends HeartbeatBillingParams {
  candidateId?: string
  extendedTableName?: string
  extendedTableId?: string
  statusFieldName?: string
  interviewDurationMinutes?: number
  livekitRoomName?: string
}

export interface HeartbeatBillingWithAutoEndResult extends HeartbeatBillingResult {
  autoEnded: boolean
  autoEndReason?: 'credits_exhausted' | 'duration_exceeded'
}

export async function processHeartbeatBilling({
  interviewId,
  companyId,
  startedAt,
  creditsDeducted: alreadyDeducted,
  supabase,
  maxDeductPerCall = 5,
  descriptionPrefix = 'Interview',
}: HeartbeatBillingParams): Promise<HeartbeatBillingResult> {
  const now = new Date()
  let creditsDeducted = 0
  let newBalance = 0
  let creditWarning: 'low' | 'critical' | 'exhausted' | null = null
  let minutesElapsed = 0

  if (startedAt) {
    minutesElapsed = Math.ceil((now.getTime() - startedAt.getTime()) / 1000 / 60)

    const shouldBeDeducted = minutesElapsed
    const needsToDeduct = shouldBeDeducted - alreadyDeducted
    const safeNeedsToDeduct = Math.min(Math.max(needsToDeduct, 0), maxDeductPerCall)

    if (safeNeedsToDeduct !== needsToDeduct && needsToDeduct > 0) {
      console.warn(
        `⚠️ Large credit deduction detected (${needsToDeduct} minutes), limiting to ${safeNeedsToDeduct}. Interview ID: ${interviewId}`
      )
    }

    if (safeNeedsToDeduct > 0) {
      const deductResult = await deductCredits(
        {
          companyId,
          amount: safeNeedsToDeduct,
          type: 'interview_minute',
          referenceId: interviewId,
          referenceType: 'interview',
          description: `${descriptionPrefix}: minutes ${alreadyDeducted + 1}-${alreadyDeducted + safeNeedsToDeduct}`,
        },
        supabase
      )

      if (deductResult.success) {
        creditsDeducted = safeNeedsToDeduct
        newBalance = deductResult.newBalance

        await supabase
          .from('interviews')
          .update({
            credits_deducted: alreadyDeducted + safeNeedsToDeduct,
            last_active_at: now.toISOString(),
          })
          .eq('id', interviewId)
      } else {
        console.error('❌ Failed to deduct credits:', deductResult.error)
        newBalance = deductResult.newBalance
        creditWarning = 'exhausted'

        await supabase
          .from('interviews')
          .update({ last_active_at: now.toISOString() })
          .eq('id', interviewId)
      }
    } else {
      await supabase
        .from('interviews')
        .update({ last_active_at: now.toISOString() })
        .eq('id', interviewId)

      const { data: company } = await supabase
        .from('companies')
        .select('credits_remaining')
        .eq('id', companyId)
        .single()

      newBalance = (company as { credits_remaining: number | null } | null)?.credits_remaining ?? 0
    }
  } else {
    const { data: company } = await supabase
      .from('companies')
      .select('credits_remaining')
      .eq('id', companyId)
      .single()

    newBalance = (company as { credits_remaining: number | null } | null)?.credits_remaining ?? 0
  }

  if (!creditWarning) {
    if (newBalance <= 0) {
      creditWarning = 'exhausted'
    } else if (newBalance <= 5) {
      creditWarning = 'critical'
    } else if (newBalance <= 10) {
      creditWarning = 'low'
    }
  }

  return {
    creditsDeducted,
    newBalance,
    minutesElapsed,
    creditWarning,
    success: true,
  }
}

export async function handleInterviewAutoEnd({
  interviewId,
  extendedTableName,
  extendedTableId,
  statusFieldName,
  candidateId,
  supabase,
  reason,
  livekitRoomName,
}: {
  interviewId: string
  extendedTableName?: string
  extendedTableId?: string
  statusFieldName?: string
  candidateId?: string
  supabase: SupabaseClient
  reason: 'credits_exhausted' | 'duration_exceeded'
  livekitRoomName?: string
}): Promise<{ autoEnded: boolean }> {
  const now = new Date()

  await supabase
    .from('interviews')
    .update({
      status: 'completed',
      completed_at: now.toISOString(),
    })
    .eq('id', interviewId)

  if (extendedTableName && extendedTableId && statusFieldName) {
    await supabase
      .from(extendedTableName)
      .update({ [statusFieldName]: 'completed' })
      .eq('id', extendedTableId)
  }

  if (candidateId) {
    await supabase
      .from('candidates')
      .update({ status: 'completed' })
      .eq('id', candidateId)
  }

  if (livekitRoomName) {
    try {
      await deleteRoomForRegion(livekitRoomName, 'self-hosted')
    } catch (error) {
      console.error(`❌ Failed to delete LiveKit room ${livekitRoomName}:`, error)
    }
  }

  return { autoEnded: true }
}

export async function processHeartbeatBillingWithAutoEnd({
  interviewId,
  companyId,
  startedAt,
  creditsDeducted,
  supabase,
  maxDeductPerCall,
  descriptionPrefix,
  candidateId,
  extendedTableName,
  extendedTableId,
  statusFieldName,
  interviewDurationMinutes,
  livekitRoomName,
}: HeartbeatBillingWithAutoEndParams): Promise<HeartbeatBillingWithAutoEndResult> {
  const billingResult = await processHeartbeatBilling({
    interviewId,
    companyId,
    startedAt,
    creditsDeducted,
    supabase,
    maxDeductPerCall,
    descriptionPrefix,
  })

  if (interviewDurationMinutes && interviewDurationMinutes > 0 && billingResult.minutesElapsed > 0) {
    const bufferMinutes = 2
    if (billingResult.minutesElapsed >= interviewDurationMinutes + bufferMinutes) {
      await handleInterviewAutoEnd({
        interviewId,
        extendedTableName,
        extendedTableId,
        statusFieldName,
        candidateId,
        supabase,
        reason: 'duration_exceeded',
        livekitRoomName,
      })

      return { ...billingResult, autoEnded: true, autoEndReason: 'duration_exceeded' }
    }
  }

  if (billingResult.creditWarning === 'exhausted') {
    await handleInterviewAutoEnd({
      interviewId,
      extendedTableName,
      extendedTableId,
      statusFieldName,
      candidateId,
      supabase,
      reason: 'credits_exhausted',
      livekitRoomName,
    })

    return { ...billingResult, autoEnded: true, autoEndReason: 'credits_exhausted' }
  }

  return { ...billingResult, autoEnded: false }
}
