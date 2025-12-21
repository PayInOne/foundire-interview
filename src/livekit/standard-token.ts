import { createAdminClient } from '../supabase/admin'
import { createLiveKitAccessToken } from './tokens'
import { getLiveKitRoomName } from './server'
import {
  getCountryFromHeaders,
  getLiveKitConfigForRegion,
  getRegionFromCountry,
  selectRegionWithFallback,
  type LiveKitRegion,
} from './geo-routing'
import { asRecord, getOptionalString, getString } from '../utils/parse'

export type LiveKitTokenResponse =
  | {
      status: 200
      body: { token: string; roomName: string; url: string; livekitRegion: LiveKitRegion; usedFallback: boolean }
    }
  | { status: 400 | 403 | 404 | 500; body: { error: string } }

function parseRegion(value: unknown): LiveKitRegion | null {
  return value === 'self-hosted' || value === 'cloud' ? value : null
}

export async function handleCreateLiveKitToken(params: {
  body: unknown
  headers?: Record<string, string | string[] | undefined>
}): Promise<LiveKitTokenResponse> {
  try {
    const record = asRecord(params.body) ?? {}

    const interviewId = getString(record, 'interviewId')
    const candidateId = getString(record, 'candidateId')
    const identity = getOptionalString(record, 'identity')
    const name = getOptionalString(record, 'name')
    const metadata = getOptionalString(record, 'metadata')
    const countryCodeFromBody = getOptionalString(record, 'countryCode')
    const countryCode =
      (countryCodeFromBody ? countryCodeFromBody.toUpperCase() : null) ??
      (params.headers ? getCountryFromHeaders(params.headers) : null)

    if (!interviewId || !candidateId) {
      return { status: 400, body: { error: 'Missing interviewId or candidateId' } }
    }

    const admin = createAdminClient()

    let interview: unknown = null
    let error: { code?: string } | null = null
    let supportsLivekitRegion = true

    ;({ data: interview, error } = await admin
      .from('interviews')
      .select('id, candidate_id, livekit_room_name, livekit_region')
      .eq('id', interviewId)
      .single())

    if (error?.code === '42703') {
      supportsLivekitRegion = false
      ;({ data: interview, error } = await admin
        .from('interviews')
        .select('id, candidate_id, livekit_room_name')
        .eq('id', interviewId)
        .single())
    }

    if (error || !interview) {
      return { status: 404, body: { error: 'Interview not found' } }
    }

    const interviewRecord = interview as {
      candidate_id: string | null
      livekit_room_name: string | null
      livekit_region?: unknown
    }
    if (interviewRecord.candidate_id !== candidateId) {
      return { status: 403, body: { error: 'Candidate does not match interview' } }
    }

    const roomName = interviewRecord.livekit_room_name ?? getLiveKitRoomName(interviewId)

    if (!interviewRecord.livekit_room_name) {
      await admin.from('interviews').update({ livekit_room_name: roomName }).eq('id', interviewId)
    }

    const existingRegion = parseRegion(interviewRecord.livekit_region)
    let livekitRegion: LiveKitRegion
    let usedFallback = false
    let livekitConfig

    if (existingRegion) {
      livekitRegion = existingRegion
      livekitConfig = getLiveKitConfigForRegion(existingRegion)
    } else {
      const preferredRegion = getRegionFromCountry(countryCode)
      const selection = await selectRegionWithFallback(preferredRegion)
      livekitConfig = selection.config
      livekitRegion = selection.actualRegion
      usedFallback = selection.usedFallback

      if (supportsLivekitRegion) {
        const { data: updatedRows, error: regionError } = await admin
          .from('interviews')
          .update({ livekit_region: livekitRegion })
          .eq('id', interviewId)
          .is('livekit_region', null)
          .select('livekit_region')

        if (regionError) {
          console.warn('Failed to persist interviews.livekit_region, continuing without it:', regionError)
        } else if (Array.isArray(updatedRows) && updatedRows.length === 0) {
          const { data: current, error: currentError } = await admin
            .from('interviews')
            .select('livekit_region')
            .eq('id', interviewId)
            .single()

          if (currentError) {
            console.warn('Failed to reload interviews.livekit_region, continuing:', currentError)
          } else {
            const lockedRegion = parseRegion((current as { livekit_region?: unknown } | null)?.livekit_region)
            if (lockedRegion) {
              livekitRegion = lockedRegion
              livekitConfig = getLiveKitConfigForRegion(lockedRegion)
              usedFallback = lockedRegion !== preferredRegion
            }
          }
        }
      }
    }

    const token = await createLiveKitAccessToken({
      roomName,
      identity: identity || candidateId,
      name,
      metadata,
      config: { apiKey: livekitConfig.apiKey, apiSecret: livekitConfig.apiSecret },
    })

    return { status: 200, body: { token, roomName, url: livekitConfig.wsUrl, livekitRegion, usedFallback } }
  } catch (error) {
    console.error('Error generating LiveKit token:', error)
    return { status: 500, body: { error: 'Failed to generate LiveKit token' } }
  }
}
