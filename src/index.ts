import 'dotenv/config'
import { startHttpServer } from './server'
import { startInterviewAnalyzeWorker } from './workers/interview-analyze'

async function main() {
  const port = Number(process.env.PORT || 3002)
  await startHttpServer({ port })

  if (!process.env.RABBITMQ_URL) {
    console.warn('RABBITMQ_URL not set: workers will not start.')
    return
  }

  await startInterviewAnalyzeWorker()
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
