import { createAdminClient } from '../supabase/admin'
import { createLiveKitAccessToken } from './tokens'
import { getLiveKitRoomName } from './server'
import { getLiveKitConfigForRegion } from './geo-routing'
import { asRecord, getOptionalString, getString } from '../utils/parse'

export type LiveKitTokenResponse =
  | { status: 200; body: { token: string; roomName: string; url: string } }
  | { status: 400 | 403 | 404 | 500; body: { error: string } }

export async function handleCreateLiveKitToken(body: unknown): Promise<LiveKitTokenResponse> {
  try {
    const record = asRecord(body) ?? {}

    const interviewId = getString(record, 'interviewId')
    const candidateId = getString(record, 'candidateId')
    const identity = getOptionalString(record, 'identity')
    const name = getOptionalString(record, 'name')
    const metadata = getOptionalString(record, 'metadata')

    if (!interviewId || !candidateId) {
      return { status: 400, body: { error: 'Missing interviewId or candidateId' } }
    }

    const admin = createAdminClient()

    const { data: interview, error } = await admin
      .from('interviews')
      .select('id, candidate_id, livekit_room_name')
      .eq('id', interviewId)
      .single()

    if (error || !interview) {
      return { status: 404, body: { error: 'Interview not found' } }
    }

    const interviewRecord = interview as { candidate_id: string | null; livekit_room_name: string | null }
    if (interviewRecord.candidate_id !== candidateId) {
      return { status: 403, body: { error: 'Candidate does not match interview' } }
    }

    const roomName = interviewRecord.livekit_room_name ?? getLiveKitRoomName(interviewId)

    if (!interviewRecord.livekit_room_name) {
      await admin.from('interviews').update({ livekit_room_name: roomName }).eq('id', interviewId)
    }

    const livekitConfig = getLiveKitConfigForRegion('self-hosted')

    const token = await createLiveKitAccessToken({
      roomName,
      identity: identity || candidateId,
      name,
      metadata,
      config: { apiKey: livekitConfig.apiKey, apiSecret: livekitConfig.apiSecret },
    })

    return { status: 200, body: { token, roomName, url: livekitConfig.wsUrl } }
  } catch (error) {
    console.error('Error generating LiveKit token:', error)
    return { status: 500, body: { error: 'Failed to generate LiveKit token' } }
  }
}

