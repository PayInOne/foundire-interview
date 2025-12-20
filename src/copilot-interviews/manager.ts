import type { SupabaseClient } from '@supabase/supabase-js'
import { INTERVIEW_MODES } from '../interview/modes'
import type { LiveKitRegion } from '../livekit/geo-routing'
import { deleteRoomForRegion } from '../livekit/rooms'
import { createAdminClient } from '../supabase/admin'

export type RoomStatus =
  | 'waiting_both'
  | 'waiting_candidate'
  | 'waiting_interviewer'
  | 'both_ready'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

export interface CopilotInterviewState {
  id: string
  interview_id: string
  interviewer_id: string
  candidate_id: string
  job_id: string
  company_id: string
  room_status: RoomStatus
  ai_enabled: boolean
  interviewer_joined_at: string | null
  candidate_joined_at: string | null
  livekit_room_name: string | null
  livekit_region: LiveKitRegion | null
  livekit_egress_id: string | null
  created_at: string
  updated_at: string
  min_interviewers_required?: number
  max_interviewers?: number
  interview_duration?: number
}

export interface CopilotInterviewParticipant {
  id: string
  copilot_interview_id: string
  user_id: string
  participant_index: number
  joined_at: string | null
  last_heartbeat_at: string | null
  created_at: string
}

export interface CreateCopilotInterviewParams {
  interviewId: string
  interviewerId: string
  candidateId: string
  jobId: string
  companyId: string
}

