import { EgressStatus } from 'livekit-server-sdk'
import { createAdminClient } from '../supabase/admin'
import { getEgressClientForRegion, getFallbackRegion, type LiveKitRegion } from '../livekit/geo-routing'
import { buildLiveKitS3Output, getLiveKitRecordingKey, getLiveKitRoomName } from '../livekit/server'

export type LiveKitStartResponse =
  | { status: 200; body: { success: true; egressId: string; alreadyStarted?: boolean } }
  | { status: 200; body: { success: true; skipped: true; reason: string } }
  | { status: 400 | 403 | 404 | 500; body: { error: string } }

function parseRegion(value: unknown): LiveKitRegion | null {
  return value === 'self-hosted' || value === 'cloud' ? value : null
}

function isNotFoundError(error: unknown): boolean {
  const err = error as { status?: number; code?: string }
  return err?.status === 404 || err?.code === 'not_found'
}

export async function handleLiveKitStart(body: unknown): Promise<LiveKitStartResponse> {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  const interviewId = typeof record?.interviewId === 'string' ? record.interviewId : ''
  const videoTrackSid = typeof record?.videoTrackSid === 'string' ? record.videoTrackSid : ''
  const audioTrackSid = typeof record?.audioTrackSid === 'string' ? record.audioTrackSid : undefined

  if (!interviewId || !videoTrackSid) {
    return { status: 400, body: { error: 'Missing interviewId or videoTrackSid' } }
  }

  const admin = createAdminClient()

  let interview: unknown = null
  let error: { code?: string } | null = null
  let supportsLivekitRegion = true

  ;({ data: interview, error } = await admin
    .from('interviews')
    .select('id, livekit_room_name, livekit_egress_id, livekit_region, recording_enabled, candidate_recording_consent')
    .eq('id', interviewId)
    .single())

  if (error?.code === '42703') {
    supportsLivekitRegion = false
    ;({ data: interview, error } = await admin
      .from('interviews')
      .select('id, livekit_room_name, livekit_egress_id, recording_enabled, candidate_recording_consent')
      .eq('id', interviewId)
      .single())
  }

  if (error || !interview) {
    return { status: 404, body: { error: 'Interview not found' } }
  }

  const existing = interview as unknown as {
    livekit_room_name: string | null
    livekit_egress_id: string | null
    livekit_region?: unknown
    recording_enabled?: boolean | null
    candidate_recording_consent?: boolean | null
  }

  if (existing.livekit_egress_id) {
    return { status: 200, body: { success: true, egressId: existing.livekit_egress_id, alreadyStarted: true } }
  }

  const recordingEnabled = existing.recording_enabled ?? true
  if (!recordingEnabled) {
    return { status: 200, body: { success: true, skipped: true, reason: 'recording_disabled' } }
  }

  if (!existing.candidate_recording_consent) {
    return { status: 403, body: { error: 'candidate_consent_required' } }
  }

  const roomName = existing.livekit_room_name ?? getLiveKitRoomName(interviewId)
  if (!existing.livekit_room_name) {
    await admin.from('interviews').update({ livekit_room_name: roomName }).eq('id', interviewId)
  }

  const fileOutput = buildLiveKitS3Output(interviewId)

  const storedRegion = parseRegion(existing.livekit_region)
  const regionsToTry: LiveKitRegion[] = storedRegion ? [storedRegion] : ['self-hosted', 'cloud']
  let lastError: unknown = null
  let egressInfo: Awaited<ReturnType<ReturnType<typeof getEgressClientForRegion>['startTrackCompositeEgress']>> | null =
    null
  let usedRegion: LiveKitRegion | null = null

  for (const region of regionsToTry) {
    let egressClient
    try {
      egressClient = getEgressClientForRegion(region)
    } catch (error) {
      lastError = error
      continue
    }

    try {
      egressInfo = await egressClient.startTrackCompositeEgress(roomName, fileOutput, audioTrackSid, videoTrackSid)
      usedRegion = region
      break
    } catch (error) {
      lastError = error
      if (isNotFoundError(error) && !storedRegion) {
        continue
      }

      if (isNotFoundError(error)) {
        return { status: 404, body: { error: 'LiveKit room does not exist' } }
      }

      console.error('Error starting LiveKit egress:', error)
      return { status: 500, body: { error: 'Failed to start LiveKit recording' } }
    }
  }

  if (!egressInfo || !usedRegion) {
    if (isNotFoundError(lastError)) {
      return { status: 404, body: { error: 'LiveKit room does not exist' } }
    }

    console.error('Error starting LiveKit egress (no region succeeded):', lastError)
    return { status: 500, body: { error: 'Failed to start LiveKit recording' } }
  }

  if (egressInfo.status === EgressStatus.EGRESS_FAILED) {
    console.error('LiveKit egress failed to start', {
      interviewId,
      egressId: egressInfo.egressId,
      message: egressInfo.error,
    })

    return { status: 500, body: { error: 'Failed to start LiveKit recording' } }
  }

  const recordingKey = getLiveKitRecordingKey(interviewId)

  const updatePayload: Record<string, unknown> = {
    livekit_egress_id: egressInfo.egressId,
    video_url: recordingKey,
  }

  if (supportsLivekitRegion && !storedRegion) {
    updatePayload.livekit_region = usedRegion
  }

  await admin
    .from('interviews')
    .update(updatePayload)
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

  let interview: unknown = null
  let error: { code?: string } | null = null

  ;({ data: interview, error } = await admin
    .from('interviews')
    .select('id, livekit_egress_id, livekit_region')
    .eq('id', interviewId)
    .single())

  if (error?.code === '42703') {
    ;({ data: interview, error } = await admin
      .from('interviews')
      .select('id, livekit_egress_id')
      .eq('id', interviewId)
      .single())
  }

  if (error || !interview) {
    return { status: 404, body: { error: 'Interview not found' } }
  }

  const existing = interview as unknown as { livekit_egress_id: string | null; livekit_region?: unknown }

  if (!existing.livekit_egress_id) {
    return { status: 200, body: { success: true, stopped: false } }
  }

  const storedRegion = parseRegion(existing.livekit_region)
  const regionsToTry: LiveKitRegion[] = storedRegion
    ? [storedRegion, getFallbackRegion(storedRegion)]
    : ['self-hosted', 'cloud']

  let stopSucceeded = false
  let lastError: unknown = null

  for (const region of regionsToTry) {
    let egressClient
    try {
      egressClient = getEgressClientForRegion(region)
    } catch (error) {
      lastError = error
      continue
    }

    try {
      await egressClient.stopEgress(existing.livekit_egress_id)
      stopSucceeded = true
      break
    } catch (error) {
      const err = error as { code?: string; status?: number }
      if (err?.code === 'failed_precondition' || err?.status === 412) {
        stopSucceeded = true
        break
      }

      if (isNotFoundError(error)) {
        lastError = error
        continue
      }

      console.error('Error stopping LiveKit egress:', error)
      return { status: 500, body: { error: 'Failed to stop LiveKit recording' } }
    }
  }

  if (!stopSucceeded) {
    console.error('Error stopping LiveKit egress (no region succeeded):', lastError)
    return { status: 500, body: { error: 'Failed to stop LiveKit recording' } }
  }

  await admin.from('interviews').update({ livekit_egress_id: null }).eq('id', interviewId)

  return { status: 200, body: { success: true, stopped: true } }
}

