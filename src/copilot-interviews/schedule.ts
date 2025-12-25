import { randomBytes } from 'node:crypto'
import { getAppPublicUrl } from '../config'
import { sendInterviewerInvitationEmail } from '../email'
import { INTERVIEW_MODES } from '../interview/modes'
import {
  DEFAULT_INTERVIEW_DURATION_MINUTES,
  isAllowedInterviewDurationMinutes,
  normalizeInterviewDurationMinutes,
} from '../interviews/constants'
import { createAdminClient } from '../supabase/admin'
import { asRecord, getString } from '../utils/parse'

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function generateConfirmationToken(): string {
  return randomBytes(32).toString('hex')
}

// Scheduling mode types
type SchedulingMode = 'instant' | 'scheduled' | 'candidate_choice'

interface TimeSlot {
  start: string // ISO8601
  end: string // ISO8601
}

const MAX_SCHEDULING_DAYS = 30

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

type CopilotInterviewBase = {
  id: string
  interview_id: string
  interviewer_id: string
  room_status: string
  scheduled_at: string | null
  candidate_confirmed: boolean | null
  invitation_expires_at: string | null
  livekit_room_name: string | null
  created_at: string | null
  confirmation_token: string | null
  confirmation_url?: string | null
  scheduling_mode: SchedulingMode
  available_slots: TimeSlot[] | null
  interviewer_timezone: string | null
  candidate_timezone: string | null
}

type CopilotInterviewParticipantRow = {
  user_id: string
  participant_index: number
  joined_at: string | null
}

type CopilotInterviewParticipantEnriched = CopilotInterviewParticipantRow & {
  email?: string
  full_name?: string
}

type CopilotInterviewWithParticipants = CopilotInterviewBase & {
  participants?: CopilotInterviewParticipantEnriched[]
}

export type CopilotScheduleResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401 | 403 | 404 | 409 | 500; body: Record<string, unknown> }

