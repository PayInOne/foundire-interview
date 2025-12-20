import http from 'node:http'
import { enqueueInterviewAnalyzeTask } from './workers/interview-analyze'
import { generateQuestionsForInterview } from './interviews/questions'
import { handleConversation } from './interviews/conversation'
import { analyzeCandidateMessage } from './openai/analyze-message'
import { evaluateTopicPerformance } from './openai/topic-evaluation'

function isAuthorized(authHeader: string | null): boolean {
  const token = process.env.INTERNAL_API_TOKEN
  if (!token) return false
  return authHeader === `Bearer ${token}`
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
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
      const { pathname } = new URL(req.url || '/', 'http://localhost')

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

        await enqueueInterviewAnalyzeTask(parsed)

        sendJson(res, 200, { success: true, mode: 'queued', interviewId: parsed.interviewId })
        return
      }

      if (pathname.startsWith('/internal/')) {
        if (!requireInternalAuth(req, res)) return
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
