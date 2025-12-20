import type { ConsumeMessage } from 'amqplib'
import { assertDurableQueue, publishJson } from '../queue/rabbitmq'
import { QUEUE_NAMES } from '../queue/queues'
import { processInterviewAnalyzeTask, type InterviewAnalyzeTaskPayload } from '../interviews/analyze'

export type InterviewAnalyzeQueueMessage = InterviewAnalyzeTaskPayload & {
  attempt?: number
}

export async function enqueueInterviewAnalyzeTask(payload: InterviewAnalyzeTaskPayload) {
  const message: InterviewAnalyzeQueueMessage = { ...payload, attempt: 0 }
  await publishJson(QUEUE_NAMES.interviewAnalyze, message)
}

function parseMessage(msg: ConsumeMessage): InterviewAnalyzeQueueMessage | null {
  try {
    return JSON.parse(msg.content.toString('utf8')) as InterviewAnalyzeQueueMessage
  } catch (error) {
    console.error('Invalid RabbitMQ message JSON:', error)
    return null
  }
}

export async function startInterviewAnalyzeWorker() {
  const channel = await assertDurableQueue(QUEUE_NAMES.interviewAnalyze)
  const prefetch = 1
  await channel.prefetch(prefetch)
  const maxAttempts = 3

  await channel.consume(
    QUEUE_NAMES.interviewAnalyze,
    async (msg) => {
      if (!msg) return

      const payload = parseMessage(msg)
      if (!payload) {
        channel.ack(msg)
        return
      }

      try {
        const result = await processInterviewAnalyzeTask(payload)
        if (result.status === 'completed') {
          console.log(`[Interview Analyze] Completed: ${result.interviewId} (score=${result.score})`)
        } else if (result.status === 'skipped') {
          console.log(`[Interview Analyze] Skipped: ${result.interviewId} (${result.reason}, score=${result.score})`)
        } else if (result.status === 'not_found') {
          console.warn(`[Interview Analyze] Not found: ${result.interviewId}`)
        }
      } catch (error) {
        console.error('Interview analyze worker failed:', error)

        const attempt = (payload.attempt ?? 0) + 1
        if (Number.isFinite(maxAttempts) && attempt <= maxAttempts) {
          await publishJson(QUEUE_NAMES.interviewAnalyze, { ...payload, attempt })
        }
      } finally {
        channel.ack(msg)
      }
    },
    { noAck: false }
  )

  console.log(`RabbitMQ worker started: ${QUEUE_NAMES.interviewAnalyze} (prefetch=${prefetch})`)
}

