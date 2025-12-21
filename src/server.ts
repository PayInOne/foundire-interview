import http from 'node:http'
import { enqueueInterviewAnalyzeTask } from './workers/interview-analyze'
import { createAdminClient } from './supabase/admin'
import { generateQuestionsForInterview } from './interviews/questions'
import { handleConversation } from './interviews/conversation'
import { analyzeCandidateMessage } from './openai/analyze-message'
import { evaluateTopicPerformance } from './openai/topic-evaluation'
import { handleInterviewHeartbeat } from './interviews/heartbeat'
import { handleSaveTranscript } from './interviews/transcript'
import { handleLiveKitStart, handleLiveKitStop } from './interviews/livekit-recording'
import { handleCreateInterview } from './interviews/create'
import { handleGetInterview } from './interviews/get'
import { handleGetConversationState, handleUpdateConversationState } from './interviews/state'
import { handleVerifyInterviewCode } from './interview-codes/verify'
import { handleUseInterviewCode } from './interview-codes/use'
import { handleCleanupStandardInterviews } from './interviews/cleanup'
import { handleCleanupAllInterviews } from './interviews/cleanup-all'
import { handleCreateCopilotInterview } from './copilot-interviews/create'
import { handleScheduleCopilotInterview, handleGetCopilotSchedule } from './copilot-interviews/schedule'
import { handleConfirmCopilotInterview, handleGetCopilotConfirmInfo } from './copilot-interviews/confirm'
import { handleJoinCopilotInterview } from './copilot-interviews/join'
import { handleGetCopilotInterviewStatus } from './copilot-interviews/status'
import { handleCopilotInterviewHeartbeat } from './copilot-interviews/heartbeat'
import { handleExtendCopilotInterview } from './copilot-interviews/extend'
import { handleToggleCopilotAi } from './copilot-interviews/ai'
import { handleAddCopilotParticipants, handleGetCopilotParticipants } from './copilot-interviews/participants'
import { handleGenerateCopilotSuggestions, handleGetCopilotSuggestions } from './copilot-interviews/suggest'
import { handlePostCopilotTranscript, handleGetCopilotTranscript } from './copilot-interviews/transcript'
import { handleGetCopilotTranscriptCount } from './copilot-interviews/transcript-count'
import { handleStartCopilotInterview } from './copilot-interviews/start'
import { handleCompleteCopilotInterview } from './copilot-interviews/complete'
import {
  handleStartCopilotRecording,
  handleStopCopilotRecording,
  handleGetCopilotRecordingStatus,
} from './copilot-interviews/recording'
import { handleSendCopilotInvitationEmail } from './copilot-interviews/send-invitation'
import { handleCancelCopilotInterview } from './copilot-interviews/cancel'
import { handleCreateLiveKitToken } from './livekit/standard-token'
import { handleLiveKitWebhook } from './livekit/webhook'
import { handleScheduleCoseatInterview, handleGetActiveCoseatInterview } from './coseat/schedule'
import { handleGetCoseatInterview } from './coseat/get'
import { handleToggleCoseatAi } from './coseat/ai'
import { handleCoseatHeartbeat } from './coseat/heartbeat'
import { handlePostCoseatTranscript, handleGetCoseatTranscript } from './coseat/transcript'
import { handleGetCoseatSuggestions, handleGenerateCoseatSuggestions } from './coseat/suggestions'
import { handleStartCoseatSession, handleEndCoseatSession, handleUploadCoseatRecording } from './coseat/session'
import { handleGetCoseatAudio } from './coseat/audio'
import { handleGetCoseatProfile, handlePostCoseatProfile, handleDeleteCoseatProfile } from './coseat/profile'
import { handleAzureSpeechToken } from './azure/speech-token'
import { handleAzureTts } from './azure/tts'
import { handleAzureSpeechRecognize } from './azure/speech-recognize'
import { handleCreateLiveAvatarCustomSession } from './liveavatar/create-custom-session'
import { handleLiveAvatarKeepAlive } from './liveavatar/keep-alive'
import { handleLiveAvatarEndSession } from './liveavatar/end-session'
import { handleDigitalHumanConfig } from './digital-human/config'
import {
  handleCreateDidStream,
  handleDeleteDidStream,
  handleDidSdp,
  handleDidTalk,
  handleGetDidAgent,
} from './did/handlers'

