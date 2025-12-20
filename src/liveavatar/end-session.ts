import { asRecord, getOptionalString, getString } from '../utils/parse'

export type LiveAvatarEndSessionResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 500; body: Record<string, unknown> }

export async function handleLiveAvatarEndSession(body: unknown): Promise<LiveAvatarEndSessionResponse> {
  try {
    const record = asRecord(body) ?? {}
    const sessionId = getOptionalString(record, 'sessionId') || ''

    if (!sessionId) {
      return { status: 200, body: { success: true } }
    }

    const apiKey = process.env.HEYGEN_API_KEY
    if (!apiKey) {
      return { status: 500, body: { success: false, error: 'API key not configured' } }
    }

    try {
      const response = await fetch('https://api.liveavatar.com/v1/sessions/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ session_id: sessionId }),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        console.error('[LiveAvatar Custom] Failed to stop session:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        })
      }
    } catch (error) {
      console.error('[LiveAvatar Custom] Error calling stop_session API:', error)
    }

    return { status: 200, body: { success: true } }
  } catch (error) {
    console.error('Error in end-session endpoint:', error)
    return { status: 200, body: { success: true } }
  }
}

