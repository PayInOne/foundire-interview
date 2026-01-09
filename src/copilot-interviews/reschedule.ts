import { getAppPublicUrl } from '../config'
import { createAdminClient } from '../supabase/admin'
import { asRecord, getBoolean, getString } from '../utils/parse'
import {
  DEFAULT_INTERVIEW_DURATION_MINUTES,
  isAllowedInterviewDurationMinutes,
  normalizeInterviewDurationMinutes,
} from '../interviews/constants'

type SchedulingMode = 'instant' | 'scheduled' | 'candidate_choice'

interface TimeSlot {
  start: string
  end: string
}

const MAX_SCHEDULING_DAYS = 30

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isValidSchedulingMode(value: unknown): value is SchedulingMode {
  return value === 'instant' || value === 'scheduled' || value === 'candidate_choice'
}

function parseTimeSlots(value: unknown, now: Date, maxDate: Date): TimeSlot[] | null {
  if (!Array.isArray(value)) return null
  const nowTime = now.getTime()
  const maxTime = maxDate.getTime()
  const slots: TimeSlot[] = []
  const seen = new Set<string>()
  for (const slot of value) {
    if (typeof slot !== 'object' || slot === null) return null
    const { start, end } = slot as { start?: unknown; end?: unknown }
    if (typeof start !== 'string' || typeof end !== 'string') return null
    const startTime = new Date(start).getTime()
    const endTime = new Date(end).getTime()
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null
    if (startTime >= endTime) return null
    if (startTime <= nowTime || startTime > maxTime) return null
    if (seen.has(start)) return null
    seen.add(start)
    slots.push({ start, end })
  }
  return slots.length >= 2 && slots.length <= 5 ? slots : null
}

function computeInvitationExpiry(now: Date, scheduledTime: Date | null, slots: TimeSlot[] | null): Date {
  let expiresAt = new Date(now.getTime())
  expiresAt.setDate(expiresAt.getDate() + 7)

  let latestSlotStart: Date | null = null
  if (scheduledTime) {
    latestSlotStart = scheduledTime
  } else if (slots && slots.length > 0) {
    const latestTime = Math.max(...slots.map((slot) => new Date(slot.start).getTime()))
    if (Number.isFinite(latestTime)) {
      latestSlotStart = new Date(latestTime)
    }
  }

  if (latestSlotStart) {
    const extendedExpiry = new Date(latestSlotStart.getTime())
    extendedExpiry.setDate(extendedExpiry.getDate() + 1)
    if (extendedExpiry.getTime() > expiresAt.getTime()) {
      expiresAt = extendedExpiry
    }
  }

  return expiresAt
}

export type CopilotRescheduleResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401 | 403 | 404 | 409 | 500; body: Record<string, unknown> }

