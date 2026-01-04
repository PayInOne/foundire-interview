import { handleScheduleCoseatInterview, handleGetActiveCoseatInterview } from '../../coseat/schedule'
import { handleCancelCoseatInterview } from '../../coseat/cancel'
import { handleGetCoseatInterview } from '../../coseat/get'
import { handleToggleCoseatAi } from '../../coseat/ai'
import { handleCoseatHeartbeat } from '../../coseat/heartbeat'
import { handlePostCoseatTranscript, handleGetCoseatTranscript } from '../../coseat/transcript'
import { handleGetCoseatSuggestions, handleGenerateCoseatSuggestions } from '../../coseat/suggestions'
import { handleStartCoseatSession, handleEndCoseatSession, handleUploadCoseatRecording } from '../../coseat/session'
import { handleGetCoseatAudio } from '../../coseat/audio'
import { handleGetCoseatProfile, handlePostCoseatProfile, handleDeleteCoseatProfile } from '../../coseat/profile'
import { handleExtendCoseatInterview } from '../../coseat/extend'
import { asRecord, readFormDataBody, readJsonBody, sendJson, sendJsonWithHeaders } from '../http'
import type { RouteHandler } from '../types'

export const handleCoseatRoutes: RouteHandler = async ({ req, res, method, pathname, segments, url }) => {
  if (method === 'POST' && pathname === '/internal/coseat/schedule') {
    const body = await readJsonBody(req)
    const response = await handleScheduleCoseatInterview(body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'GET' && pathname === '/internal/coseat/schedule') {
    const candidateId = url.searchParams.get('candidateId') || ''
    const userId = url.searchParams.get('userId') || ''
    const includeAll = url.searchParams.get('include_all') === 'true'
    const response = await handleGetActiveCoseatInterview(candidateId, userId, includeAll)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'GET' && pathname === '/internal/coseat/profile') {
    const userId = url.searchParams.get('userId') || ''
    const companyId = url.searchParams.get('companyId') || ''
    const response = await handleGetCoseatProfile(userId, companyId)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/coseat/profile') {
    const formData = await readFormDataBody(req, url)
    if (!formData) {
      sendJson(res, 400, { success: false, error: 'Invalid form data' })
      return true
    }

    const userId = String(formData.get('userId') || '')
    const companyId = String(formData.get('companyId') || '')
    const language = String(formData.get('language') || 'en-US')
    const voicePrintFeaturesStr = formData.get('voicePrintFeatures')
    const audioFile = formData.get('audio') as File | null

    if (!audioFile) {
      sendJson(res, 400, { success: false, error: 'No audio file provided' })
      return true
    }

    const response = await handlePostCoseatProfile({
      userId,
      companyId,
      audioFile,
      language,
      voicePrintFeaturesStr: typeof voicePrintFeaturesStr === 'string' ? voicePrintFeaturesStr : null,
    })
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'DELETE' && pathname === '/internal/coseat/profile') {
    const body = await readJsonBody(req)
    const record = asRecord(body) ?? {}
    const userId = typeof record.userId === 'string' ? record.userId : ''
    const companyId = typeof record.companyId === 'string' ? record.companyId : ''
    const response = await handleDeleteCoseatProfile(userId, companyId)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/coseat/session/start') {
    const body = await readJsonBody(req)
    const response = await handleStartCoseatSession(body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/coseat/session/end') {
    const body = await readJsonBody(req)
    const response = await handleEndCoseatSession(body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/coseat/session/upload-recording') {
    const formData = await readFormDataBody(req, url)
    if (!formData) {
      sendJson(res, 400, { success: false, error: 'Invalid form data' })
      return true
    }

    const userId = String(formData.get('userId') || '')
    const coseatInterviewId = String(formData.get('coseatInterviewId') || '')
    const durationSeconds = formData.get('durationSeconds')
    const audioFile = formData.get('audio') as File | null

    if (!audioFile || !coseatInterviewId) {
      sendJson(res, 400, { success: false, error: 'audio and coseatInterviewId are required' })
      return true
    }

    const response = await handleUploadCoseatRecording({
      userId,
      coseatInterviewId,
      durationSeconds: typeof durationSeconds === 'string' ? durationSeconds : undefined,
      audioFile,
    })
    sendJson(res, response.status, response.body)
    return true
  }

  if (segments.length >= 3 && segments[0] === 'internal' && segments[1] === 'coseat') {
    const coseatInterviewId = segments[2]

    if (segments.length === 3 && method === 'GET') {
      const userId = url.searchParams.get('userId') || ''
      const response = await handleGetCoseatInterview(coseatInterviewId, userId)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'cancel' && method === 'POST') {
      const body = await readJsonBody(req)
      const response = await handleCancelCoseatInterview(coseatInterviewId, body)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'ai' && method === 'PATCH') {
      const body = await readJsonBody(req)
      const response = await handleToggleCoseatAi(coseatInterviewId, body)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'heartbeat' && method === 'POST') {
      const response = await handleCoseatHeartbeat(coseatInterviewId)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'extend' && method === 'POST') {
      const body = await readJsonBody(req)
      const response = await handleExtendCoseatInterview(coseatInterviewId, body)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'transcript' && method === 'POST') {
      const body = await readJsonBody(req)
      const response = await handlePostCoseatTranscript(coseatInterviewId, body)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'transcript' && method === 'GET') {
      const userId = url.searchParams.get('userId') || ''
      const response = await handleGetCoseatTranscript(coseatInterviewId, userId)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'suggestions' && method === 'GET') {
      const response = await handleGetCoseatSuggestions(coseatInterviewId)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'suggestions' && method === 'POST') {
      const body = await readJsonBody(req)
      const response = await handleGenerateCoseatSuggestions(coseatInterviewId, body)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'audio' && method === 'GET') {
      const userId = url.searchParams.get('userId') || ''
      const result = await handleGetCoseatAudio(coseatInterviewId, userId)
      if (result.status === 200) {
        res.writeHead(result.status, result.headers)
        result.stream.pipe(res)
        return true
      }

      sendJsonWithHeaders(res, result.status, result.body, result.headers)
      return true
    }
  }

  return false
}
