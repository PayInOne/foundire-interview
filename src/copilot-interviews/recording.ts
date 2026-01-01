import { EgressStatus } from 'livekit-server-sdk'
import { createAdminClient } from '../supabase/admin'
import { buildLiveKitS3Output } from '../livekit/server'
import {
  getEgressClientForRegion,
  getRoomServiceClientForRegion,
  type LiveKitRegion,
} from '../livekit/geo-routing'
import { completeCopilotInterview, getCopilotInterviewState } from './manager'

export type CopilotRecordingStartResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 403 | 404 | 425 | 500; body: Record<string, unknown> }

export async function handleStartCopilotRecording(copilotInterviewId: string): Promise<CopilotRecordingStartResponse> {
  try {
    const adminSupabase = createAdminClient()

    const stateResult = await getCopilotInterviewState(copilotInterviewId, adminSupabase)
    if (!stateResult.success || !stateResult.data) {
      return { status: 404, body: { error: 'AI interview not found' } }
    }

    const copilotInterview = stateResult.data as {
      interview_id: string
      livekit_egress_id: string | null
      livekit_room_name: string | null
      livekit_region: LiveKitRegion | null
      recording_enabled?: boolean | null
      candidate_recording_consent?: boolean | null
    }

    const recordingEnabled = copilotInterview.recording_enabled ?? true
    if (!recordingEnabled) {
      return {
        status: 200,
        body: { success: true, skipped: true, reason: 'recording_disabled' },
      }
    }

    if (!copilotInterview.candidate_recording_consent) {
      return { status: 403, body: { error: 'candidate_consent_required' } }
    }

    if (copilotInterview.livekit_egress_id) {
      return {
        status: 200,
        body: { success: true, egressId: copilotInterview.livekit_egress_id, alreadyStarted: true },
      }
    }

    if (!copilotInterview.livekit_room_name) {
      return { status: 400, body: { error: 'LiveKit room name not found' } }
    }

    const fileOutput = buildLiveKitS3Output(copilotInterview.interview_id)

    const livekitRegion = copilotInterview.livekit_region
    const roomClient = getRoomServiceClientForRegion(livekitRegion)
    const participants = await roomClient.listParticipants(copilotInterview.livekit_room_name)

    const candidateParticipants = participants.filter((p) => p.identity.startsWith('candidate'))
    const interviewerParticipants = participants.filter(
      (p) => p.identity.startsWith('interviewer_') || p.identity.startsWith('interviewer-')
    )

    if (candidateParticipants.length < 1 || interviewerParticipants.length < 1) {
      return {
        status: 425,
        body: {
          error: 'Waiting for at least one candidate and one interviewer to join',
          waitForBothParticipants: true,
          candidateCount: candidateParticipants.length,
          interviewerCount: interviewerParticipants.length,
          participantIdentities: participants.map((p) => p.identity),
        },
      }
    }

    const candidatesWithVideo = candidateParticipants.filter((p) => p.tracks && p.tracks.some((t) => t.type === 1))
    const interviewersWithVideo = interviewerParticipants.filter((p) => p.tracks && p.tracks.some((t) => t.type === 1))

    if (candidatesWithVideo.length < 1 || interviewersWithVideo.length < 1) {
      return {
        status: 425,
        body: {
          error: 'Waiting for candidate and at least one interviewer to publish video',
          waitForMedia: true,
          candidatesWithVideo: candidatesWithVideo.length,
          interviewersWithVideo: interviewersWithVideo.length,
          participantIdentities: participants.map((p) => ({
            identity: p.identity,
            hasVideo: p.tracks?.some((t) => t.type === 1) || false,
          })),
        },
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
    const participantsAfter = await roomClient.listParticipants(copilotInterview.livekit_room_name)
    if (participantsAfter.length !== participants.length) {
      return {
        status: 425,
        body: {
          error: 'Participant count changed during check, please retry',
          participantCountChanged: true,
          before: participants.length,
          after: participantsAfter.length,
        },
      }
    }

    const egressClient = getEgressClientForRegion(livekitRegion)
    const egressInfo = await egressClient.startRoomCompositeEgress(copilotInterview.livekit_room_name, fileOutput, {
      layout: 'grid',
      audioOnly: false,
      videoOnly: false,
    })

    if (egressInfo.status === EgressStatus.EGRESS_FAILED) {
      return { status: 500, body: { error: 'Failed to start LiveKit recording' } }
    }

    await adminSupabase
      .from('copilot_interviews')
      .update({ livekit_egress_id: egressInfo.egressId })
      .eq('id', copilotInterviewId)

    const videoKey = `interviews/${copilotInterview.interview_id}/recording.mp4`
    await adminSupabase.from('interviews').update({ video_url: videoKey }).eq('id', copilotInterview.interview_id)

    return {
      status: 200,
      body: { success: true, egressId: egressInfo.egressId, layout: 'grid', status: egressInfo.status },
    }
  } catch (error) {
    console.error('Error starting AI interview recording:', error)
    return {
      status: 500,
      body: {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    }
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null) {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  return ''
}

export type CopilotRecordingStopResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 404 | 500; body: Record<string, unknown> }

export async function handleStopCopilotRecording(copilotInterviewId: string): Promise<CopilotRecordingStopResponse> {
  try {
    const adminSupabase = createAdminClient()

    const stateResult = await getCopilotInterviewState(copilotInterviewId, adminSupabase)
    if (!stateResult.success || !stateResult.data) {
      return { status: 404, body: { error: 'AI interview not found' } }
    }

    const copilotInterview = stateResult.data as {
      livekit_egress_id: string | null
      livekit_region: LiveKitRegion | null
    }

    if (!copilotInterview.livekit_egress_id) {
      await completeCopilotInterview(copilotInterviewId, adminSupabase)
      return { status: 200, body: { success: true, message: 'No recording was in progress, interview marked as completed' } }
    }

    const egressClient = getEgressClientForRegion(copilotInterview.livekit_region)

    try {
      const egressList = await egressClient.listEgress({ egressId: copilotInterview.livekit_egress_id })
      if (!egressList || egressList.length === 0) {
        await completeCopilotInterview(copilotInterviewId, adminSupabase)
        return {
          status: 200,
          body: { success: true, message: 'Recording not found, interview marked as completed', egressId: copilotInterview.livekit_egress_id },
        }
      }

      const currentEgress = egressList[0]
      const stoppableStatuses = [0, 1]
      if (!stoppableStatuses.includes(currentEgress.status)) {
        await completeCopilotInterview(copilotInterviewId, adminSupabase)
        return {
          status: 200,
          body: {
            success: true,
            message: 'Recording already stopped, interview marked as completed',
            egressId: copilotInterview.livekit_egress_id,
            status: currentEgress.status,
          },
        }
      }

      const stoppedEgress = await egressClient.stopEgress(copilotInterview.livekit_egress_id)
      await completeCopilotInterview(copilotInterviewId, adminSupabase)
      return { status: 200, body: { success: true, egressId: copilotInterview.livekit_egress_id, status: stoppedEgress.status } }
    } catch (listError) {
      console.warn('Error checking egress status, attempting direct stop:', listError)

      try {
        const stoppedEgress = await egressClient.stopEgress(copilotInterview.livekit_egress_id)
        await completeCopilotInterview(copilotInterviewId, adminSupabase)
        return { status: 200, body: { success: true, egressId: copilotInterview.livekit_egress_id, status: stoppedEgress.status } }
      } catch (stopError) {
        const message = getErrorMessage(stopError)
        if (message.includes('EGRESS_ABORTED') || message.includes('EGRESS_COMPLETE') || message.includes('EGRESS_FAILED')) {
          await completeCopilotInterview(copilotInterviewId, adminSupabase)
          return { status: 200, body: { success: true, message: 'Recording already stopped, interview marked as completed', egressId: copilotInterview.livekit_egress_id } }
        }
        throw stopError
      }
    }
  } catch (error) {
    console.error('Error stopping AI interview recording:', error)
    return { status: 500, body: { error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' } }
  }
}

export type CopilotRecordingStatusResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 404 | 500; body: Record<string, unknown> }

export async function handleGetCopilotRecordingStatus(copilotInterviewId: string): Promise<CopilotRecordingStatusResponse> {
  try {
    const adminSupabase = createAdminClient()
    const stateResult = await getCopilotInterviewState(copilotInterviewId, adminSupabase)

    if (!stateResult.success || !stateResult.data) {
      return { status: 404, body: { error: 'AI interview not found' } }
    }

    const copilotInterview = stateResult.data as { livekit_egress_id: string | null; livekit_region: LiveKitRegion | null }

    if (!copilotInterview.livekit_egress_id) {
      return { status: 200, body: { success: true, status: 'no_recording', message: 'No recording was started for this interview' } }
    }

    const egressClient = getEgressClientForRegion(copilotInterview.livekit_region)
    const egressList = await egressClient.listEgress({ egressId: copilotInterview.livekit_egress_id })

    if (!egressList || egressList.length === 0) {
      return { status: 200, body: { success: true, status: 'not_found', message: 'Recording not found' } }
    }

    const egress = egressList[0]
    const statusMap: Record<number, string> = {
      0: 'starting',
      1: 'active',
      2: 'ending',
      3: 'complete',
      4: 'failed',
      5: 'aborted',
      6: 'limit_reached',
    }

    const status = statusMap[egress.status] || 'unknown'
    const isComplete = egress.status === 3
    const hasFailed = egress.status === 4 || egress.status === 5

    return {
      status: 200,
      body: {
        success: true,
        status,
        egressId: copilotInterview.livekit_egress_id,
        isComplete,
        hasFailed,
        error: egress.error || null,
        startedAt: egress.startedAt ? new Date(Number(egress.startedAt) / 1000000).toISOString() : null,
        endedAt: egress.endedAt ? new Date(Number(egress.endedAt) / 1000000).toISOString() : null,
      },
    }
  } catch (error) {
    console.error('Error checking AI interview recording status:', error)
    return { status: 500, body: { success: false, error: 'Failed to check recording status', message: error instanceof Error ? error.message : 'Unknown error' } }
  }
}
