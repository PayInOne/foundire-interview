import { asRecord, getString } from '../utils/parse'

export type LiveAvatarKeepAliveResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 500; body: Record<string, unknown> }

export async function handleLiveAvatarKeepAlive(body: unknown): Promise<LiveAvatarKeepAliveResponse> {
  try {
    const record = asRecord(body) ?? {}
    const sessionId = getString(record, 'sessionId')

    if (!sessionId) {
      return { status: 400, body: { error: 'Session ID is required' } }
    }

    const apiKey = process.env.HEYGEN_API_KEY
    if (!apiKey) {
      return { status: 500, body: { error: 'HeyGen API key not configured' } }
    }

    const response = await fetch('https://api.liveavatar.com/v1/sessions/keep-alive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({ session_id: sessionId }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      return { status: response.status as 500, body: { error: 'Failed to refresh session', details: errorText } }
    }

    return { status: 200, body: { success: true } }
  } catch (error) {
    console.error('[LiveAvatar KeepAlive] Error:', error)
    return { status: 500, body: { error: 'Internal server error' } }
  }
}