export type LiveKitStatusResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 404 | 500; body: { error: string; message?: string } }

export async function handleGetLiveKitRecordingStatus(interviewId: string): Promise<LiveKitStatusResponse> {
  if (!interviewId) {
    return { status: 400, body: { error: 'Missing interviewId' } }
  }

  try {
    const admin = createAdminClient()

    let interview: unknown = null
    let error: { code?: string } | null = null

    ;({ data: interview, error } = await admin
      .from('interviews')
      .select('id, livekit_egress_id, livekit_region')
      .eq('id', interviewId)
      .single())

    if (error?.code === '42703') {
      ;({ data: interview, error } = await admin
        .from('interviews')
        .select('id, livekit_egress_id')
        .eq('id', interviewId)
        .single())
    }

    if (error || !interview) {
      return { status: 404, body: { error: 'Interview not found' } }
    }

    const existing = interview as unknown as { livekit_egress_id: string | null; livekit_region?: unknown }

    if (!existing.livekit_egress_id) {
      return {
        status: 200,
        body: { success: true, status: 'no_recording', message: 'No recording was started for this interview' },
      }
    }

    const livekitRegion = parseRegion(existing.livekit_region)
    const egressClient = getEgressClientForRegion(livekitRegion)
    const egressList = await egressClient.listEgress({ egressId: existing.livekit_egress_id })

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
        egressId: existing.livekit_egress_id,
        isComplete,
        hasFailed,
        error: egress.error || null,
        startedAt: egress.startedAt ? new Date(Number(egress.startedAt) / 1000000).toISOString() : null,
        endedAt: egress.endedAt ? new Date(Number(egress.endedAt) / 1000000).toISOString() : null,
      },
    }
  } catch (error) {
    console.error('Error checking LiveKit recording status:', error)
    return {
      status: 500,
      body: {
        error: 'Failed to check recording status',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    }
  }
}
