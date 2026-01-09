import { handleCreateCopilotInterview } from '../../copilot-interviews/create'
import { handleScheduleCopilotInterview, handleGetCopilotSchedule } from '../../copilot-interviews/schedule'
import { handleRescheduleCopilotInterview } from '../../copilot-interviews/reschedule'
import { handleConfirmCopilotInterview, handleGetCopilotConfirmInfo } from '../../copilot-interviews/confirm'
import { handleDeclineCopilotInterview } from '../../copilot-interviews/decline'
import { handleSendInterviewReminders, handleCheckMissedInterviews } from '../../copilot-interviews/reminders'
import { handleJoinCopilotInterview } from '../../copilot-interviews/join'
import { handleCopilotInterviewConsent } from '../../copilot-interviews/consent'
import { handleGetCopilotInterviewStatus } from '../../copilot-interviews/status'
import { handleCopilotInterviewHeartbeat } from '../../copilot-interviews/heartbeat'
import { handleExtendCopilotInterview } from '../../copilot-interviews/extend'
import { handleToggleCopilotAi } from '../../copilot-interviews/ai'
import { handleAddCopilotParticipants, handleGetCopilotParticipants } from '../../copilot-interviews/participants'
import { handleGenerateCopilotSuggestions, handleGetCopilotSuggestions } from '../../copilot-interviews/suggest'
import { handlePostCopilotTranscript, handleGetCopilotTranscript } from '../../copilot-interviews/transcript'
import { handleGetCopilotTranscriptCount } from '../../copilot-interviews/transcript-count'
import { handleStartCopilotInterview } from '../../copilot-interviews/start'
import { handleCompleteCopilotInterview } from '../../copilot-interviews/complete'
import {
  handleStartCopilotRecording,
  handleStopCopilotRecording,
  handleGetCopilotRecordingStatus,
} from '../../copilot-interviews/recording'
import { handleSendCopilotInvitationEmail } from '../../copilot-interviews/send-invitation'
import { handleCancelCopilotInterview } from '../../copilot-interviews/cancel'
import { readJsonBody, sendJson } from '../http'
import type { RouteHandler } from '../types'

export const handleCopilotInterviewRoutes: RouteHandler = async ({ req, res, method, pathname, segments, url }) => {
  if (method === 'POST' && pathname === '/internal/copilot-interviews/create') {
    const body = await readJsonBody(req)
    const response = await handleCreateCopilotInterview(body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/copilot-interviews/schedule') {
    const body = await readJsonBody(req)
    const response = await handleScheduleCopilotInterview(body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/copilot-interviews/reschedule') {
    const body = await readJsonBody(req)
    const response = await handleRescheduleCopilotInterview(body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'GET' && pathname === '/internal/copilot-interviews/schedule') {
    const candidateId = url.searchParams.get('candidateId') || ''
    const includeAll = url.searchParams.get('include_all') === 'true'
    const response = await handleGetCopilotSchedule(candidateId, includeAll)
    sendJson(res, response.status, response.body)
    return true
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
    return true
  }

  if (
    segments.length === 4 &&
    segments[0] === 'internal' &&
    segments[1] === 'copilot-interviews' &&
    segments[2] === 'confirm' &&
    method === 'POST'
  ) {
    const token = segments[3]
    const body = await readJsonBody(req)
    const response = await handleConfirmCopilotInterview(token, body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (
    segments.length === 4 &&
    segments[0] === 'internal' &&
    segments[1] === 'copilot-interviews' &&
    segments[2] === 'decline' &&
    method === 'POST'
  ) {
    const token = segments[3]
    const response = await handleDeclineCopilotInterview(token)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/copilot-interviews/reminders') {
    const response = await handleSendInterviewReminders()
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/copilot-interviews/check-missed') {
    const response = await handleCheckMissedInterviews()
    sendJson(res, response.status, response.body)
    return true
  }

  if (segments.length >= 3 && segments[0] === 'internal' && segments[1] === 'copilot-interviews') {
    const copilotInterviewId = segments[2]

    if (segments.length === 4 && segments[3] === 'consent' && method === 'POST') {
      const body = await readJsonBody(req)
      const response = await handleCopilotInterviewConsent(copilotInterviewId, body)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'join' && method === 'POST') {
      const body = await readJsonBody(req)
      const response = await handleJoinCopilotInterview(copilotInterviewId, body)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'status' && method === 'GET') {
      const response = await handleGetCopilotInterviewStatus(copilotInterviewId)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'heartbeat' && method === 'POST') {
      const body = await readJsonBody(req)
      const response = await handleCopilotInterviewHeartbeat(copilotInterviewId, body)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'extend' && method === 'POST') {
      const body = await readJsonBody(req)
      const response = await handleExtendCopilotInterview(copilotInterviewId, body)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'ai' && method === 'PATCH') {
      const body = await readJsonBody(req)
      const response = await handleToggleCopilotAi(copilotInterviewId, body)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'participants' && method === 'POST') {
      const body = await readJsonBody(req)
      const response = await handleAddCopilotParticipants(copilotInterviewId, body)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'participants' && method === 'GET') {
      const userId = url.searchParams.get('userId') || ''
      const response = await handleGetCopilotParticipants(copilotInterviewId, userId)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'suggest' && method === 'POST') {
      const body = await readJsonBody(req)
      const response = await handleGenerateCopilotSuggestions(copilotInterviewId, body)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'suggest' && method === 'GET') {
      const response = await handleGetCopilotSuggestions(copilotInterviewId)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'transcript' && method === 'POST') {
      const body = await readJsonBody(req)
      const response = await handlePostCopilotTranscript(copilotInterviewId, body)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'transcript' && method === 'GET') {
      const userId = url.searchParams.get('userId') || ''
      const response = await handleGetCopilotTranscript(copilotInterviewId, userId)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'transcript-count' && method === 'GET') {
      const response = await handleGetCopilotTranscriptCount(copilotInterviewId)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'start' && method === 'POST') {
      const body = await readJsonBody(req)
      const response = await handleStartCopilotInterview(copilotInterviewId, body)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'complete' && method === 'POST') {
      const response = await handleCompleteCopilotInterview(copilotInterviewId)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 5 && segments[3] === 'recording' && segments[4] === 'start' && method === 'POST') {
      const response = await handleStartCopilotRecording(copilotInterviewId)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 5 && segments[3] === 'recording' && segments[4] === 'stop' && method === 'POST') {
      const response = await handleStopCopilotRecording(copilotInterviewId)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 5 && segments[3] === 'recording' && segments[4] === 'status' && method === 'GET') {
      const response = await handleGetCopilotRecordingStatus(copilotInterviewId)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'send-invitation' && method === 'POST') {
      const body = await readJsonBody(req)
      const response = await handleSendCopilotInvitationEmail(copilotInterviewId, body)
      sendJson(res, response.status, response.body)
      return true
    }

    if (segments.length === 4 && segments[3] === 'cancel' && method === 'POST') {
      const body = await readJsonBody(req)
      const response = await handleCancelCopilotInterview(copilotInterviewId, body)
      sendJson(res, response.status, response.body)
      return true
    }
  }

  return false
}
