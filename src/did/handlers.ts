import { asRecord, getOptionalString, getString } from '../utils/parse'

const DID_API_URL = 'https://api.d-id.com'

export const DEFAULT_DID_PRESENTER_URL = 'https://d-id-public-bucket.s3.amazonaws.com/alice.jpg'

export type DidResponse =
  | { status: 200; body: unknown }
  | { status: 400 | 500; body: Record<string, unknown> }

function getDidApiKey(): string | null {
  const apiKey = process.env.DID_API_KEY
  if (!apiKey) return null
  return apiKey
}

type BasicResponse = {
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
  text(): Promise<string>
}

async function getErrorBody(response: BasicResponse): Promise<string> {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const json = await response.json().catch(() => null)
    return json ? JSON.stringify(json) : ''
  }
  return response.text().catch(() => '')
}

export async function handleGetDidAgent(): Promise<DidResponse> {
  const agentId = process.env.DID_AGENT_ID
  const clientKey = process.env.DID_CLIENT_KEY

  if (!agentId) {
    return { status: 500, body: { error: 'DID_AGENT_ID is not configured' } }
  }

  if (!clientKey) {
    return { status: 500, body: { error: 'DID_CLIENT_KEY is not configured' } }
  }

  return {
    status: 200,
    body: {
      agentId,
      clientKey,
    },
  }
}

export async function handleCreateDidStream(body: unknown): Promise<DidResponse> {
  const apiKey = getDidApiKey()
  if (!apiKey) {
    return { status: 500, body: { error: 'DID_API_KEY is not configured' } }
  }

  const record = asRecord(body) ?? {}
  const presenterUrl = getOptionalString(record, 'presenterUrl') || DEFAULT_DID_PRESENTER_URL

  const response = await fetch(`${DID_API_URL}/talks/streams`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ source_url: presenterUrl }),
  })

  if (!response.ok) {
    const errorBody = await getErrorBody(response)
    return { status: 500, body: { error: `D-ID API error: ${response.status} ${errorBody}` } }
  }

  const result = await response.json().catch(() => null)
  if (!result) {
    return { status: 500, body: { error: 'Invalid JSON from D-ID API' } }
  }

  return { status: 200, body: result }
}

export async function handleDeleteDidStream(params: { sessionId: string }): Promise<DidResponse> {
  const apiKey = getDidApiKey()
  if (!apiKey) {
    return { status: 500, body: { error: 'DID_API_KEY is not configured' } }
  }

  const sessionId = params.sessionId.trim()
  if (!sessionId) {
    return { status: 400, body: { error: 'sessionId is required' } }
  }

  const response = await fetch(`${DID_API_URL}/talks/streams/${sessionId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Basic ${apiKey}`,
    },
  })

  if (!response.ok) {
    const errorBody = await getErrorBody(response)
    return { status: 500, body: { error: `D-ID API error: ${response.status} ${errorBody}` } }
  }

  return { status: 200, body: { success: true } }
}

export async function handleDidSdp(body: unknown): Promise<DidResponse> {
  const apiKey = getDidApiKey()
  if (!apiKey) {
    return { status: 500, body: { error: 'DID_API_KEY is not configured' } }
  }

  const record = asRecord(body)
  if (!record) {
    return { status: 400, body: { error: 'Invalid request body' } }
  }

  const sessionId = getString(record, 'sessionId')
  const answer = record.answer
  const session_id = getString(record, 'session_id')

  if (!sessionId || !session_id || !answer) {
    return { status: 400, body: { error: 'sessionId, answer, and session_id are required' } }
  }

  const response = await fetch(`${DID_API_URL}/talks/streams/${sessionId}/sdp`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ answer, session_id }),
  })

  if (!response.ok) {
    const errorBody = await getErrorBody(response)
    return { status: 500, body: { error: `D-ID API error: ${response.status} ${errorBody}` } }
  }

  const result = await response.json().catch(() => null)
  if (!result) {
    return { status: 500, body: { error: 'Invalid JSON from D-ID API' } }
  }

  return { status: 200, body: result }
}

export async function handleDidTalk(body: unknown): Promise<DidResponse> {
  const apiKey = getDidApiKey()
  if (!apiKey) {
    return { status: 500, body: { error: 'DID_API_KEY is not configured' } }
  }

  const record = asRecord(body)
  if (!record) {
    return { status: 400, body: { error: 'Invalid request body' } }
  }

  const sessionId = getString(record, 'sessionId')
  const text = getString(record, 'text')
  const streamId = getOptionalString(record, 'streamId')

  if (!sessionId || !text) {
    return { status: 400, body: { error: 'sessionId and text are required' } }
  }

  const url = `${DID_API_URL}/talks/streams/${sessionId}${streamId ? `/streams/${streamId}` : ''}`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      script: {
        type: 'text',
        input: text,
        provider: {
          type: 'microsoft',
          voice_id: 'en-US-JennyNeural',
        },
      },
    }),
  })

  if (!response.ok) {
    const errorBody = await getErrorBody(response)
    return { status: 500, body: { error: `D-ID API error: ${response.status} ${errorBody}` } }
  }

  const result = await response.json().catch(() => null)
  if (!result) {
    return { status: 500, body: { error: 'Invalid JSON from D-ID API' } }
  }

  return { status: 200, body: result }
}