export async function handleRescheduleCopilotInterview(body: unknown): Promise<CopilotRescheduleResponse> {
  try {
    const record = asRecord(body)
    if (!record) return { status: 400, body: { success: false, error: 'Invalid request body' } }

    const copilotInterviewId = getString(record, 'copilotInterviewId')
    const candidateId = getString(record, 'candidateId')
    const jobId = getString(record, 'jobId')
    const candidateEmail = getString(record, 'candidateEmail')
    const userId = getString(record, 'userId')

    const schedulingModeRaw = record.schedulingMode
    const schedulingMode: SchedulingMode = isValidSchedulingMode(schedulingModeRaw) ? schedulingModeRaw : 'instant'
    const scheduledAtRaw = getString(record, 'scheduledAt')
    const availableSlotsRaw = record.availableSlots
    const interviewerTimezone = getString(record, 'interviewerTimezone')
    const recordingEnabled = getBoolean(record, 'recordingEnabled')
    const interviewDurationRaw = record.interviewDuration

    if (!copilotInterviewId || !candidateId || !jobId) {
      return { status: 400, body: { success: false, error: 'Missing required fields' } }
    }

    if (!userId) {
      return { status: 401, body: { success: false, error: 'Unauthorized' } }
    }

    if (!isUuid(copilotInterviewId) || !isUuid(candidateId) || !isUuid(jobId)) {
      return { status: 400, body: { success: false, error: 'Invalid IDs' } }
    }

    if (!isUuid(userId)) {
      return { status: 400, body: { success: false, error: 'Invalid userId' } }
    }

    const now = new Date()
    const maxDate = new Date(now.getTime() + MAX_SCHEDULING_DAYS * 24 * 60 * 60 * 1000)
    const parsedSlots = schedulingMode === 'candidate_choice' ? parseTimeSlots(availableSlotsRaw, now, maxDate) : null
    const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : null

    if (schedulingMode === 'scheduled') {
      if (!scheduledAt || !Number.isFinite(scheduledAt.getTime())) {
        return { status: 400, body: { success: false, error: 'scheduledAt is required for scheduled mode and must be a valid ISO8601 date' } }
      }
      if (scheduledAt.getTime() <= now.getTime()) {
        return { status: 400, body: { success: false, error: 'scheduledAt must be in the future' } }
      }
      if (scheduledAt.getTime() > maxDate.getTime()) {
        return { status: 400, body: { success: false, error: `scheduledAt must be within ${MAX_SCHEDULING_DAYS} days` } }
      }
    }

    if (schedulingMode === 'candidate_choice') {
      if (!parsedSlots) {
        return { status: 400, body: { success: false, error: 'availableSlots must be an array of 2-5 time slots with start and end ISO8601 dates' } }
      }
    }

    let finalInterviewDuration: number | null = null
    if (interviewDurationRaw !== undefined && interviewDurationRaw !== null) {
      if (!isAllowedInterviewDurationMinutes(interviewDurationRaw)) {
        return { status: 400, body: { success: false, error: 'Interview duration must be 15, 20, 30, 45, or 60 minutes' } }
      }
      finalInterviewDuration = normalizeInterviewDurationMinutes(interviewDurationRaw)
    }

    const adminSupabase = createAdminClient()

    const { data: target, error: targetError } = await adminSupabase
      .from('copilot_interviews')
      .select('id, interview_id, company_id, candidate_id, job_id, room_status, confirmation_token, livekit_room_name')
      .eq('id', copilotInterviewId)
      .single()

    if (targetError || !target) {
      return { status: 404, body: { success: false, error: 'Interview not found' } }
    }

    if ((target as { candidate_id: string }).candidate_id !== candidateId) {
      return { status: 403, body: { success: false, error: 'Unauthorized' } }
    }

    if ((target as { job_id: string }).job_id !== jobId) {
      return { status: 403, body: { success: false, error: 'Unauthorized' } }
    }

    const { data: isMember } = await adminSupabase
      .from('company_members')
      .select('id')
      .eq('company_id', (target as { company_id: string }).company_id)
      .eq('user_id', userId)
      .single()

    if (!isMember) {
      return { status: 403, body: { success: false, error: 'Unauthorized' } }
    }

    const roomStatus = (target as { room_status: string }).room_status
    if (['completed', 'cancelled', 'missed', 'in_progress', 'both_ready'].includes(roomStatus)) {
      return { status: 409, body: { success: false, error: 'Interview cannot be rescheduled after it has started or ended' } }
    }

    let scheduledTime: Date | null = null
    if (schedulingMode === 'scheduled' && scheduledAt) {
      scheduledTime = scheduledAt
    } else if (schedulingMode === 'instant') {
      scheduledTime = now
    }

    const availableSlots = schedulingMode === 'candidate_choice' ? parsedSlots : null
    const expiresAt = computeInvitationExpiry(now, scheduledTime, availableSlots)

    const updatePayload: Record<string, unknown> = {
      scheduling_mode: schedulingMode,
      scheduled_at: scheduledTime ? scheduledTime.toISOString() : null,
      available_slots: availableSlots,
      interviewer_timezone: interviewerTimezone || null,
      invitation_expires_at: expiresAt.toISOString(),
      candidate_confirmed: false,
      candidate_confirmed_at: null,
      schedule_confirmed_at: null,
      reminder_sent_24h: false,
      reminder_sent_1h: false,
      candidate_access_token: null,
      candidate_access_token_expires: null,
      room_status: 'waiting_both',
      interviewer_joined_at: null,
      candidate_joined_at: null,
      updated_at: now.toISOString(),
    }

    if (recordingEnabled !== null) {
      updatePayload.recording_enabled = recordingEnabled
    }

    if (candidateEmail) {
      updatePayload.candidate_email = candidateEmail
    }

    const { data: updatedInterview, error: updateError } = await adminSupabase
      .from('copilot_interviews')
      .update(updatePayload)
      .eq('id', copilotInterviewId)
      .select(
        'id, interview_id, scheduled_at, invitation_expires_at, livekit_room_name, confirmation_token, scheduling_mode, available_slots, interviewer_timezone, recording_enabled'
      )
      .single()

    if (updateError || !updatedInterview) {
      console.error('Failed to reschedule AI interview:', updateError)
      return { status: 500, body: { success: false, error: 'Failed to reschedule interview' } }
    }

    await adminSupabase
      .from('copilot_interview_participants')
      .update({ joined_at: null })
      .eq('copilot_interview_id', copilotInterviewId)

    if (finalInterviewDuration !== null || recordingEnabled !== null) {
      const interviewUpdate: Record<string, unknown> = {}
      if (finalInterviewDuration !== null) {
        interviewUpdate.interview_duration = finalInterviewDuration
      }
      if (recordingEnabled !== null) {
        interviewUpdate.recording_enabled = recordingEnabled
      }
      const interviewId = (updatedInterview as { interview_id: string }).interview_id
      await adminSupabase
        .from('interviews')
        .update(interviewUpdate)
        .eq('id', interviewId)
    }

    const baseUrl = getAppPublicUrl()
    const confirmationToken = (updatedInterview as { confirmation_token?: string | null }).confirmation_token
    const confirmationUrl = confirmationToken ? `${baseUrl}/copilot-interview/confirm/${confirmationToken}` : null

    return {
      status: 200,
      body: {
        success: true,
        data: {
          copilotInterviewId: (updatedInterview as { id: string }).id,
          interviewId: (updatedInterview as { interview_id: string }).interview_id,
          confirmationUrl,
          interviewerUrl: `${baseUrl}/copilot-interview/${copilotInterviewId}/interviewer`,
          candidateUrl: `${baseUrl}/copilot-interview/${copilotInterviewId}/candidate`,
          scheduledAt: (updatedInterview as { scheduled_at?: string | null }).scheduled_at,
          expiresAt: (updatedInterview as { invitation_expires_at?: string | null }).invitation_expires_at,
          roomName: (updatedInterview as { livekit_room_name?: string | null }).livekit_room_name,
          schedulingMode: (updatedInterview as { scheduling_mode?: SchedulingMode | null }).scheduling_mode || schedulingMode,
          availableSlots: (updatedInterview as { available_slots?: TimeSlot[] | null }).available_slots || availableSlots,
          interviewerTimezone: (updatedInterview as { interviewer_timezone?: string | null }).interviewer_timezone || null,
        },
      },
    }
  } catch (error) {
    console.error('Reschedule AI interview error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}
