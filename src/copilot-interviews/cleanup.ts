import { createAdminClient } from '../supabase/admin'
import { normalizeInterviewDurationMinutes } from '../interviews/constants'
import { deleteRoomForRegion } from '../livekit/rooms'
import type { LiveKitRegion } from '../livekit/geo-routing'

export type CleanupCopilotResult = {
  copilotInterviewId: string
  interviewId: string
  success: boolean
  reason?: string
  roomDeleted?: boolean
  error?: string
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
      livekit_room_name,
      livekit_region,
      updated_at,
      interview:interviews(
        id,
        started_at,
        credits_deducted,
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
    livekit_room_name: string | null
    livekit_region: string | null
    updated_at: string | null
    interview:
      | {
          id: string
          started_at: string | null
          credits_deducted: number | null
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

      const reason = isOvertime
        ? `overtime (${elapsedMinutes} min > ${maxDuration} + ${bufferMinutes} buffer)`
        : 'abandoned (no heartbeat for 5 minutes)'

      await adminSupabase
        .from('copilot_interviews')
        .update({ room_status: 'completed' })
        .eq('id', copilot.id)

      await adminSupabase
        .from('interviews')
        .update({ status: 'completed', completed_at: now.toISOString() })
        .eq('id', copilot.interview_id)

      let roomDeleted = false
      if (copilot.livekit_room_name) {
        try {
          roomDeleted = await deleteRoomForRegion(
            copilot.livekit_room_name,
            (copilot.livekit_region as LiveKitRegion | null) ?? null
          )
        } catch (roomError) {
          console.error(`Failed to delete room for copilot interview ${copilot.id}:`, roomError)
        }
      }

      results.push({
        copilotInterviewId: copilot.id,
        interviewId: copilot.interview_id,
        success: true,
        reason,
        roomDeleted,
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

