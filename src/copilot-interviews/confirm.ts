import { getAppPublicUrl } from '../config'
import { sendInterviewConfirmedEmail } from '../email'
import { createAdminClient } from '../supabase/admin'
import { asRecord, getString, getNumber } from '../utils/parse'

interface TimeSlot {
  start: string
  end: string
}

export type CopilotConfirmPostResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 404 | 410 | 500; body: Record<string, unknown> }

export async function handleConfirmCopilotInterview(token: string, body?: unknown): Promise<CopilotConfirmPostResponse> {
  try {
    const adminSupabase = createAdminClient()
    const now = new Date()

    if (!token) {
      return { status: 400, body: { success: false, error: 'Invalid confirmation token' } }
    }

    // Parse optional body for selectedSlotIndex and candidateTimezone
    const record = asRecord(body)
    const selectedSlotIndex = record ? getNumber(record, 'selectedSlotIndex') : null
    const candidateTimezone = record ? getString(record, 'candidateTimezone') : null
    const candidateLocale = record ? getString(record, 'candidateLocale') : null

    const { data: target, error: targetError } = await adminSupabase
      .from('copilot_interviews')
      .select('id, invitation_expires_at, candidate_confirmed, scheduling_mode, available_slots, scheduled_at, room_status')
      .eq('confirmation_token', token)
      .single()

    if (targetError || !target) {
      return { status: 404, body: { success: false, error: 'Invalid confirmation token' } }
    }

    const expiresAt = (target as { invitation_expires_at?: string | null }).invitation_expires_at
    if (!expiresAt) {
      return { status: 400, body: { success: false, error: 'Invitation missing expiry time' } }
    }

    const roomStatus = (target as { room_status?: string | null }).room_status
    if (roomStatus === 'cancelled') {
      return { status: 410, body: { success: false, error: 'Interview has been cancelled', code: 'INTERVIEW_CANCELLED' } }
    }
    if (roomStatus === 'completed') {
      return { status: 410, body: { success: false, error: 'Interview has already been completed', code: 'INTERVIEW_COMPLETED' } }
    }
    if (roomStatus === 'missed') {
      return { status: 410, body: { success: false, error: 'Interview has been marked as missed', code: 'INTERVIEW_MISSED' } }
    }

    if (new Date(expiresAt) < now) {
      return { status: 410, body: { success: false, error: 'Invitation expired', code: 'INVITATION_EXPIRED' } }
    }

    const aiInterviewId = (target as { id: string }).id
    const alreadyConfirmed = Boolean((target as { candidate_confirmed?: boolean | null }).candidate_confirmed)
    const schedulingMode = (target as { scheduling_mode?: string }).scheduling_mode || 'instant'
    const availableSlots = (target as { available_slots?: TimeSlot[] | null }).available_slots
    const scheduledAtValue = (target as { scheduled_at?: string | null }).scheduled_at
    const scheduledAt = scheduledAtValue ? new Date(scheduledAtValue) : null
    const windowMinutes = 15
    const windowMs = windowMinutes * 60 * 1000

    if (schedulingMode === 'scheduled') {
      if (!scheduledAt || !Number.isFinite(scheduledAt.getTime())) {
        return { status: 400, body: { success: false, error: 'Interview time not scheduled', code: 'NO_SCHEDULED_TIME' } }
      }
      const windowEnd = new Date(scheduledAt.getTime() + windowMs)
      if (now > windowEnd) {
        return { status: 410, body: { success: false, error: 'Interview time window has closed', code: 'INTERVIEW_WINDOW_CLOSED' } }
      }
    }

    if (schedulingMode === 'candidate_choice' && scheduledAt) {
      const windowEnd = new Date(scheduledAt.getTime() + windowMs)
      if (now > windowEnd) {
        return { status: 410, body: { success: false, error: 'Interview time window has closed', code: 'INTERVIEW_WINDOW_CLOSED' } }
      }
    }

    // For candidate_choice mode, require a slot selection if not already confirmed
    if (!alreadyConfirmed && schedulingMode === 'candidate_choice') {
      if (selectedSlotIndex === null || selectedSlotIndex === undefined) {
        return { status: 400, body: { success: false, error: 'Please select a time slot' } }
      }
      if (!availableSlots || !Array.isArray(availableSlots) || selectedSlotIndex < 0 || selectedSlotIndex >= availableSlots.length) {
        return { status: 400, body: { success: false, error: 'Invalid time slot selection' } }
      }
      const selectedSlot = availableSlots[selectedSlotIndex]
      const slotStart = new Date(selectedSlot.start)
      if (!Number.isFinite(slotStart.getTime())) {
        return { status: 400, body: { success: false, error: 'Invalid time slot selection' } }
      }
      const slotWindowEnd = new Date(slotStart.getTime() + windowMs)
      if (now > slotWindowEnd) {
        return { status: 410, body: { success: false, error: 'Selected time slot has passed', code: 'SLOT_WINDOW_CLOSED' } }
      }
    }

    if (!alreadyConfirmed) {
      const selectedSlot = schedulingMode === 'candidate_choice' && availableSlots && selectedSlotIndex !== null
        ? availableSlots[selectedSlotIndex]
        : null

      const updateData: Record<string, unknown> = {
        candidate_confirmed: true,
        candidate_confirmed_at: new Date().toISOString(),
      }

      // Set scheduled_at for candidate_choice mode
      if (selectedSlot) {
        updateData.scheduled_at = selectedSlot.start
        updateData.schedule_confirmed_at = new Date().toISOString()
      } else if (schedulingMode === 'scheduled') {
        updateData.schedule_confirmed_at = new Date().toISOString()
      }

      // Store candidate timezone if provided
      if (candidateTimezone) {
        updateData.candidate_timezone = candidateTimezone
      }

      const { error: confirmError } = await adminSupabase
        .from('copilot_interviews')
        .update(updateData)
        .eq('id', aiInterviewId)

      if (confirmError) {
        console.error('Failed to confirm AI interview:', confirmError)
        return { status: 500, body: { success: false, error: 'Failed to confirm interview' } }
      }
    }

    const { data: copilotInterview, error: fetchError } = await adminSupabase
      .from('copilot_interviews')
      .select(
        `
        id,
        scheduled_at,
        candidate_timezone,
        interview_id,
        candidate_id,
        job_id,
        company_id,
        interviews(id, interview_duration),
        candidates(id, name, email),
        jobs(id, title),
        companies(id, name)
      `
      )
      .eq('id', aiInterviewId)
      .single()

    if (fetchError || !copilotInterview) {
      console.error('Failed to fetch interview details:', fetchError)
      return { status: 500, body: { success: false, error: 'Failed to fetch interview details' } }
    }

    const accessToken = `candidate_${aiInterviewId}_${Date.now()}_${Math.random().toString(36).substring(7)}`

    const scheduledTime = (copilotInterview as { scheduled_at?: string | null }).scheduled_at
      ? new Date((copilotInterview as { scheduled_at: string }).scheduled_at)
      : new Date()
    const expiryTime = new Date(scheduledTime)
    expiryTime.setHours(expiryTime.getHours() + 2)

    const { error: accessTokenError } = await adminSupabase
      .from('copilot_interviews')
      .update({
        candidate_access_token: accessToken,
        candidate_access_token_expires: expiryTime.toISOString(),
      })
      .eq('id', aiInterviewId)

    if (accessTokenError) {
      console.error('Failed to set candidate access token:', accessTokenError)
      return { status: 500, body: { success: false, error: 'Failed to issue access token' } }
    }

    if (!alreadyConfirmed && schedulingMode !== 'instant') {
      const candidate = (copilotInterview as { candidates?: { name?: string | null; email?: string | null } | null }).candidates
      const job = (copilotInterview as { jobs?: { title?: string | null } | null }).jobs
      const company = (copilotInterview as { companies?: { name?: string | null } | null }).companies
      const interviewDuration =
        (copilotInterview as { interviews?: { interview_duration?: number | null } | null }).interviews?.interview_duration || 30
      const candidateTimezoneValue = (copilotInterview as { candidate_timezone?: string | null }).candidate_timezone || candidateTimezone
      const scheduledAt = (copilotInterview as { scheduled_at?: string | null }).scheduled_at

      if (candidate?.email && job?.title && company?.name && scheduledAt) {
        const normalizedLocale = candidateLocale ? candidateLocale.split('-')[0] : null
        const locale: 'en' | 'zh' | 'es' | 'fr' =
          normalizedLocale === 'zh' || normalizedLocale === 'en' || normalizedLocale === 'es' || normalizedLocale === 'fr'
            ? normalizedLocale
            : candidateTimezoneValue?.startsWith('Asia')
              ? 'zh'
              : 'en'
        const baseUrl = getAppPublicUrl()
        const joinLink = `${baseUrl}/copilot-interview/${aiInterviewId}/candidate`

        try {
          await sendInterviewConfirmedEmail({
            to: candidate.email,
            candidateName: candidate.name || 'Candidate',
            jobTitle: job.title,
            companyName: company.name,
            joinLink,
            scheduledAt,
            duration: interviewDuration,
            candidateTimezone: candidateTimezoneValue || undefined,
            locale,
          })
        } catch (emailError) {
          console.error('Failed to send confirmation email:', emailError)
        }
      }
    }

    return {
      status: 200,
      body: {
        success: true,
        data: {
          copilotInterviewId: aiInterviewId,
          interview: copilotInterview,
          accessToken,
        },
      },
    }
  } catch (error) {
    console.error('Confirm interview error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

export type CopilotConfirmGetResponse =
  | { status: 200; body: { success: true; data: unknown } }
  | { status: 400 | 404 | 410 | 500; body: { success: false; error: string; code?: string } }

export async function handleGetCopilotConfirmInfo(token: string): Promise<CopilotConfirmGetResponse> {
  try {
    const adminSupabase = createAdminClient()
    const now = new Date()

    const { data: copilotInterview, error } = await adminSupabase
      .from('copilot_interviews')
      .select(
        `
        id,
        confirmation_token,
        invitation_expires_at,
        scheduled_at,
        candidate_confirmed,
        room_status,
        interview_id,
        candidate_id,
        job_id,
        company_id,
        scheduling_mode,
        available_slots,
        interviewer_timezone,
        candidate_timezone,
        interviews(id),
        candidates(id, name, email),
        jobs(id, title, description),
        companies(id, name)
      `
      )
      .eq('confirmation_token', token)
      .single()

    if (error || !copilotInterview) {
      console.error('Get confirmation info error:', error)
      return { status: 404, body: { success: false, error: 'Invalid confirmation token' } }
    }

    const expiresAt = (copilotInterview as { invitation_expires_at?: string | null }).invitation_expires_at
    const scheduledAt = (copilotInterview as { scheduled_at?: string | null }).scheduled_at
    const schedulingMode = (copilotInterview as { scheduling_mode?: string }).scheduling_mode || 'instant'
    const roomStatus = (copilotInterview as { room_status?: string | null }).room_status

    if (!expiresAt) {
      return { status: 400, body: { success: false, error: 'Invitation missing expiry time' } }
    }

    // For instant and scheduled mode, require scheduled_at
    // For candidate_choice mode, scheduled_at can be null (candidate will select)
    if (schedulingMode !== 'candidate_choice' && !scheduledAt) {
      return { status: 400, body: { success: false, error: 'Interview not scheduled' } }
    }

    if (roomStatus === 'cancelled') {
      return { status: 410, body: { success: false, error: 'Interview has been cancelled', code: 'INTERVIEW_CANCELLED' } }
    }
    if (roomStatus === 'completed') {
      return { status: 410, body: { success: false, error: 'Interview has already been completed', code: 'INTERVIEW_COMPLETED' } }
    }
    if (roomStatus === 'missed') {
      return { status: 410, body: { success: false, error: 'Interview has been marked as missed', code: 'INTERVIEW_MISSED' } }
    }

    if (new Date(expiresAt) < now) {
      return { status: 410, body: { success: false, error: 'Invitation expired', code: 'INVITATION_EXPIRED' } }
    }

    if (scheduledAt && schedulingMode !== 'instant') {
      const scheduledDate = new Date(scheduledAt)
      if (Number.isFinite(scheduledDate.getTime())) {
        const windowEnd = new Date(scheduledDate.getTime() + 15 * 60 * 1000)
        if (now > windowEnd) {
          return { status: 410, body: { success: false, error: 'Interview time window has closed', code: 'INTERVIEW_WINDOW_CLOSED' } }
        }
      }
    }

    return { status: 200, body: { success: true, data: copilotInterview } }
  } catch (error) {
    console.error('Get confirmation info error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}
