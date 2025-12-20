import { getLiveKitConfigForRegion } from '../livekit/geo-routing'
import { createLiveKitAccessToken } from '../livekit/tokens'
import { asRecord, getOptionalString, getString } from '../utils/parse'

export type LiveAvatarCreateSessionResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 500; body: Record<string, unknown> }

export async function handleCreateLiveAvatarCustomSession(body: unknown): Promise<LiveAvatarCreateSessionResponse> {
  try {
    const record = asRecord(body) ?? {}
    const interviewId = getString(record, 'interviewId')
    const avatarId = getString(record, 'avatarId')
    const language = getString(record, 'language')

    if (!interviewId || !avatarId || !language) {
      return {
        status: 400,
        body: { error: 'Missing required fields: interviewId, avatarId, language' },
      }
    }

    const apiKey = process.env.HEYGEN_API_KEY
    if (!apiKey) {
      return { status: 500, body: { error: 'HEYGEN_API_KEY not configured' } }
    }

    const effectiveContextId = process.env.HEYGEN_CONTEXT_ID

    const livekitConfig = getLiveKitConfigForRegion('self-hosted')

    const roomName = `avatar-session-${interviewId}-${Date.now()}`
    const wsUrl = livekitConfig.wsUrl

    const avatarToken = await createLiveKitAccessToken({
      roomName,
      identity: `avatar-${interviewId}`,
      name: 'AI Interviewer',
      canPublishData: true,
      config: { apiKey: livekitConfig.apiKey, apiSecret: livekitConfig.apiSecret },
    })

    const tokenResponse = await fetch('https://api.liveavatar.com/v1/sessions/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        mode: 'CUSTOM',
        avatar_id: avatarId,
        avatar_persona: {
          context_id: effectiveContextId,
          language: language || 'en',
          ...(language !== 'zh' && { voice_id: 'ef957f11-fc52-46ce-b04a-a2c881d20d5f' }),
        },
        livekit_config: {
          livekit_url: wsUrl,
          livekit_room: roomName,
          livekit_client_token: avatarToken,
        },
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text().catch(() => '')
      return { status: 500, body: { error: `Failed to create session token: ${tokenResponse.status} ${errorText}` } }
    }

    const tokenData = (await tokenResponse.json().catch(() => null)) as Record<string, unknown> | null
    if (!tokenData || (tokenData.code as number | undefined) !== 1000) {
      return { status: 500, body: { error: `LiveAvatar API error: ${(tokenData?.message as string | undefined) || 'Unknown error'}` } }
    }

    const tokenPayload = tokenData.data as { session_token?: string; session_id?: string } | undefined
    const sessionToken = tokenPayload?.session_token
    const sessionId = tokenPayload?.session_id

    if (!sessionToken || !sessionId) {
      return { status: 500, body: { error: 'LiveAvatar API returned invalid session token' } }
    }

    const startResponse = await fetch('https://api.liveavatar.com/v1/sessions/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({}),
    })

    if (!startResponse.ok) {
      const errorText = await startResponse.text().catch(() => '')
      return { status: 500, body: { error: `Failed to start session: ${startResponse.status} ${errorText}` } }
    }

    const startData = (await startResponse.json().catch(() => null)) as Record<string, unknown> | null
    if (!startData || (startData.code as number | undefined) !== 1000) {
      return { status: 500, body: { error: `LiveAvatar API error: ${(startData?.message as string | undefined) || 'Unknown error'}` } }
    }

    const wsControlUrl = getOptionalString(asRecord(startData.data) ?? {}, 'ws_url') || ''

    const clientToken = await createLiveKitAccessToken({
      roomName,
      identity: `user-${interviewId}`,
      name: 'Candidate',
      canPublishData: true,
      config: { apiKey: livekitConfig.apiKey, apiSecret: livekitConfig.apiSecret },
    })

    return {
      status: 200,
      body: {
        sessionId,
        livekitUrl: wsUrl,
        livekitToken: clientToken,
        livekitRoomName: roomName,
        wsUrl: wsControlUrl,
      },
    }
  } catch (error) {
    console.error('[LiveAvatar Custom] Error creating custom session:', error)
    const message = error instanceof Error ? error.message : 'Failed to create custom session'
    return { status: 500, body: { error: message } }
  }
}

