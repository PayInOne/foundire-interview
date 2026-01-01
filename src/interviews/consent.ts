import { createAdminClient } from '../supabase/admin'

export type InterviewConsentResponse =
  | { status: 200; body: { success: true } }
  | { status: 400 | 404 | 500; body: { error: string } }

function parseConsent(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

export async function handleInterviewConsent(interviewId: string, body: unknown): Promise<InterviewConsentResponse> {
  if (!interviewId) {
    return { status: 400, body: { error: 'Missing interview ID' } }
  }

  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  const consent = parseConsent(record?.consent)
  if (consent === null) {
    return { status: 400, body: { error: 'consent must be boolean' } }
  }

  try {
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('interviews')
      .update({
        candidate_recording_consent: consent,
        consent_timestamp: new Date().toISOString(),
      })
      .eq('id', interviewId)

    if (error) {
      return { status: 500, body: { error: error.message } }
    }

    return { status: 200, body: { success: true } }
  } catch (error) {
    return {
      status: 500,
      body: { error: error instanceof Error ? error.message : 'Internal server error' },
    }
  }
}