export async function createCopilotInterview(
  params: CreateCopilotInterviewParams,
  supabaseClient?: SupabaseClient
): Promise<{ success: boolean; data?: CopilotInterviewState; error?: string }> {
  const supabase = supabaseClient || createAdminClient()

  try {
    const roomName = `copilot-interview-${params.interviewId}-${Date.now()}`

    const { data, error } = await supabase
      .from('copilot_interviews')
      .insert({
        interview_id: params.interviewId,
        interviewer_id: params.interviewerId,
        candidate_id: params.candidateId,
        job_id: params.jobId,
        company_id: params.companyId,
        livekit_room_name: roomName,
        room_status: 'waiting_both',
        ai_enabled: true,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating AI interview:', error)
      return { success: false, error: error.message }
    }

    await supabase
      .from('interviews')
      .update({ interview_mode: INTERVIEW_MODES.ASSISTED_VIDEO })
      .eq('id', params.interviewId)

    await supabase.from('copilot_interview_participants').insert({
      copilot_interview_id: (data as { id: string }).id,
      user_id: params.interviewerId,
      participant_index: 0,
    })

    return { success: true, data: data as CopilotInterviewState }
  } catch (error) {
    console.error('Exception creating AI interview:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function getCopilotInterviewState(
  copilotInterviewId: string,
  supabaseClient?: SupabaseClient
): Promise<{ success: boolean; data?: CopilotInterviewState; error?: string }> {
  const supabase = supabaseClient || createAdminClient()

  try {
    const { data, error } = await supabase
      .from('copilot_interviews')
      .select('*')
      .eq('id', copilotInterviewId)
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: data as CopilotInterviewState }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function getCopilotInterviewByInterviewId(
  interviewId: string,
  supabaseClient?: SupabaseClient
): Promise<{ success: boolean; data?: CopilotInterviewState; error?: string }> {
  const supabase = supabaseClient || createAdminClient()

  try {
    const { data, error } = await supabase
      .from('copilot_interviews')
      .select('*')
      .eq('interview_id', interviewId)
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: data as CopilotInterviewState }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function getInterviewParticipants(
  copilotInterviewId: string,
  supabaseClient?: SupabaseClient
): Promise<CopilotInterviewParticipant[]> {
  const supabase = supabaseClient || createAdminClient()

  const { data, error } = await supabase
    .from('copilot_interview_participants')
    .select('*')
    .eq('copilot_interview_id', copilotInterviewId)
    .order('participant_index', { ascending: true })

  if (error || !data) {
    console.error('Error fetching participants:', error)
    return []
  }

  return data as CopilotInterviewParticipant[]
}

export async function addInterviewer(
  copilotInterviewId: string,
  userId: string,
  supabaseClient?: SupabaseClient
): Promise<{ success: boolean; participantIndex?: number; error?: string }> {
  const supabase = supabaseClient || createAdminClient()

  try {
    const existingParticipants = await getInterviewParticipants(copilotInterviewId, supabase)

    const existing = existingParticipants.find((p) => p.user_id === userId)
    if (existing) {
      return { success: true, participantIndex: existing.participant_index }
    }

    if (existingParticipants.length >= 3) {
      return { success: false, error: 'Maximum interviewers reached (3)' }
    }

    const usedIndices = new Set(existingParticipants.map((p) => p.participant_index))
    let nextIndex = 0
    while (usedIndices.has(nextIndex) && nextIndex < 3) {
      nextIndex++
    }

    const { error } = await supabase.from('copilot_interview_participants').insert({
      copilot_interview_id: copilotInterviewId,
      user_id: userId,
      participant_index: nextIndex,
    })

    if (error) {
      console.error('Error adding interviewer:', error)
      return { success: false, error: error.message }
    }

    return { success: true, participantIndex: nextIndex }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

function calculateNewRoomStatusMulti(
  currentStatus: RoomStatus,
  candidateJoined: boolean,
  joinedInterviewerCount: number,
  minRequired: number = 1
): RoomStatus {
  if (currentStatus === 'completed' || currentStatus === 'cancelled') {
    return currentStatus
  }

  if (candidateJoined && joinedInterviewerCount >= minRequired) {
    return 'both_ready'
  }
  if (candidateJoined && joinedInterviewerCount === 0) {
    return 'waiting_interviewer'
  }
  if (!candidateJoined && joinedInterviewerCount > 0) {
    return 'waiting_candidate'
  }

  return 'waiting_both'
}

function calculateNewRoomStatus(
  currentStatus: RoomStatus,
  participant: 'interviewer' | 'candidate',
  interviewerJoined: boolean,
  candidateJoined: boolean
): RoomStatus {
  if (currentStatus === 'completed' || currentStatus === 'cancelled') {
    return currentStatus
  }

  const willInterviewerJoin = participant === 'interviewer' ? true : interviewerJoined
  const willCandidateJoin = participant === 'candidate' ? true : candidateJoined

  if (willInterviewerJoin && willCandidateJoin) {
    return 'both_ready'
  }
  if (willInterviewerJoin && !willCandidateJoin) {
    return 'waiting_candidate'
  }
  if (!willInterviewerJoin && willCandidateJoin) {
    return 'waiting_interviewer'
  }

  return 'waiting_both'
}

export async function interviewerJoinRoom(
  copilotInterviewId: string,
  userId?: string,
  supabaseClient?: SupabaseClient
): Promise<{ success: boolean; data?: CopilotInterviewState; participantIndex?: number; error?: string }> {
  const supabase = supabaseClient || createAdminClient()

  try {
    const { data: current, error: fetchError } = await supabase
      .from('copilot_interviews')
      .select('*')
      .eq('id', copilotInterviewId)
      .single()

    if (fetchError || !current) {
      return { success: false, error: 'AI interview not found' }
    }

    let participantIndex = 0

    if (userId) {
      const { data: participant } = await supabase
        .from('copilot_interview_participants')
        .select('*')
        .eq('copilot_interview_id', copilotInterviewId)
        .eq('user_id', userId)
        .single()

      if (participant) {
        participantIndex = (participant as { participant_index: number }).participant_index
        await supabase
          .from('copilot_interview_participants')
          .update({ joined_at: new Date().toISOString() })
          .eq('id', (participant as { id: string }).id)
      }

      const { count: joinedCount } = await supabase
        .from('copilot_interview_participants')
        .select('*', { count: 'exact', head: true })
        .eq('copilot_interview_id', copilotInterviewId)
        .not('joined_at', 'is', null)

      const newStatus = calculateNewRoomStatusMulti(
        (current as { room_status: RoomStatus }).room_status,
        Boolean((current as { candidate_joined_at: string | null }).candidate_joined_at),
        (joinedCount || 0) + ((participant as { joined_at?: string | null } | null)?.joined_at ? 0 : 1),
        (current as { min_interviewers_required?: number | null }).min_interviewers_required || 1
      )

      const { data, error } = await supabase
        .from('copilot_interviews')
        .update({
          interviewer_joined_at: (current as { interviewer_joined_at: string | null }).interviewer_joined_at || new Date().toISOString(),
          room_status: newStatus,
        })
        .eq('id', copilotInterviewId)
        .select()
        .single()

      if (error) {
        return { success: false, error: error.message }
      }

      return { success: true, data: data as CopilotInterviewState, participantIndex }
    }

    const newStatus = calculateNewRoomStatus(
      (current as { room_status: RoomStatus }).room_status,
      'interviewer',
      Boolean((current as { interviewer_joined_at: string | null }).interviewer_joined_at),
      Boolean((current as { candidate_joined_at: string | null }).candidate_joined_at)
    )

    const { data, error } = await supabase
      .from('copilot_interviews')
      .update({
        interviewer_joined_at: new Date().toISOString(),
        room_status: newStatus,
      })
      .eq('id', copilotInterviewId)
      .select()
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: data as CopilotInterviewState, participantIndex: 0 }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function candidateJoinRoom(
  copilotInterviewId: string,
  supabaseClient?: SupabaseClient
): Promise<{ success: boolean; data?: CopilotInterviewState; error?: string }> {
  const supabase = supabaseClient || createAdminClient()

  try {
    const { data: current, error: fetchError } = await supabase
      .from('copilot_interviews')
      .select('*')
      .eq('id', copilotInterviewId)
      .single()

    if (fetchError || !current) {
      return { success: false, error: 'AI interview not found' }
    }

    const { count: joinedCount } = await supabase
      .from('copilot_interview_participants')
      .select('*', { count: 'exact', head: true })
      .eq('copilot_interview_id', copilotInterviewId)
      .not('joined_at', 'is', null)

    const newStatus = calculateNewRoomStatusMulti(
      (current as { room_status: RoomStatus }).room_status,
      true,
      joinedCount || 0,
      (current as { min_interviewers_required?: number | null }).min_interviewers_required || 1
    )

    const { data, error } = await supabase
      .from('copilot_interviews')
      .update({
        candidate_joined_at: new Date().toISOString(),
        room_status: newStatus,
      })
      .eq('id', copilotInterviewId)
      .select()
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, data: data as CopilotInterviewState }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function updateParticipantHeartbeat(
  copilotInterviewId: string,
  userId: string,
  supabaseClient?: SupabaseClient
): Promise<{ success: boolean; error?: string }> {
  const supabase = supabaseClient || createAdminClient()

  try {
    const { error } = await supabase
      .from('copilot_interview_participants')
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq('copilot_interview_id', copilotInterviewId)
      .eq('user_id', userId)

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function startCopilotInterview(
  copilotInterviewId: string,
  supabaseClient?: SupabaseClient
): Promise<{ success: boolean; data?: CopilotInterviewState; error?: string }> {
  const supabase = supabaseClient || createAdminClient()

  try {
    const { data, error } = await supabase
      .from('copilot_interviews')
      .update({ room_status: 'in_progress' })
      .eq('id', copilotInterviewId)
      .eq('room_status', 'both_ready')
      .select()
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    if (!data) {
      return { success: false, error: 'Interview not ready to start' }
    }

    const { data: currentInterview } = await supabase
      .from('interviews')
      .select('started_at, candidate_id')
      .eq('id', (data as { interview_id: string }).interview_id)
      .single()

    const { data: interviewData } = await supabase
      .from('interviews')
      .update({
        status: 'in-progress',
        ...(currentInterview && (currentInterview as { started_at?: string | null }).started_at ? {} : { started_at: new Date().toISOString() }),
      })
      .eq('id', (data as { interview_id: string }).interview_id)
      .select('candidate_id')
      .single()

    if (interviewData && (interviewData as { candidate_id?: string | null }).candidate_id) {
      await supabase
        .from('candidates')
        .update({ status: 'interviewing' })
        .eq('id', (interviewData as { candidate_id: string }).candidate_id)
    }

    return { success: true, data: data as CopilotInterviewState }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function completeCopilotInterview(
  copilotInterviewId: string,
  supabaseClient?: SupabaseClient
): Promise<{ success: boolean; data?: CopilotInterviewState; error?: string }> {
  const supabase = supabaseClient || createAdminClient()

  try {
    const { data, error } = await supabase
      .from('copilot_interviews')
      .update({ room_status: 'completed' })
      .eq('id', copilotInterviewId)
      .select()
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    const interviewId = (data as { interview_id: string }).interview_id

    const { data: currentInterview } = await supabase
      .from('interviews')
      .select('completed_at')
      .eq('id', interviewId)
      .single()

    await supabase
      .from('interviews')
      .update({
        status: 'completed',
        ...(currentInterview && (currentInterview as { completed_at?: string | null }).completed_at
          ? {}
          : { completed_at: new Date().toISOString() }),
      })
      .eq('id', interviewId)

    const candidateId = (data as { candidate_id: string }).candidate_id
    const { error: candidateStatusError } = await supabase
      .from('candidates')
      .update({ status: 'completed' })
      .eq('id', candidateId)

    if (candidateStatusError) {
      console.error('Failed to update candidate status after completing interview:', candidateStatusError)
    }

    const livekitRoomName = (data as { livekit_room_name?: string | null }).livekit_room_name
    if (livekitRoomName) {
      const region = ((data as { livekit_region?: string | null }).livekit_region as LiveKitRegion | null) ?? null
      await deleteRoomForRegion(livekitRoomName, region)
    }

    return { success: true, data: data as CopilotInterviewState }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

