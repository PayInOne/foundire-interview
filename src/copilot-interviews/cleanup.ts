import { createAdminClient } from '../supabase/admin'
import { toJson } from '../supabase/json'
import { normalizeInterviewDurationMinutes } from '../interviews/constants'
import { deleteRoomForRegion } from '../livekit/rooms'
import { deductCredits } from '../credits/manager'
import { enqueueInterviewAnalyzeTask } from '../workers/interview-analyze'
import { getEgressClientForRegion, getFallbackRegion, type LiveKitRegion } from '../livekit/geo-routing'
import type { AIAnalysis } from '../types'

export type CleanupCopilotResult = {
  copilotInterviewId: string
  interviewId: string
  success: boolean
  reason?: string
  roomDeleted?: boolean
  egressStopped?: boolean
  error?: string
}

function buildFallbackAnalysis(): AIAnalysis & { score: number } {
  return {
    dimension_scores: {
      relevance: { score: 0, notes: 'No responses provided' },
      depth: { score: 0, notes: 'No responses provided' },
      clarity: { score: 0, notes: 'No responses provided' },
      engagement: { score: 0, notes: 'No responses provided' },
    },
    overall_assessment: 'The interview was abandoned or disconnected before completion.',
    strengths: [],
    weaknesses: ['Interview not completed'],
    technical_skills: [],
    soft_skills: [],
    cultural_fit: { rating: 0, notes: 'Insufficient data to evaluate cultural fit.' },
    recommendation: 'no',
    red_flags: ['Interview not completed'],
    score: 0,
  }
}

function parseRegion(value: unknown): LiveKitRegion | null {
  return value === 'self-hosted' || value === 'cloud' ? value : null
}

function isNotFoundError(error: unknown): boolean {
  const err = error as { status?: number; code?: string }
  return err?.status === 404 || err?.code === 'not_found'
}

async function stopLiveKitEgressBestEffort(egressId: string, region: LiveKitRegion | null): Promise<boolean> {
  const regionsToTry: LiveKitRegion[] = region ? [region, getFallbackRegion(region)] : ['self-hosted', 'cloud']
  let lastError: unknown = null

  for (const candidateRegion of regionsToTry) {
    let egressClient
    try {
      egressClient = getEgressClientForRegion(candidateRegion)
    } catch (error) {
      lastError = error
      continue
    }

    try {
      await egressClient.stopEgress(egressId)
      return true
    } catch (error) {
      const err = error as { code?: string; status?: number }
      if (err?.code === 'failed_precondition' || err?.status === 412) {
        return true
      }

      if (isNotFoundError(error)) {
        lastError = error
        continue
      }

      console.warn(`⚠️ Failed to stop LiveKit egress ${egressId} in region ${candidateRegion}:`, error)
      return false
    }
  }

  if (lastError) {
    console.warn(`⚠️ Failed to stop LiveKit egress ${egressId}:`, lastError)
  }

  return false
}

