import { createAdminClient } from '../supabase/admin'
import { asRecord, getOptionalString } from '../utils/parse'

async function issueAzureSpeechToken(): Promise<
  { ok: true; token: string; region: string } | { ok: false; error: string; status: number }
> {
  const speechKey = process.env.AZURE_SPEECH_KEY
  const speechRegion = process.env.AZURE_SPEECH_REGION

  if (!speechKey || !speechRegion) {
    return { ok: false, error: 'Azure Speech credentials not configured', status: 500 }
  }

  const tokenResponse = await fetch(`https://${speechRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': speechKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  })

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text().catch(() => '')
    console.error('Failed to get Azure Speech token:', text)
    return { ok: false, error: 'Failed to get token', status: 500 }
  }

  const token = await tokenResponse.text()
  return { ok: true, token, region: speechRegion }
}

async function isValidCandidate(candidateId: string): Promise<boolean> {
  if (!candidateId) return false

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.from('candidates').select('id').eq('id', candidateId).maybeSingle()
    if (error) {
      console.error('Error verifying candidate:', error)
      return false
    }
    return Boolean(data?.id)
  } catch (error) {
    console.error('Error verifying candidate:', error)
    return false
  }
}

async function isValidCopilotInterview(copilotInterviewId: string): Promise<boolean> {
  if (!copilotInterviewId) return false

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.from('copilot_interviews').select('id').eq('id', copilotInterviewId).maybeSingle()
    if (error) {
      console.error('Error verifying copilot interview:', error)
      return false
    }
    return Boolean(data?.id)
  } catch (error) {
    console.error('Error verifying copilot interview:', error)
    return false
  }
}

export type AzureSpeechTokenResponse =
  | { status: 200; body: { token: string; region: string; success?: boolean } }
  | { status: 401 | 500; body: { error: string } }

export async function handleAzureSpeechToken(payload: unknown): Promise<AzureSpeechTokenResponse> {
  const record = asRecord(payload) ?? {}
  const userId = getOptionalString(record, 'userId')
  const candidateId = getOptionalString(record, 'candidateId')
  const copilotInterviewId = getOptionalString(record, 'copilotInterviewId')

  if (!userId) {
    const isCandidateAllowed = candidateId ? await isValidCandidate(candidateId) : false
    const isCopilotAllowed = copilotInterviewId ? await isValidCopilotInterview(copilotInterviewId) : false

    if (!isCandidateAllowed && !isCopilotAllowed) {
      return { status: 401, body: { error: 'Unauthorized' } }
    }
  }

  const issued = await issueAzureSpeechToken()
  if (!issued.ok) {
    return { status: issued.status as 500, body: { error: issued.error } }
  }

  return { status: 200, body: { success: true, token: issued.token, region: issued.region } }
}

