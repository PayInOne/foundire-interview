import { EgressStatus } from 'livekit-server-sdk'
import { createAdminClient } from '../supabase/admin'
import { buildLiveKitS3Output, getLiveKitEgressClient, getLiveKitRecordingKey, getLiveKitRoomName } from '../livekit/server'

export type LiveKitStartResponse =
  | { status: 200; body: { success: true; egressId: string; alreadyStarted?: boolean } }
  | { status: 400 | 404 | 500; body: { error: string } }

export async function handleLiveKitStart(body: unknown): Promise<LiveKitStartResponse> {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  const interviewId = typeof record?.interviewId === 'string' ? record.interviewId : ''
  const videoTrackSid = typeof record?.videoTrackSid === 'string' ? record.videoTrackSid : ''
  const audioTrackSid = typeof record?.audioTrackSid === 'string' ? record.audioTrackSid : undefined

  if (!interviewId || !videoTrackSid) {
    return { status: 400, body: { error: 'Missing interviewId or videoTrackSid' } }
  }

  const admin = createAdminClient()

  const { data: interview, error } = await admin
    .from('interviews')
    .select('id, livekit_room_name, livekit_egress_id')
    .eq('id', interviewId)
    .single()

  if (error || !interview) {
    return { status: 404, body: { error: 'Interview not found' } }
  }

  const existing = interview as unknown as {
    livekit_room_name: string | null
    livekit_egress_id: string | null
  }

  if (existing.livekit_egress_id) {
    return { status: 200, body: { success: true, egressId: existing.livekit_egress_id, alreadyStarted: true } }
  }

  const roomName = existing.livekit_room_name ?? getLiveKitRoomName(interviewId)
  if (!existing.livekit_room_name) {
    await admin.from('interviews').update({ livekit_room_name: roomName }).eq('id', interviewId)
  }

  const egressClient = getLiveKitEgressClient()
  const fileOutput = buildLiveKitS3Output(interviewId)

  const egressInfo = await egressClient.startTrackCompositeEgress(roomName, fileOutput, audioTrackSid, videoTrackSid)

  if (egressInfo.status === EgressStatus.EGRESS_FAILED) {
    console.error('LiveKit egress failed to start', {
      interviewId,
      egressId: egressInfo.egressId,
      message: egressInfo.error,
    })

    return { status: 500, body: { error: 'Failed to start LiveKit recording' } }
  }

  const recordingKey = getLiveKitRecordingKey(interviewId)

  await admin
    .from('interviews')
    .update({
      livekit_egress_id: egressInfo.egressId,
      video_url: recordingKey,
    })
    .eq('id', interviewId)

  return { status: 200, body: { success: true, egressId: egressInfo.egressId } }
}

export type LiveKitStopResponse =
  | { status: 200; body: { success: true; stopped: boolean } }
  | { status: 400 | 404 | 500; body: { error: string } }

export async function handleLiveKitStop(body: unknown): Promise<LiveKitStopResponse> {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  const interviewId = typeof record?.interviewId === 'string' ? record.interviewId : ''

  if (!interviewId) {
    return { status: 400, body: { error: 'Missing interviewId' } }
  }

  const admin = createAdminClient()

  const { data: interview, error } = await admin
    .from('interviews')
    .select('id, livekit_egress_id')
    .eq('id', interviewId)
    .single()

  if (error || !interview) {
    return { status: 404, body: { error: 'Interview not found' } }
  }

  const existing = interview as unknown as { livekit_egress_id: string | null }

  if (!existing.livekit_egress_id) {
    return { status: 200, body: { success: true, stopped: false } }
  }

  const egressClient = getLiveKitEgressClient()
  try {
    await egressClient.stopEgress(existing.livekit_egress_id)
  } catch (error) {
    const err = error as { code?: string; status?: number; message?: string }
    if (err?.code !== 'failed_precondition' && err?.status !== 412) {
      console.error('Error stopping LiveKit egress:', err)
      return { status: 500, body: { error: 'Failed to stop LiveKit recording' } }
    }
  }

  await admin.from('interviews').update({ livekit_egress_id: null }).eq('id', interviewId)

  return { status: 200, body: { success: true, stopped: true } }
}

