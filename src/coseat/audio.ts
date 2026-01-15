import { createAdminClient } from '../supabase/admin'
import { getR2ObjectStream, headR2Object } from '../cloudflare/r2'

export type CoseatAudioResult =
  | { status: 200; headers: Record<string, string>; stream: NodeJS.ReadableStream }
  | { status: 401 | 403 | 404 | 500; headers: Record<string, string>; body: Record<string, unknown> }

function withCorsHeaders(headers: Record<string, string>): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    ...headers,
  }
}

export async function handleGetCoseatAudio(
  coseatInterviewId: string,
  userId: string
): Promise<CoseatAudioResult> {
  const headers = withCorsHeaders({})

  try {
    if (!userId) {
      return { status: 401, headers, body: { error: 'Unauthorized' } }
    }

    const adminSupabase = createAdminClient()

    const { data: coseatInterview, error: fetchError } = await adminSupabase
      .from('coseat_interviews')
      .select('id, company_id, audio_recording_key')
      .eq('id', coseatInterviewId)
      .single()

    if (fetchError || !coseatInterview) {
      return { status: 404, headers, body: { error: 'CoSeat interview not found' } }
    }

    const record = coseatInterview as { company_id: string; audio_recording_key: string | null }

    const { data: membership } = await adminSupabase
      .from('company_members')
      .select('id')
      .eq('user_id', userId)
      .eq('company_id', record.company_id)
      .is('deleted_at', null)
      .single()

    if (!membership) {
      return { status: 403, headers, body: { error: 'Unauthorized to access this recording' } }
    }

    if (!record.audio_recording_key) {
      return { status: 404, headers, body: { error: 'No recording available' } }
    }

    const key = record.audio_recording_key

    let contentType = 'audio/webm'
    let contentLength: number | null = null
    try {
      const head = await headR2Object(key)
      if (head.contentType) contentType = head.contentType
      contentLength = head.contentLength
    } catch (headError) {
      console.error('Failed to get file metadata:', headError)
    }

    const { stream } = await getR2ObjectStream(key)

    return {
      status: 200,
      headers: withCorsHeaders({
        'Content-Type': contentType,
        ...(contentLength !== null ? { 'Content-Length': contentLength.toString() } : {}),
        'Cache-Control': 'public, max-age=3600',
      }),
      stream,
    }
  } catch (error) {
    console.error('Error in GET /internal/coseat/[id]/audio:', error)
    return { status: 500, headers, body: { error: 'Failed to stream audio' } }
  }
}
