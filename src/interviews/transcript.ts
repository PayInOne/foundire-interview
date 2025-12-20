import { createAdminClient } from '../supabase/admin'
import { toJson } from '../supabase/json'

export type TranscriptResponse =
  | { status: 200; body: { success: true } }
  | { status: 400 | 500; body: { error: string } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export async function handleSaveTranscript(body: unknown): Promise<TranscriptResponse> {
  const record = isRecord(body) ? body : null

  const interviewId = typeof record?.interviewId === 'string' ? record.interviewId : ''
  if (!interviewId) {
    return { status: 400, body: { error: 'Missing interviewId' } }
  }

  const question = typeof record?.question === 'string' ? record.question : ''
  const answer = typeof record?.answer === 'string' ? record.answer : ''
  const message = record?.message

  const isQAFormat = Boolean(question && answer)
  const isConversationalFormat =
    isRecord(message) && typeof message.speaker === 'string' && typeof message.text === 'string' && Boolean(message.text)

  if (!isQAFormat && !isConversationalFormat) {
    return {
      status: 400,
      body: { error: 'Missing required fields. Provide either (question, answer) or (message)' },
    }
  }

  try {
    const adminClient = createAdminClient()

    const { data: interview, error: fetchError } = await adminClient
      .from('interviews')
      .select('transcript, interview_mode')
      .eq('id', interviewId)
      .single()

    if (fetchError) {
      return { status: 500, body: { error: `Failed to fetch interview: ${fetchError.message}` } }
    }

    const existingTranscript = (interview as unknown as { transcript?: unknown } | null)?.transcript
    const transcriptEntries: unknown[] = Array.isArray(existingTranscript) ? existingTranscript : []

    const updatedTranscript = isQAFormat
      ? [...transcriptEntries, { question, answer }]
      : [...transcriptEntries, message]

    const { error: updateError } = await adminClient
      .from('interviews')
      .update({ transcript: toJson(updatedTranscript) })
      .eq('id', interviewId)

    if (updateError) {
      return { status: 500, body: { error: `Failed to update transcript: ${updateError.message}` } }
    }

    return { status: 200, body: { success: true } }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return { status: 500, body: { error: message } }
  }
}

