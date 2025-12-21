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

    const scheduledTime = new Date()

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
      .not('room_status', 'in', '(completed,cancelled)')
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

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

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
          scheduled_at: scheduledTime.toISOString(),
          invitation_expires_at: expiresAt.toISOString(),
          confirmation_token: tokenForAttempt,
          interviewer_email: user.email,
          candidate_email: candidateEmail,
          livekit_room_name: roomName,
          ai_enabled: true,
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
    const scheduledAt = (copilotInterview as { scheduled_at?: string | null }).scheduled_at ?? scheduledTime.toISOString()

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
            scheduledAt,
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
          scheduledAt,
          expiresAt: (copilotInterview as { invitation_expires_at?: string | null }).invitation_expires_at,
          roomName,
          invitedInterviewers: validInterviewerIds,
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
        'id, interview_id, interviewer_id, room_status, scheduled_at, candidate_confirmed, invitation_expires_at, livekit_room_name, created_at'
      )
      .eq('candidate_id', candidateId)

    if (!includeAll) {
      query = query.not('room_status', 'in', '(completed,cancelled)')
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

        interviewWithParticipants = { ...baseInterview, participants: enrichedParticipants }
      }
    }

    return { status: 200, body: { success: true, data: interviewWithParticipants } }
  } catch (error) {
    console.error('Get active AI interview error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}