export async function cleanupActiveCopilotInterviews(): Promise<CleanupCopilotResult[]> {
  const adminSupabase = createAdminClient()
  const results: CleanupCopilotResult[] = []

  const { data: copilotInterviews, error: fetchError } = await adminSupabase
    .from('copilot_interviews')
    .select(
      `
      id,
      interview_id,
      candidate_id,
      livekit_room_name,
      livekit_region,
      livekit_egress_id,
      updated_at,
      interview:interviews(
        id,
        started_at,
        last_active_at,
        credits_deducted,
        company_id,
        interview_duration
      )
    `
    )
    .eq('room_status', 'in_progress')

  if (fetchError) {
    console.error('Error fetching copilot interviews:', fetchError)
    return results
  }

  const rows = (copilotInterviews || []) as unknown as Array<{
    id: string
    interview_id: string
    candidate_id: string | null
    livekit_room_name: string | null
    livekit_region: string | null
    livekit_egress_id: string | null
    updated_at: string | null
    interview:
      | {
          id: string
          started_at: string | null
          last_active_at: string | null
          credits_deducted: number | null
          company_id: string
          interview_duration: unknown
        }
      | null
  }>

  for (const copilot of rows) {
    try {
      const interview = copilot.interview
      if (!interview?.started_at) continue

      const startedAt = new Date(interview.started_at)
      const now = new Date()
      const elapsedMinutes = Math.ceil((now.getTime() - startedAt.getTime()) / 1000 / 60)
      const maxDuration = normalizeInterviewDurationMinutes(interview.interview_duration)
      const bufferMinutes = 5

      const isOvertime = elapsedMinutes > maxDuration + bufferMinutes
      const lastUpdate = copilot.updated_at ? new Date(copilot.updated_at) : null
      const isAbandoned = lastUpdate ? now.getTime() - lastUpdate.getTime() > 5 * 60 * 1000 : false

      if (!isOvertime && !isAbandoned) continue

      const completedAt = isAbandoned && lastUpdate ? lastUpdate : now

      const reason = isOvertime
        ? `overtime (${elapsedMinutes} min > ${maxDuration} + ${bufferMinutes} buffer)`
        : 'abandoned (no heartbeat for 5 minutes)'

      const livekitRegion = parseRegion(copilot.livekit_region)

      let egressStopped = false
      if (copilot.livekit_egress_id) {
        try {
          egressStopped = await stopLiveKitEgressBestEffort(copilot.livekit_egress_id, livekitRegion)
        } catch (error) {
          console.warn(`Failed to stop egress for copilot interview ${copilot.id}:`, error)
        }
      }

      await adminSupabase
        .from('copilot_interviews')
        .update({ room_status: 'completed' })
        .eq('id', copilot.id)

      const interviewUpdate: Record<string, unknown> = {
        status: 'completed',
        completed_at: completedAt.toISOString(),
      }

      if (isAbandoned) {
        const fallback = buildFallbackAnalysis()
        interviewUpdate.score = 0
        interviewUpdate.ai_analysis = toJson(fallback)
      }

      await adminSupabase.from('interviews').update(interviewUpdate).eq('id', copilot.interview_id)

      if (copilot.candidate_id) {
        const candidateStatus = isOvertime ? 'completed' : 'pending'
        await adminSupabase.from('candidates').update({ status: candidateStatus }).eq('id', copilot.candidate_id)
      }

      // Final credit deduction (best-effort) for abandoned/cleanup flows.
      try {
        const alreadyDeducted = interview.credits_deducted || 0
        const totalMinutes = completedAt > startedAt ? Math.ceil((completedAt.getTime() - startedAt.getTime()) / 1000 / 60) : alreadyDeducted
        const remainingCredits = Math.max(0, totalMinutes - alreadyDeducted)

        if (remainingCredits > 0) {
          const deduction = await deductCredits(
            {
              companyId: interview.company_id,
              amount: remainingCredits,
              type: 'interview_minute',
              referenceId: copilot.interview_id,
              referenceType: 'interview',
              description: `Copilot interview cleanup: final ${remainingCredits} minute(s)`,
            },
            adminSupabase
          )

          if (deduction.success) {
            await adminSupabase.from('interviews').update({ credits_deducted: totalMinutes }).eq('id', copilot.interview_id)
          }
        }
      } catch (error) {
        console.warn(`Failed to finalize credits for copilot interview ${copilot.id}:`, error)
      }

      let roomDeleted = false
      if (copilot.livekit_room_name) {
        try {
          roomDeleted = await deleteRoomForRegion(copilot.livekit_room_name, livekitRegion)
        } catch (roomError) {
          console.error(`Failed to delete room for copilot interview ${copilot.id}:`, roomError)
        }
      }

      if (isOvertime && process.env.RABBITMQ_URL) {
        try {
          await enqueueInterviewAnalyzeTask({ interviewId: copilot.interview_id, locale: 'en', sendEmail: true })
        } catch (error) {
          console.warn(`Failed to enqueue analysis for copilot interview ${copilot.id}:`, error)
        }
      }

      results.push({
        copilotInterviewId: copilot.id,
        interviewId: copilot.interview_id,
        success: true,
        reason,
        roomDeleted,
        egressStopped,
      })
    } catch (error) {
      console.error(`Error processing copilot interview ${copilot.id}:`, error)
      results.push({
        copilotInterviewId: copilot.id,
        interviewId: copilot.interview_id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return results
}

export async function cleanupWaitingRoomCopilotInterviews(): Promise<CleanupCopilotResult[]> {
  const adminSupabase = createAdminClient()
  const results: CleanupCopilotResult[] = []

  const waitingStatuses = ['waiting_both', 'waiting_candidate', 'waiting_interviewer', 'both_ready']

  const { data: waitingRoomInterviews, error } = await adminSupabase
    .from('copilot_interviews')
    .select('id, interview_id, candidate_id, livekit_room_name, livekit_region, room_status, updated_at, created_at')
    .in('room_status', waitingStatuses)

  if (error) {
    console.error('Error fetching waiting room interviews:', error)
    return results
  }

  const rows = (waitingRoomInterviews || []) as unknown as Array<{
    id: string
    interview_id: string
    candidate_id: string | null
    livekit_room_name: string | null
    livekit_region: string | null
    room_status: string | null
    updated_at: string | null
    created_at: string | null
  }>

  for (const waiting of rows) {
    try {
      const now = new Date()
      const lastUpdate = waiting.updated_at
        ? new Date(waiting.updated_at)
        : waiting.created_at
          ? new Date(waiting.created_at)
          : now

      const minutesSinceUpdate = (now.getTime() - lastUpdate.getTime()) / 1000 / 60
      const isAbandoned = minutesSinceUpdate > 5
      if (!isAbandoned) continue

      const reason = `waiting room abandoned (${waiting.room_status}, no heartbeat for ${Math.round(minutesSinceUpdate)} minutes)`

      await adminSupabase
        .from('copilot_interviews')
        .update({ room_status: 'cancelled' })
        .eq('id', waiting.id)

      await adminSupabase
        .from('interviews')
        .update({ status: 'cancelled' })
        .eq('id', waiting.interview_id)

      if (waiting.candidate_id) {
        await adminSupabase
          .from('candidates')
          .update({ status: 'pending' })
          .eq('id', waiting.candidate_id)
      }

      let roomDeleted = false
      if (waiting.livekit_room_name) {
        try {
          roomDeleted = await deleteRoomForRegion(
            waiting.livekit_room_name,
            (waiting.livekit_region as LiveKitRegion | null) ?? null
          )
        } catch (roomError) {
          console.error(`Failed to delete room for waiting interview ${waiting.id}:`, roomError)
        }
      }

      results.push({
        copilotInterviewId: waiting.id,
        interviewId: waiting.interview_id,
        success: true,
        reason,
        roomDeleted,
      })
    } catch (error) {
      console.error(`Error processing waiting room interview ${waiting.id}:`, error)
      results.push({
        copilotInterviewId: waiting.id,
        interviewId: waiting.interview_id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return results
}
