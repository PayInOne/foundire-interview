import { analyzeCandidateMessage } from '../../openai/analyze-message'
import { evaluateTopicPerformance } from '../../openai/topic-evaluation'
import { generateQuestionsForInterview } from '../../interviews/questions'
import { handleConversation } from '../../interviews/conversation'
import { handleInterviewHeartbeat } from '../../interviews/heartbeat'
import { handleSaveTranscript } from '../../interviews/transcript'
import { handleInterviewConsent } from '../../interviews/consent'
import { handleGetLiveKitRecordingStatus, handleLiveKitStart, handleLiveKitStop } from '../../interviews/livekit-recording'
import { handleCreateInterview } from '../../interviews/create'
import { handleGetInterview } from '../../interviews/get'
import { handleGetConversationState, handleUpdateConversationState } from '../../interviews/state'
import { handleCleanupStandardInterviews } from '../../interviews/cleanup'
import { handleCleanupAllInterviews } from '../../interviews/cleanup-all'
import { asRecord, readJsonBody, sendJson } from '../http'
import type { RouteHandler } from '../types'

export const handleInterviewRoutes: RouteHandler = async ({ req, res, method, pathname, segments }) => {
  if (method === 'POST' && pathname === '/internal/interviews/create') {
    const body = await readJsonBody(req)
    const response = await handleCreateInterview(body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/interviews/cleanup') {
    const response = await handleCleanupStandardInterviews()
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/interviews/cleanup-all') {
    const response = await handleCleanupAllInterviews()
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/interviews/questions') {
    const body = await readJsonBody(req)
    const record = asRecord(body)
    if (!record) {
      sendJson(res, 400, { error: 'Invalid request body' })
      return true
    }

    const interviewId = typeof record.interviewId === 'string' ? record.interviewId : ''
    const jobTitle = typeof record.jobTitle === 'string' ? record.jobTitle : ''
    if (!interviewId || !jobTitle) {
      sendJson(res, 400, { error: 'Missing required fields' })
      return true
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
    return true
  }

  if (method === 'POST' && pathname === '/internal/interviews/conversation') {
    const body = await readJsonBody(req)
    const record = asRecord(body)
    if (!record) {
      sendJson(res, 400, { error: 'Invalid request body' })
      return true
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
      return true
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
    return true
  }

  if (method === 'POST' && pathname === '/internal/interviews/analyze-message') {
    const body = await readJsonBody(req)
    const record = asRecord(body)
    if (!record) {
      sendJson(res, 400, { error: 'Invalid request body' })
      return true
    }

    const message = typeof record.message === 'string' ? record.message : ''
    const currentTopic = typeof record.currentTopic === 'string' ? record.currentTopic : ''
    const language = typeof record.language === 'string' ? record.language : 'en'

    if (!message || !currentTopic) {
      sendJson(res, 400, { error: 'Missing required fields' })
      return true
    }

    const analysis = await analyzeCandidateMessage({ message, currentTopic, language })
    sendJson(res, 200, { success: true, analysis })
    return true
  }

  if (method === 'POST' && pathname === '/internal/interviews/evaluate-topic') {
    const body = await readJsonBody(req)
    const record = asRecord(body)
    if (!record) {
      sendJson(res, 400, { error: 'Invalid request body' })
      return true
    }

    const topic = typeof record.topic === 'string' ? record.topic : ''
    const conversation = Array.isArray(record.conversation) ? record.conversation : []
    const language = typeof record.language === 'string' ? record.language : 'en'

    if (!topic || conversation.length === 0) {
      sendJson(res, 400, { error: 'Missing required fields: topic and conversation' })
      return true
    }

    const evaluation = await evaluateTopicPerformance({
      topic,
      conversation: conversation as Array<{ speaker: string; text: string; timestamp?: string }>,
      language,
    })

    sendJson(res, 200, { success: true, evaluation })
    return true
  }

  if (method === 'POST' && pathname === '/internal/interviews/heartbeat') {
    const body = await readJsonBody(req)
    const record = asRecord(body)
    const interviewId = typeof record?.interviewId === 'string' ? record.interviewId : ''

    const response = await handleInterviewHeartbeat(interviewId)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/interviews/transcript') {
    const body = await readJsonBody(req)
    const response = await handleSaveTranscript(body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/interviews/livekit/start') {
    const body = await readJsonBody(req)
    const response = await handleLiveKitStart(body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/interviews/livekit/stop') {
    const body = await readJsonBody(req)
    const response = await handleLiveKitStop(body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (
    segments.length === 5 &&
    segments[0] === 'internal' &&
    segments[1] === 'interviews' &&
    segments[3] === 'recording' &&
    segments[4] === 'status' &&
    method === 'GET'
  ) {
    const interviewId = segments[2]
    const response = await handleGetLiveKitRecordingStatus(interviewId)
    sendJson(res, response.status, response.body)
    return true
  }

  if (segments.length === 3 && segments[0] === 'internal' && segments[1] === 'interviews' && method === 'GET') {
    const interviewId = segments[2]
    const response = await handleGetInterview(interviewId)
    sendJson(res, response.status, response.body)
    return true
  }

  if (
    segments.length === 4 &&
    segments[0] === 'internal' &&
    segments[1] === 'interviews' &&
    segments[3] === 'consent' &&
    method === 'POST'
  ) {
    const interviewId = segments[2]
    const body = await readJsonBody(req)
    const response = await handleInterviewConsent(interviewId, body)
    sendJson(res, response.status, response.body)
    return true
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
    return true
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
    return true
  }

  return false
}