export async function handleScheduleCopilotInterview(body: unknown): Promise<CopilotScheduleResponse> {
  try {
    const record = asRecord(body)
    if (!record) return { status: 400, body: { success: false, error: 'Invalid request body' } }

    const candidateId = getString(record, 'candidateId')
    const jobId = getString(record, 'jobId')
    const candidateEmail = getString(record, 'candidateEmail')
    const userId = getString(record, 'userId')

    // Scheduling parameters
    const schedulingModeRaw = record.schedulingMode
    const schedulingMode: SchedulingMode = isValidSchedulingMode(schedulingModeRaw) ? schedulingModeRaw : 'instant'
    const scheduledAtRaw = getString(record, 'scheduledAt')
    const availableSlotsRaw = record.availableSlots
    const interviewerTimezone = getString(record, 'interviewerTimezone')
    const now = new Date()
    const maxDate = new Date(now.getTime() + MAX_SCHEDULING_DAYS * 24 * 60 * 60 * 1000)
    const parsedSlots = schedulingMode === 'candidate_choice' ? parseTimeSlots(availableSlotsRaw, now, maxDate) : null
    const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : null

    // Validate scheduling parameters
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

    const interviewerIdsValue = record.interviewerIds
    const interviewerIds = Array.isArray(interviewerIdsValue)
      ? interviewerIdsValue
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim())
          .filter((v) => v.length > 0 && isUuid(v))
      : null

    const interviewDurationRaw = record.interviewDuration

    if (!candidateId || !jobId || !candidateEmail) {
      return { status: 400, body: { success: false, error: 'Missing required fields' } }
    }

    if (!userId) {
      return { status: 401, body: { success: false, error: 'Unauthorized' } }
    }

    if (!isUuid(candidateId) || !isUuid(jobId)) {
      return { status: 400, body: { success: false, error: 'Invalid candidateId or jobId' } }
    }

    if (!isUuid(userId)) {
      console.warn('[Copilot Schedule] Invalid userId:', userId)
      return { status: 400, body: { success: false, error: 'Invalid userId' } }
    }

    if (interviewerIds && interviewerIds.length > 2) {
      return {
        status: 400,
        body: { success: false, error: 'interviewerIds must be an array with max 2 additional interviewers' },
      }
    }

    if (interviewDurationRaw !== undefined && interviewDurationRaw !== null && !isAllowedInterviewDurationMinutes(interviewDurationRaw)) {
      return { status: 400, body: { success: false, error: 'Interview duration must be 15, 30, 45, or 60 minutes' } }
    }

    const finalInterviewDuration =
      interviewDurationRaw !== undefined && interviewDurationRaw !== null
        ? normalizeInterviewDurationMinutes(interviewDurationRaw)
        : DEFAULT_INTERVIEW_DURATION_MINUTES

    const adminSupabase = createAdminClient()

    const { data: userData, error: userError } = await adminSupabase.auth.admin.getUserById(userId)
    if (userError || !userData?.user) {
      return { status: 401, body: { success: false, error: 'Unauthorized' } }
    }

    const user = userData.user
    const creatorName = (user.user_metadata?.full_name as string | undefined) || user.email || 'A colleague'

    // Determine scheduled time based on scheduling mode
    let scheduledTime: Date | null = null
    if (schedulingMode === 'scheduled' && scheduledAt) {
      scheduledTime = scheduledAt
    } else if (schedulingMode === 'instant') {
      scheduledTime = now
    }
    // For candidate_choice, scheduledTime remains null until candidate selects a slot

    const availableSlots = schedulingMode === 'candidate_choice' ? parsedSlots : null

    const { data: candidate, error: candidateError } = await adminSupabase
      .from('candidates')
      .select('id, job_id, name, email')
      .eq('id', candidateId)
      .single()

    if (candidateError || !candidate) {
      return { status: 404, body: { success: false, error: 'Candidate not found' } }
    }

    const { data: job, error: jobError } = await adminSupabase
      .from('jobs')
      .select('id, title, company_id')
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      return { status: 404, body: { success: false, error: 'Job not found' } }
    }

    const companyId = (job as { company_id: string }).company_id

    const { data: isMember } = await adminSupabase
      .from('company_members')
      .select('id')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .single()

    if (!isMember) {
      return { status: 403, body: { success: false, error: 'Unauthorized: You are not a member of this company' } }
    }

    const { data: activeInterviews } = await adminSupabase
      .from('copilot_interviews')
      .select('id, interview_id, room_status, scheduled_at, created_at')
      .eq('candidate_id', candidateId)
      .not('room_status', 'in', '(completed,cancelled,missed)')
      .order('created_at', { ascending: false })
      .limit(1)

    if (activeInterviews && activeInterviews.length > 0) {
      return {
        status: 409,
        body: { success: false, error: 'Candidate already has an active AI interview', data: activeInterviews[0] },
      }
    }

    const { data: interview, error: interviewError } = await adminSupabase
      .from('interviews')
      .insert({
        candidate_id: candidateId,
        job_id: jobId,
        company_id: companyId,
        status: 'pending',
        interview_mode: INTERVIEW_MODES.ASSISTED_VIDEO,
        interview_duration: finalInterviewDuration,
      })
      .select()
      .single()

    if (interviewError || !interview) {
      console.error('Interview insert error:', interviewError)
      return { status: 500, body: { success: false, error: 'Failed to create interview record' } }
    }

    const interviewId = (interview as { id: string }).id
    let confirmationToken = generateConfirmationToken()

    let expiresAt = new Date(now.getTime())
    expiresAt.setDate(expiresAt.getDate() + 7)
    let latestSlotStart: Date | null = null
    if (scheduledTime) {
      latestSlotStart = scheduledTime
    } else if (availableSlots && availableSlots.length > 0) {
      const latestTime = Math.max(...availableSlots.map((slot) => new Date(slot.start).getTime()))
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

    const roomName = `ai-interview-${interviewId}`

    let copilotInterview: unknown | null = null
    let copilotInterviewError: unknown | null = null

    for (let attempt = 0; attempt < 3; attempt++) {
      const tokenForAttempt = attempt === 0 ? confirmationToken : generateConfirmationToken()

      const { data, error } = await adminSupabase
        .from('copilot_interviews')
        .insert({
          interview_id: interviewId,
          interviewer_id: userId,
          candidate_id: candidateId,
          job_id: jobId,
          company_id: companyId,
          room_status: 'waiting_both',
          scheduled_at: scheduledTime ? scheduledTime.toISOString() : null,
          invitation_expires_at: expiresAt.toISOString(),
          confirmation_token: tokenForAttempt,
          interviewer_email: user.email,
          candidate_email: candidateEmail,
          livekit_room_name: roomName,
          ai_enabled: true,
          // New scheduling fields
          scheduling_mode: schedulingMode,
          available_slots: availableSlots,
          interviewer_timezone: interviewerTimezone || null,
        })
        .select()
        .single()

      if (!error && data) {
        copilotInterview = data
        copilotInterviewError = null
        confirmationToken = tokenForAttempt
        break
      }

      copilotInterviewError = error

      const errorCode = (error as { code?: string } | null)?.code
      if (errorCode !== '23505') {
        break
      }
    }

    if (copilotInterviewError || !copilotInterview) {
      console.error('AI interview insert error:', copilotInterviewError)
      await adminSupabase.from('interviews').delete().eq('id', interviewId)
      return { status: 500, body: { success: false, error: 'Failed to create AI interview record' } }
    }

    const baseUrl = getAppPublicUrl()
    const confirmationUrl = `${baseUrl}/copilot-interview/confirm/${confirmationToken}`
    const interviewerUrl = `${baseUrl}/copilot-interview/${(copilotInterview as { id: string }).id}/interviewer`
    const candidateUrl = `${baseUrl}/copilot-interview/${(copilotInterview as { id: string }).id}/candidate`
    const scheduledAtForEmail = (copilotInterview as { scheduled_at?: string | null }).scheduled_at ?? (scheduledTime ? scheduledTime.toISOString() : null)

    const participantsToCreate: Array<{ copilot_interview_id: string; user_id: string; participant_index: number }> = [
      { copilot_interview_id: (copilotInterview as { id: string }).id, user_id: userId, participant_index: 0 },
    ]

    const validInterviewerIds: string[] = []
    if (interviewerIds && interviewerIds.length > 0) {
      const { data: members } = await adminSupabase
        .from('company_members')
        .select('user_id')
        .eq('company_id', companyId)
        .in('user_id', interviewerIds)

      const memberUserIds = new Set((members || []).map((m) => (m as { user_id: string }).user_id))
      let nextParticipantIndex = 1

      interviewerIds.forEach((interviewerId) => {
        if (interviewerId !== userId && memberUserIds.has(interviewerId)) {
          validInterviewerIds.push(interviewerId)
          participantsToCreate.push({
            copilot_interview_id: (copilotInterview as { id: string }).id,
            user_id: interviewerId,
            participant_index: nextParticipantIndex,
          })
          nextParticipantIndex++
        }
      })
    }

    if (participantsToCreate.length > 0) {
      const { error: participantsError } = await adminSupabase.from('copilot_interview_participants').insert(participantsToCreate)
      if (participantsError) {
        console.error('Failed to create participant records:', participantsError)
      }
    }

    if (validInterviewerIds.length > 0) {
      const jobTitle = (job as { title?: string | null }).title || 'Position'
      const candidateName = (candidate as { name?: string | null }).name || 'Candidate'

      const emailResults = await Promise.allSettled(
        validInterviewerIds.map(async (interviewerId) => {
          const { data: invitedUserData, error: invitedUserError } = await adminSupabase.auth.admin.getUserById(interviewerId)
          const email = invitedUserData?.user?.email
          if (invitedUserError || !email) {
            throw new Error(`User not found: ${interviewerId}`)
          }

          const invitedUser = invitedUserData.user
          const locale = (invitedUser.user_metadata?.locale as string | undefined) || 'en'
          await sendInterviewerInvitationEmail({
            to: email,
            interviewerName:
              (invitedUser.user_metadata?.full_name as string | undefined) || email.split('@')[0] || 'Interviewer',
            candidateName,
            jobTitle,
            invitedBy: creatorName,
            interviewerUrl,
            scheduledAt: scheduledAtForEmail,
            interviewerTimezone: interviewerTimezone || null,
            locale,
          })
        })
      )

      emailResults.forEach((result, idx) => {
        if (result.status === 'rejected') {
          console.error(`[Copilot Schedule] Failed to send email to user ${validInterviewerIds[idx]}:`, result.reason)
        }
      })
    }

    const { error: candidateStatusError } = await adminSupabase
      .from('candidates')
      .update({ status: 'interviewing', interview_mode: INTERVIEW_MODES.ASSISTED_VIDEO })
      .eq('id', candidateId)

    if (candidateStatusError) {
      console.error('Failed to update candidate status after scheduling AI interview:', candidateStatusError)
    }

    return {
      status: 200,
      body: {
        success: true,
        data: {
          copilotInterviewId: (copilotInterview as { id: string }).id,
          interviewId,
          confirmationToken,
          confirmationUrl,
          interviewerUrl,
          candidateUrl,
          scheduledAt: scheduledAtForEmail,
          expiresAt: (copilotInterview as { invitation_expires_at?: string | null }).invitation_expires_at,
          roomName,
          invitedInterviewers: validInterviewerIds,
          // New scheduling fields
          schedulingMode,
          availableSlots,
          interviewerTimezone: interviewerTimezone || null,
        },
      },
    }
  } catch (error) {
    console.error('Schedule AI interview error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

export type CopilotScheduleGetResponse =
  | { status: 200; body: { success: true; data: CopilotInterviewWithParticipants | null } }
  | { status: 400 | 500; body: { success: false; error: string } }

export async function handleGetCopilotSchedule(
  candidateId: string,
  includeAll: boolean
): Promise<CopilotScheduleGetResponse> {
  try {
    if (!candidateId) {
      return { status: 400, body: { success: false, error: 'candidateId is required' } }
    }

    const adminSupabase = createAdminClient()

    let query = adminSupabase
      .from('copilot_interviews')
      .select(
        'id, interview_id, interviewer_id, room_status, scheduled_at, candidate_confirmed, invitation_expires_at, livekit_room_name, created_at, confirmation_token, scheduling_mode, available_slots, interviewer_timezone, candidate_timezone'
      )
      .eq('candidate_id', candidateId)

    if (!includeAll) {
      query = query.not('room_status', 'in', '(completed,cancelled,missed)')
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(1)
      .returns<CopilotInterviewBase[]>()

    if (error) {
      console.error('Get active AI interview error:', error)
      return { status: 500, body: { success: false, error: error.message } }
    }

    const baseInterview = data && data.length > 0 ? data[0] : null
    let interviewWithParticipants: CopilotInterviewWithParticipants | null = baseInterview

    if (baseInterview) {
      const baseUrl = getAppPublicUrl()
      const confirmationUrl = baseInterview.confirmation_token
        ? `${baseUrl}/copilot-interview/confirm/${baseInterview.confirmation_token}`
        : null
      interviewWithParticipants = { ...baseInterview, confirmation_url: confirmationUrl }

      const { data: participants } = await adminSupabase
        .from('copilot_interview_participants')
        .select('user_id, participant_index, joined_at')
        .eq('copilot_interview_id', baseInterview.id)
        .order('participant_index', { ascending: true })
        .returns<CopilotInterviewParticipantRow[]>()

      if (participants && participants.length > 0) {
        const enrichedParticipants: CopilotInterviewParticipantEnriched[] = await Promise.all(
          participants.map(async (p) => {
            try {
              const { data: userData, error: userError } = await adminSupabase.auth.admin.getUserById(p.user_id)
              if (userError) {
                console.error(`[Schedule GET] Error fetching user ${p.user_id}:`, userError)
              }
              const email = userData?.user?.email
              const fullName = (userData?.user?.user_metadata?.full_name as string | undefined) || undefined

              return {
                ...p,
                email,
                full_name: fullName || email?.split('@')[0],
              }
            } catch (err) {
              console.error(`[Schedule GET] Exception fetching user ${p.user_id}:`, err)
              return { ...p, email: undefined, full_name: undefined }
            }
          })
        )

        interviewWithParticipants = {
          ...(interviewWithParticipants || baseInterview),
          participants: enrichedParticipants,
        }
      }
    }

    return { status: 200, body: { success: true, data: interviewWithParticipants } }
  } catch (error) {
    console.error('Get active AI interview error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}
