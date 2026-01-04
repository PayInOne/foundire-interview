import { handleCreateLiveKitToken } from '../../livekit/standard-token'
import { handleLiveKitWebhook } from '../../livekit/webhook'
import { handleAzureSpeechToken } from '../../azure/speech-token'
import { handleAzureTts } from '../../azure/tts'
import { handleAzureSpeechRecognize } from '../../azure/speech-recognize'
import { handleCreateLiveAvatarCustomSession } from '../../liveavatar/create-custom-session'
import { handleLiveAvatarKeepAlive } from '../../liveavatar/keep-alive'
import { handleLiveAvatarEndSession } from '../../liveavatar/end-session'
import { handleDigitalHumanConfig } from '../../digital-human/config'
import {
  handleCreateDidStream,
  handleDeleteDidStream,
  handleDidSdp,
  handleDidTalk,
  handleGetDidAgent,
} from '../../did/handlers'
import { readFormDataBody, readJsonBody, readTextBody, sendJson } from '../http'
import type { RouteHandler } from '../types'

export const handleInfrastructureRoutes: RouteHandler = async ({ req, res, method, pathname, segments, url }) => {
  if (method === 'POST' && pathname === '/internal/livekit/token') {
    const body = await readJsonBody(req)
    const response = await handleCreateLiveKitToken({
      body,
      headers: req.headers as Record<string, string | string[] | undefined>,
    })
    sendJson(res, response.status, response.body)
    return true
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
    return true
  }

  if (method === 'GET' && pathname === '/internal/livekit/webhook') {
    sendJson(res, 200, { status: 'LiveKit webhook endpoint active (Custom Mode)' })
    return true
  }

  if (method === 'GET' && pathname === '/internal/azure-speech/token') {
    const userId = url.searchParams.get('userId') || undefined
    const candidateId = url.searchParams.get('candidateId') || undefined
    const copilotInterviewId = url.searchParams.get('copilotInterviewId') || undefined

    const response = await handleAzureSpeechToken({ userId, candidateId, copilotInterviewId })
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/azure-speech/token') {
    const body = await readJsonBody(req)
    const response = await handleAzureSpeechToken(body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/azure-speech/recognize') {
    const formData = await readFormDataBody(req, url)
    if (!formData) {
      sendJson(res, 400, { error: 'Invalid form data' })
      return true
    }

    const audioFile = formData.get('audio') as File | null
    const locale = typeof formData.get('locale') === 'string' ? (formData.get('locale') as string) : undefined

    if (!audioFile) {
      sendJson(res, 400, { error: 'No audio file provided' })
      return true
    }

    const response = await handleAzureSpeechRecognize({ audioFile, locale })
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/azure-tts') {
    const body = await readJsonBody(req)
    const response = await handleAzureTts(body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/liveavatar/create-custom-session') {
    const body = await readJsonBody(req)
    const response = await handleCreateLiveAvatarCustomSession(body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/liveavatar/keep-alive') {
    const body = await readJsonBody(req)
    const response = await handleLiveAvatarKeepAlive(body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/liveavatar/end-session') {
    const body = await readJsonBody(req)
    const response = await handleLiveAvatarEndSession(body)
    sendJson(res, response.status, response.body)
    return true
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
    return true
  }

  if (method === 'GET' && pathname === '/internal/did/agent') {
    const response = await handleGetDidAgent()
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/did/stream') {
    const body = await readJsonBody(req)
    const response = await handleCreateDidStream(body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'DELETE' && pathname === '/internal/did/stream') {
    const sessionId = url.searchParams.get('sessionId') || ''
    const response = await handleDeleteDidStream({ sessionId })
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/did/sdp') {
    const body = await readJsonBody(req)
    const response = await handleDidSdp(body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/did/talk') {
    const body = await readJsonBody(req)
    const response = await handleDidTalk(body)
    sendJson(res, response.status, response.body)
    return true
  }

  return false
}
