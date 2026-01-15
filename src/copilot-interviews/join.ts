import { createCandidateToken, createInterviewerToken } from '../livekit/ai-interview-token'
import {
  getLiveKitConfigForRegion,
  getRegionFromCountry,
  selectRegionWithFallback,
  type LiveKitRegion,
} from '../livekit/geo-routing'
import { removeParticipantIfExistsForRegion } from '../livekit/rooms'
import { normalizeInterviewDurationMinutes } from '../interviews/constants'
import { createAdminClient } from '../supabase/admin'
import { asRecord, getOptionalString, getString } from '../utils/parse'
import {
  addInterviewer,
  candidateJoinRoom,
  getCopilotInterviewState,
  getInterviewParticipants,
  interviewerJoinRoom,
} from './manager'

type JoinRole = 'interviewer' | 'candidate'

export type CopilotJoinResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401 | 403 | 404 | 410 | 500; body: Record<string, unknown> }

function parseRole(value: unknown): JoinRole | null {
  return value === 'interviewer' || value === 'candidate' ? value : null
}

function parseRegion(value: unknown): LiveKitRegion | null {
  return value === 'self-hosted' || value === 'cloud' ? value : null
}

export async function handleJoinCopilotInterview(
  copilotInterviewId: string,
  body: unknown
): Promise<CopilotJoinResponse> {
  try {
    const record = asRecord(body) ?? {}
    const role = parseRole(record.role)
    if (!role) {
      return { status: 400, body: { error: 'Invalid role. Must be "interviewer" or "candidate"' } }
    }

    const userId = getOptionalString(record, 'userId')
    const countryCode = getOptionalString(record, 'countryCode')

    const adminSupabase = createAdminClient()

    const stateResult = await getCopilotInterviewState(copilotInterviewId, adminSupabase)
    if (!stateResult.success || !stateResult.data) {
      return { status: 404, body: { error: 'AI interview not found' } }
    }

    const copilotInterview = stateResult.data as {
      company_id: string
      candidate_id: string
      interview_id: string
      room_status: string
      livekit_room_name: string | null
      livekit_region: LiveKitRegion | null
      scheduling_mode: string | null
      scheduled_at: string | null
      candidate_confirmed: boolean | null
      recording_enabled?: boolean | null
      candidate_recording_consent?: boolean | null
    }

    const isScheduledMode =
      copilotInterview.scheduling_mode === 'scheduled' || copilotInterview.scheduling_mode === 'candidate_choice'

    if (isScheduledMode && !copilotInterview.candidate_confirmed) {
      return {
        status: 403,
        body: {
          error: 'Interview has not been confirmed yet',
          code: 'NOT_CONFIRMED',
        },
      }
    }

    if (isScheduledMode && !copilotInterview.scheduled_at) {
      return {
        status: 403,
        body: {
          error: 'Interview time not confirmed yet',
          code: 'NO_SCHEDULED_TIME',
        },
      }
    }

    // Check time window for scheduled interviews (±15 minutes)
    if (isScheduledMode && copilotInterview.scheduled_at) {
      const scheduledAt = new Date(copilotInterview.scheduled_at)
      const now = new Date()
      const windowMinutes = 15
      const windowStart = new Date(scheduledAt.getTime() - windowMinutes * 60 * 1000)
      const windowEnd = new Date(scheduledAt.getTime() + windowMinutes * 60 * 1000)

      if (now < windowStart) {
        const minutesUntilOpen = Math.ceil((windowStart.getTime() - now.getTime()) / (60 * 1000))
        return {
          status: 403,
          body: {
            error: 'Interview has not opened yet',
            code: 'TOO_EARLY',
            scheduledAt: copilotInterview.scheduled_at,
            windowOpensAt: windowStart.toISOString(),
            minutesUntilOpen,
          },
        }
      }

      if (now > windowEnd) {
        return {
          status: 403,
          body: {
            error: 'Interview time window has closed',
            code: 'TOO_LATE',
            scheduledAt: copilotInterview.scheduled_at,
            windowClosedAt: windowEnd.toISOString(),
          },
        }
      }
    }

    const recordingEnabled = copilotInterview.recording_enabled ?? true
    if (role === 'candidate' && recordingEnabled && !copilotInterview.candidate_recording_consent) {
      return { status: 403, body: { error: 'candidate_consent_required' } }
    }

    let participantIndex = 0

    if (role === 'interviewer') {
      if (!userId) {
        return { status: 401, body: { error: 'Interviewer must be logged in' } }
      }

      const participants = await getInterviewParticipants(copilotInterviewId, adminSupabase)
      const existingParticipant = participants.find((p) => p.user_id === userId)

      if (existingParticipant) {
        participantIndex = existingParticipant.participant_index
      } else {
        const { data: isMember } = await adminSupabase
          .from('company_members')
          .select('id')
          .eq('company_id', copilotInterview.company_id)
          .eq('user_id', userId)
          .is('deleted_at', null)
          .single()

        if (!isMember) {
          return { status: 403, body: { error: 'Unauthorized: You are not a member of this company' } }
        }

        const addResult = await addInterviewer(copilotInterviewId, userId, adminSupabase)
        if (!addResult.success) {
          return { status: 400, body: { error: addResult.error || 'Failed to add interviewer' } }
        }

        participantIndex = addResult.participantIndex ?? 0
      }
    }

    if (copilotInterview.room_status === 'completed') {
      return { status: 410, body: { error: 'Interview has already been completed' } }
    }

    if (copilotInterview.room_status === 'cancelled') {
      return { status: 410, body: { error: 'Interview has been cancelled' } }
    }

    if (copilotInterview.room_status === 'missed') {
      return { status: 410, body: { error: 'Interview has been marked as missed' } }
    }

    const joinResult =
      role === 'interviewer'
        ? await interviewerJoinRoom(copilotInterviewId, userId || undefined, adminSupabase)
        : await candidateJoinRoom(copilotInterviewId, adminSupabase)

    if (!joinResult.success) {
      return { status: 500, body: { error: joinResult.error || 'Failed to join room' } }
    }

    if (!copilotInterview.livekit_room_name) {
      return { status: 400, body: { error: 'LiveKit room name not found' } }
    }

    let livekitConfig
    let usedFallback = false

    const existingRegion = copilotInterview.livekit_region
    if (existingRegion) {
      livekitConfig = getLiveKitConfigForRegion(existingRegion)
    } else {
      const preferredRegion = getRegionFromCountry(countryCode ? countryCode.toUpperCase() : null)
      const result = await selectRegionWithFallback(preferredRegion)
      livekitConfig = result.config
      usedFallback = result.usedFallback

      const { data: updatedRows, error: regionError } = await adminSupabase
        .from('copilot_interviews')
        .update({ livekit_region: result.actualRegion })
        .eq('id', copilotInterviewId)
        .is('livekit_region', null)
        .select('livekit_region')

      if (regionError) {
        console.warn('Failed to persist copilot_interviews.livekit_region, continuing:', regionError)
      } else if (Array.isArray(updatedRows) && updatedRows.length === 0) {
        const { data: current, error: currentError } = await adminSupabase
          .from('copilot_interviews')
          .select('livekit_region')
          .eq('id', copilotInterviewId)
          .single()

        if (currentError) {
          console.warn('Failed to reload copilot_interviews.livekit_region, continuing:', currentError)
        } else {
          const lockedRegion = parseRegion((current as { livekit_region?: unknown } | null)?.livekit_region)
          if (lockedRegion) {
            livekitConfig = getLiveKitConfigForRegion(lockedRegion)
            usedFallback = lockedRegion !== preferredRegion
          }
        }
      }
    }

    if (copilotInterview.livekit_room_name) {
      const participantIdentity =
        role === 'interviewer'
          ? `interviewer_${participantIndex}-${userId}`
          : `candidate-${copilotInterview.candidate_id}`
      await removeParticipantIfExistsForRegion(copilotInterview.livekit_room_name, participantIdentity, livekitConfig.region)
    }

    let token: string
    if (role === 'interviewer') {
      const interviewerId = userId as string
      const { data: interviewerData } = await adminSupabase.auth.admin.getUserById(interviewerId)
      const interviewer = interviewerData?.user

      let interviewerDisplayName = (interviewer?.user_metadata?.full_name as string | undefined) || undefined
      if (!interviewerDisplayName && interviewer?.email) {
        interviewerDisplayName = interviewer.email.split('@')[0]
      }
      interviewerDisplayName = interviewerDisplayName || `Interviewer ${participantIndex + 1}`

      token = await createInterviewerToken({
        roomName: copilotInterview.livekit_room_name,
        interviewerId,
        interviewerName: interviewerDisplayName,
        interviewerEmail: interviewer?.email,
        participantIndex,
        livekitConfig,
      })
    } else {
      const { data: candidate } = await adminSupabase
        .from('candidates')
        .select('name, email')
        .eq('id', copilotInterview.candidate_id)
        .single()

      const candidateRecord = candidate as { name?: string | null; email?: string | null } | null

      token = await createCandidateToken({
        roomName: copilotInterview.livekit_room_name,
        candidateId: copilotInterview.candidate_id,
        candidateName: candidateRecord?.name || 'Candidate',
        candidateEmail: candidateRecord?.email || undefined,
        livekitConfig,
      })
    }

    const { data: interviewRecord } = await adminSupabase
      .from('interviews')
      .select('interview_duration')
      .eq('id', copilotInterview.interview_id)
      .single()

    return {
      status: 200,
      body: {
        success: true,
        data: {
          token,
          roomName: copilotInterview.livekit_room_name,
          roomStatus: (joinResult.data as { room_status?: string } | undefined)?.room_status,
          wsUrl: livekitConfig.wsUrl,
          participantIndex: role === 'interviewer' ? participantIndex : undefined,
          userId: userId ?? undefined,
          interviewDuration: normalizeInterviewDurationMinutes((interviewRecord as { interview_duration?: unknown } | null)?.interview_duration),
          livekitRegion: livekitConfig.region,
          usedFallback,
          recordingEnabled: copilotInterview.recording_enabled ?? true,
        },
      },
    }
  } catch (error) {
    console.error('Error joining AI interview:', error)
    return {
      status: 500,
      body: {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    }
  }
}