function isAuthorized(authHeader: string | null): boolean {
  const token = process.env.INTERNAL_API_TOKEN
  if (!token) return false
  return authHeader === `Bearer ${token}`
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function sendJsonWithHeaders(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string>
) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return null

  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

async function readTextBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks).toString('utf8')
}

async function readFormDataBody(req: http.IncomingMessage, url: URL): Promise<FormData | null> {
  const contentType = req.headers['content-type'] || ''
  if (typeof contentType !== 'string') return null
  if (!contentType.includes('multipart/form-data')) return null

  const request = new Request(url.toString(), {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req as unknown as any,
    duplex: 'half',
  })

  return request.formData()
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

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

function requireInternalAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const token = process.env.INTERNAL_API_TOKEN
  if (!token) {
    sendJson(res, 500, { error: 'INTERNAL_API_TOKEN is not configured' })
    return false
  }

  if (!isAuthorized(req.headers.authorization ?? null)) {
    sendJson(res, 401, { error: 'Unauthorized' })
    return false
  }

  return true
}

export async function startHttpServer({ port }: { port: number }): Promise<void> {
  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method || 'GET'
      const url = new URL(req.url || '/', 'http://localhost')
      const pathname = url.pathname
      const segments = pathname.split('/').filter(Boolean)

      if (method === 'GET' && pathname === '/health') {
        sendJson(res, 200, { ok: true })
        return
      }

      if (method === 'POST' && pathname === '/internal/interviews/analyze') {
        if (!requireInternalAuth(req, res)) return

        if (!process.env.RABBITMQ_URL) {
          sendJson(res, 503, { error: 'RabbitMQ is not configured' })
          return
        }

        const body = await readJsonBody(req)
        const parsed = parseAnalyzeBody(body)
        if (!parsed) {
          sendJson(res, 400, { error: 'Invalid request body' })
          return
        }

        await markInterviewCompletedBeforeAnalyze(parsed.interviewId)
        await enqueueInterviewAnalyzeTask(parsed)

        sendJson(res, 200, { success: true, mode: 'queued', interviewId: parsed.interviewId })
        return
      }

      if (pathname.startsWith('/internal/')) {
        if (!requireInternalAuth(req, res)) return
      }

      if (method === 'POST' && pathname === '/internal/interviews/create') {
        const body = await readJsonBody(req)
        const response = await handleCreateInterview(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/interviews/cleanup') {
        const response = await handleCleanupStandardInterviews()
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/interviews/cleanup-all') {
        const response = await handleCleanupAllInterviews()
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/interview-codes/verify') {
        const body = await readJsonBody(req)
        const response = await handleVerifyInterviewCode(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/interview-codes/use') {
        const body = await readJsonBody(req)
        const response = await handleUseInterviewCode(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/interviews/questions') {
        const body = await readJsonBody(req)
        const record = asRecord(body)
        if (!record) {
          sendJson(res, 400, { error: 'Invalid request body' })
          return
        }

        const interviewId = typeof record.interviewId === 'string' ? record.interviewId : ''
        const jobTitle = typeof record.jobTitle === 'string' ? record.jobTitle : ''
        if (!interviewId || !jobTitle) {
          sendJson(res, 400, { error: 'Missing required fields' })
          return
        }

        const result = await generateQuestionsForInterview({
          interviewId,
          jobId: typeof record.jobId === 'string' ? record.jobId : undefined,
          jobTitle,
          jobDescription: typeof record.jobDescription === 'string' ? record.jobDescription : undefined,
          requirements: record.requirements,
          candidateId: typeof record.candidateId === 'string' ? record.candidateId : undefined,
          interviewDuration: record.interviewDuration,
          language: typeof record.language === 'string' ? record.language : undefined,
        })

        sendJson(res, 200, {
          question: result.question,
          allQuestions: result.allQuestions,
          presetQuestionsCount: result.presetQuestionsCount,
          aiQuestionsCount: result.aiQuestionsCount,
        })
        return
      }

      if (method === 'POST' && pathname === '/internal/interviews/conversation') {
        const body = await readJsonBody(req)
        const record = asRecord(body)
        if (!record) {
          sendJson(res, 400, { error: 'Invalid request body' })
          return
        }

        const interviewId = typeof record.interviewId === 'string' ? record.interviewId : ''
        const userMessage = typeof record.userMessage === 'string' ? record.userMessage : ''
        const currentTopic = typeof record.currentTopic === 'string' ? record.currentTopic : ''

        if (!interviewId || !userMessage || !currentTopic) {
          sendJson(res, 400, {
            error: 'Missing required fields',
            details: {
              hasInterviewId: Boolean(interviewId),
              hasUserMessage: Boolean(userMessage),
              hasCurrentTopic: Boolean(currentTopic),
            },
          })
          return
        }

        const response = await handleConversation({
          interviewId,
          userMessage,
          currentTopic,
          topicsCovered: Array.isArray(record.topicsCovered) ? (record.topicsCovered as unknown[]) : [],
          conversationHistory: Array.isArray(record.conversationHistory) ? (record.conversationHistory as unknown[]) : [],
          isScreenSharing: Boolean(record.isScreenSharing),
          remainingMinutes: typeof record.remainingMinutes === 'number' ? record.remainingMinutes : Number(record.remainingMinutes || 0),
          language: typeof record.language === 'string' ? record.language : undefined,
          allTopics: Array.isArray(record.allTopics) ? (record.allTopics as unknown[]).filter((t): t is string => typeof t === 'string') : undefined,
        })

        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/interviews/analyze-message') {
        const body = await readJsonBody(req)
        const record = asRecord(body)
        if (!record) {
          sendJson(res, 400, { error: 'Invalid request body' })
          return
        }

        const message = typeof record.message === 'string' ? record.message : ''
        const currentTopic = typeof record.currentTopic === 'string' ? record.currentTopic : ''
        const language = typeof record.language === 'string' ? record.language : 'en'

        if (!message || !currentTopic) {
          sendJson(res, 400, { error: 'Missing required fields' })
          return
        }

        const analysis = await analyzeCandidateMessage({ message, currentTopic, language })
        sendJson(res, 200, { success: true, analysis })
        return
      }

      if (method === 'POST' && pathname === '/internal/interviews/evaluate-topic') {
        const body = await readJsonBody(req)
        const record = asRecord(body)
        if (!record) {
          sendJson(res, 400, { error: 'Invalid request body' })
          return
        }

        const topic = typeof record.topic === 'string' ? record.topic : ''
        const conversation = Array.isArray(record.conversation) ? record.conversation : []
        const language = typeof record.language === 'string' ? record.language : 'en'

        if (!topic || conversation.length === 0) {
          sendJson(res, 400, { error: 'Missing required fields: topic and conversation' })
          return
        }

        const evaluation = await evaluateTopicPerformance({
          topic,
          conversation: conversation as Array<{ speaker: string; text: string; timestamp?: string }>,
          language,
        })

        sendJson(res, 200, { success: true, evaluation })
        return
      }

      if (method === 'POST' && pathname === '/internal/interviews/heartbeat') {
        const body = await readJsonBody(req)
        const record = asRecord(body)
        const interviewId = typeof record?.interviewId === 'string' ? record.interviewId : ''

        const response = await handleInterviewHeartbeat(interviewId)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/interviews/transcript') {
        const body = await readJsonBody(req)
        const response = await handleSaveTranscript(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/interviews/livekit/start') {
        const body = await readJsonBody(req)
        const response = await handleLiveKitStart(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/interviews/livekit/stop') {
        const body = await readJsonBody(req)
        const response = await handleLiveKitStop(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/livekit/token') {
        const body = await readJsonBody(req)
        const response = await handleCreateLiveKitToken({
          body,
          headers: req.headers as Record<string, string | string[] | undefined>,
        })
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/livekit/webhook') {
        const rawBody = await readTextBody(req)
        const forwardedAuthHeader = req.headers['x-livekit-authorization']
        const forwardedAuth =
          typeof forwardedAuthHeader === 'string'
            ? forwardedAuthHeader
            : Array.isArray(forwardedAuthHeader)
              ? forwardedAuthHeader[0] || ''
              : ''

        const response = await handleLiveKitWebhook({ rawBody, authorization: forwardedAuth })
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'GET' && pathname === '/internal/livekit/webhook') {
        sendJson(res, 200, { status: 'LiveKit webhook endpoint active (Custom Mode)' })
        return
      }

      if (method === 'GET' && pathname === '/internal/azure-speech/token') {
        const userId = url.searchParams.get('userId') || undefined
        const candidateId = url.searchParams.get('candidateId') || undefined
        const copilotInterviewId = url.searchParams.get('copilotInterviewId') || undefined

        const response = await handleAzureSpeechToken({ userId, candidateId, copilotInterviewId })
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/azure-speech/token') {
        const body = await readJsonBody(req)
        const response = await handleAzureSpeechToken(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/azure-speech/recognize') {
        const formData = await readFormDataBody(req, url)
        if (!formData) {
          sendJson(res, 400, { error: 'Invalid form data' })
          return
        }

        const audioFile = formData.get('audio') as File | null
        const locale = typeof formData.get('locale') === 'string' ? (formData.get('locale') as string) : undefined

        if (!audioFile) {
          sendJson(res, 400, { error: 'No audio file provided' })
          return
        }

        const response = await handleAzureSpeechRecognize({ audioFile, locale })
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/azure-tts') {
        const body = await readJsonBody(req)
        const response = await handleAzureTts(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/liveavatar/create-custom-session') {
        const body = await readJsonBody(req)
        const response = await handleCreateLiveAvatarCustomSession(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/liveavatar/keep-alive') {
        const body = await readJsonBody(req)
        const response = await handleLiveAvatarKeepAlive(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/liveavatar/end-session') {
        const body = await readJsonBody(req)
        const response = await handleLiveAvatarEndSession(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'GET' && pathname === '/internal/digital-human/config') {
        const language = url.searchParams.get('language') || undefined
        const interviewId = url.searchParams.get('interviewId') || undefined
        const candidateName = url.searchParams.get('candidateName') || undefined
        const interviewMode = url.searchParams.get('interviewMode') || undefined

        const response = await handleDigitalHumanConfig({
          language,
          interviewId,
          candidateName,
          interviewMode,
        })
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'GET' && pathname === '/internal/did/agent') {
        const response = await handleGetDidAgent()
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/did/stream') {
        const body = await readJsonBody(req)
        const response = await handleCreateDidStream(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'DELETE' && pathname === '/internal/did/stream') {
        const sessionId = url.searchParams.get('sessionId') || ''
        const response = await handleDeleteDidStream({ sessionId })
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/did/sdp') {
        const body = await readJsonBody(req)
        const response = await handleDidSdp(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/did/talk') {
        const body = await readJsonBody(req)
        const response = await handleDidTalk(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/copilot-interviews/create') {
        const body = await readJsonBody(req)
        const response = await handleCreateCopilotInterview(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/coseat/schedule') {
        const body = await readJsonBody(req)
        const response = await handleScheduleCoseatInterview(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'GET' && pathname === '/internal/coseat/schedule') {
        const candidateId = url.searchParams.get('candidateId') || ''
        const userId = url.searchParams.get('userId') || ''
        const response = await handleGetActiveCoseatInterview(candidateId, userId)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'GET' && pathname === '/internal/coseat/profile') {
        const userId = url.searchParams.get('userId') || ''
        const companyId = url.searchParams.get('companyId') || ''
        const response = await handleGetCoseatProfile(userId, companyId)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/coseat/profile') {
        const formData = await readFormDataBody(req, url)
        if (!formData) {
          sendJson(res, 400, { success: false, error: 'Invalid form data' })
          return
        }

        const userId = String(formData.get('userId') || '')
        const companyId = String(formData.get('companyId') || '')
        const language = String(formData.get('language') || 'en-US')
        const voicePrintFeaturesStr = formData.get('voicePrintFeatures')
        const audioFile = formData.get('audio') as File | null

        if (!audioFile) {
          sendJson(res, 400, { success: false, error: 'No audio file provided' })
          return
        }

        const response = await handlePostCoseatProfile({
          userId,
          companyId,
          audioFile,
          language,
          voicePrintFeaturesStr: typeof voicePrintFeaturesStr === 'string' ? voicePrintFeaturesStr : null,
        })
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'DELETE' && pathname === '/internal/coseat/profile') {
        const body = await readJsonBody(req)
        const record = asRecord(body) ?? {}
        const userId = typeof record.userId === 'string' ? record.userId : ''
        const companyId = typeof record.companyId === 'string' ? record.companyId : ''
        const response = await handleDeleteCoseatProfile(userId, companyId)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/copilot-interviews/schedule') {
        const body = await readJsonBody(req)
        const response = await handleScheduleCopilotInterview(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'GET' && pathname === '/internal/copilot-interviews/schedule') {
        const candidateId = url.searchParams.get('candidateId') || ''
        const includeAll = url.searchParams.get('include_all') === 'true'
        const response = await handleGetCopilotSchedule(candidateId, includeAll)
        sendJson(res, response.status, response.body)
        return
      }

      if (segments.length === 3 && segments[0] === 'internal' && segments[1] === 'interviews' && method === 'GET') {
        const interviewId = segments[2]
        const response = await handleGetInterview(interviewId)
        sendJson(res, response.status, response.body)
        return
      }

      if (
        segments.length === 4 &&
        segments[0] === 'internal' &&
        segments[1] === 'copilot-interviews' &&
        segments[2] === 'confirm' &&
        method === 'GET'
      ) {
        const token = segments[3]
        const response = await handleGetCopilotConfirmInfo(token)
        sendJson(res, response.status, response.body)
        return
      }

      if (
        segments.length === 4 &&
        segments[0] === 'internal' &&
        segments[1] === 'copilot-interviews' &&
        segments[2] === 'confirm' &&
        method === 'POST'
      ) {
        const token = segments[3]
        const response = await handleConfirmCopilotInterview(token)
        sendJson(res, response.status, response.body)
        return
      }

      if (segments.length >= 3 && segments[0] === 'internal' && segments[1] === 'copilot-interviews') {
        const copilotInterviewId = segments[2]

        if (segments.length === 4 && segments[3] === 'join' && method === 'POST') {
          const body = await readJsonBody(req)
          const response = await handleJoinCopilotInterview(copilotInterviewId, body)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'status' && method === 'GET') {
          const response = await handleGetCopilotInterviewStatus(copilotInterviewId)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'heartbeat' && method === 'POST') {
          const body = await readJsonBody(req)
          const response = await handleCopilotInterviewHeartbeat(copilotInterviewId, body)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'extend' && method === 'POST') {
          const body = await readJsonBody(req)
          const response = await handleExtendCopilotInterview(copilotInterviewId, body)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'ai' && method === 'PATCH') {
          const body = await readJsonBody(req)
          const response = await handleToggleCopilotAi(copilotInterviewId, body)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'participants' && method === 'POST') {
          const body = await readJsonBody(req)
          const response = await handleAddCopilotParticipants(copilotInterviewId, body)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'participants' && method === 'GET') {
          const userId = url.searchParams.get('userId') || ''
          const response = await handleGetCopilotParticipants(copilotInterviewId, userId)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'suggest' && method === 'POST') {
          const body = await readJsonBody(req)
          const response = await handleGenerateCopilotSuggestions(copilotInterviewId, body)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'suggest' && method === 'GET') {
          const response = await handleGetCopilotSuggestions(copilotInterviewId)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'transcript' && method === 'POST') {
          const body = await readJsonBody(req)
          const response = await handlePostCopilotTranscript(copilotInterviewId, body)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'transcript' && method === 'GET') {
          const userId = url.searchParams.get('userId') || ''
          const response = await handleGetCopilotTranscript(copilotInterviewId, userId)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'transcript-count' && method === 'GET') {
          const response = await handleGetCopilotTranscriptCount(copilotInterviewId)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'start' && method === 'POST') {
          const body = await readJsonBody(req)
          const response = await handleStartCopilotInterview(copilotInterviewId, body)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'complete' && method === 'POST') {
          const response = await handleCompleteCopilotInterview(copilotInterviewId)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 5 && segments[3] === 'recording' && segments[4] === 'start' && method === 'POST') {
          const response = await handleStartCopilotRecording(copilotInterviewId)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 5 && segments[3] === 'recording' && segments[4] === 'stop' && method === 'POST') {
          const response = await handleStopCopilotRecording(copilotInterviewId)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 5 && segments[3] === 'recording' && segments[4] === 'status' && method === 'GET') {
          const response = await handleGetCopilotRecordingStatus(copilotInterviewId)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'send-invitation' && method === 'POST') {
          const body = await readJsonBody(req)
          const response = await handleSendCopilotInvitationEmail(copilotInterviewId, body)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'cancel' && method === 'POST') {
          const body = await readJsonBody(req)
          const response = await handleCancelCopilotInterview(copilotInterviewId, body)
          sendJson(res, response.status, response.body)
          return
        }
      }

      if (method === 'POST' && pathname === '/internal/coseat/session/start') {
        const body = await readJsonBody(req)
        const response = await handleStartCoseatSession(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/coseat/session/end') {
        const body = await readJsonBody(req)
        const response = await handleEndCoseatSession(body)
        sendJson(res, response.status, response.body)
        return
      }

      if (method === 'POST' && pathname === '/internal/coseat/session/upload-recording') {
        const formData = await readFormDataBody(req, url)
        if (!formData) {
          sendJson(res, 400, { success: false, error: 'Invalid form data' })
          return
        }

        const userId = String(formData.get('userId') || '')
        const coseatInterviewId = String(formData.get('coseatInterviewId') || '')
        const durationSeconds = formData.get('durationSeconds')
        const audioFile = formData.get('audio') as File | null

        if (!audioFile || !coseatInterviewId) {
          sendJson(res, 400, { success: false, error: 'audio and coseatInterviewId are required' })
          return
        }

        const response = await handleUploadCoseatRecording({
          userId,
          coseatInterviewId,
          durationSeconds: typeof durationSeconds === 'string' ? durationSeconds : undefined,
          audioFile,
        })
        sendJson(res, response.status, response.body)
        return
      }

      if (segments.length >= 3 && segments[0] === 'internal' && segments[1] === 'coseat') {
        const coseatInterviewId = segments[2]

        if (segments.length === 3 && method === 'GET') {
          const userId = url.searchParams.get('userId') || ''
          const response = await handleGetCoseatInterview(coseatInterviewId, userId)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'ai' && method === 'PATCH') {
          const body = await readJsonBody(req)
          const response = await handleToggleCoseatAi(coseatInterviewId, body)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'heartbeat' && method === 'POST') {
          const response = await handleCoseatHeartbeat(coseatInterviewId)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'transcript' && method === 'POST') {
          const body = await readJsonBody(req)
          const response = await handlePostCoseatTranscript(coseatInterviewId, body)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'transcript' && method === 'GET') {
          const userId = url.searchParams.get('userId') || ''
          const response = await handleGetCoseatTranscript(coseatInterviewId, userId)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'suggestions' && method === 'GET') {
          const response = await handleGetCoseatSuggestions(coseatInterviewId)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'suggestions' && method === 'POST') {
          const body = await readJsonBody(req)
          const response = await handleGenerateCoseatSuggestions(coseatInterviewId, body)
          sendJson(res, response.status, response.body)
          return
        }

        if (segments.length === 4 && segments[3] === 'audio' && method === 'GET') {
          const userId = url.searchParams.get('userId') || ''
          const result = await handleGetCoseatAudio(coseatInterviewId, userId)
          if (result.status === 200) {
            res.writeHead(result.status, result.headers)
            result.stream.pipe(res)
            return
          }

          sendJsonWithHeaders(res, result.status, result.body, result.headers)
          return
        }
      }

      if (
        segments.length === 4 &&
        segments[0] === 'internal' &&
        segments[1] === 'interviews' &&
        segments[3] === 'state' &&
        method === 'GET'
      ) {
        const interviewId = segments[2]
        const response = await handleGetConversationState(interviewId)
        sendJson(res, response.status, response.body)
        return
      }

      if (
        segments.length === 4 &&
        segments[0] === 'internal' &&
        segments[1] === 'interviews' &&
        segments[3] === 'state' &&
        method === 'PUT'
      ) {
        const interviewId = segments[2]
        const body = await readJsonBody(req)
        const record = asRecord(body)
        const conversation_state = record?.conversation_state
        const response = await handleUpdateConversationState(interviewId, conversation_state)
        sendJson(res, response.status, response.body)
        return
      }

      sendJson(res, 404, { error: 'Not found' })
    } catch (error) {
      console.error('HTTP handler error:', error)
      sendJson(res, 500, { error: 'Internal server error' })
    }
  })

  await new Promise<void>((resolve) => {
    server.listen(port, () => resolve())
  })

  console.log(`foundire-interview listening on :${port}`)
}
