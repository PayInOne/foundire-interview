import { enqueueInterviewAnalyzeTask } from '../../workers/interview-analyze'
import { createAdminClient } from '../../supabase/admin'
import { requireInternalAuth } from '../auth'
import { asRecord, readJsonBody, sendJson } from '../http'
import type { RouteHandler } from '../types'

function parseAnalyzeBody(value: unknown): { interviewId: string; locale: string; sendEmail: boolean } | null {
  const record = asRecord(value)
  if (!record) return null

  const interviewId = typeof record.interviewId === 'string' ? record.interviewId.trim() : ''
  if (!interviewId) return null

  const locale = typeof record.locale === 'string' && record.locale.trim() ? record.locale : 'en'
  const sendEmail = typeof record.sendEmail === 'boolean' ? record.sendEmail : true

  return { interviewId, locale, sendEmail }
}

async function markInterviewCompletedBeforeAnalyze(interviewId: string): Promise<void> {
  try {
    const supabase = createAdminClient()
    const now = new Date().toISOString()

    const { data: interview, error } = await supabase
      .from('interviews')
      .select('status, completed_at, candidate_id')
      .eq('id', interviewId)
      .maybeSingle()

    if (error) {
      console.warn('[Analyze] Failed to fetch interview status before enqueue:', error)
      return
    }

    if (!interview) {
      return
    }

    const record = interview as { status?: string | null; completed_at?: string | null; candidate_id?: string | null }
    const status = record.status || null
    const completedAt = record.completed_at || null
    const candidateId = record.candidate_id || null

    const shouldMarkCompleted = status === 'in-progress' || status === 'paused' || status === null
    const shouldSetCompletedAt = !completedAt

    if (shouldMarkCompleted || shouldSetCompletedAt) {
      const update: Record<string, unknown> = {}
      if (shouldMarkCompleted) update.status = 'completed'
      if (shouldSetCompletedAt) update.completed_at = now

      const { error: updateError } = await supabase
        .from('interviews')
        .update(update)
        .eq('id', interviewId)

      if (updateError) {
        console.warn('[Analyze] Failed to mark interview completed before enqueue:', updateError)
      }
    }

    if (candidateId && (shouldMarkCompleted || status === 'completed')) {
      const { error: candidateError } = await supabase
        .from('candidates')
        .update({ status: 'completed' })
        .eq('id', candidateId)

      if (candidateError) {
        console.warn('[Analyze] Failed to mark candidate completed before enqueue:', candidateError)
      }
    }
  } catch (error) {
    console.warn('[Analyze] Unexpected error marking interview completed before enqueue:', error)
  }
}

export const handleInternalAnalyzeRoute: RouteHandler = async ({ req, res, method, pathname }) => {
  if (method !== 'POST' || pathname !== '/internal/interviews/analyze') {
    return false
  }

  if (!requireInternalAuth(req, res)) return true

  if (!process.env.RABBITMQ_URL) {
    sendJson(res, 503, { error: 'RabbitMQ is not configured' })
    return true
  }

  const body = await readJsonBody(req)
  const parsed = parseAnalyzeBody(body)
  if (!parsed) {
    sendJson(res, 400, { error: 'Invalid request body' })
    return true
  }

  await markInterviewCompletedBeforeAnalyze(parsed.interviewId)
  await enqueueInterviewAnalyzeTask(parsed)

  sendJson(res, 200, { success: true, mode: 'queued', interviewId: parsed.interviewId })
  return true
}
