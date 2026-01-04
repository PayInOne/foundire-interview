import http from 'node:http'
import { requireInternalAuth } from './server/auth'
import { sendJson } from './server/http'
import { handleInternalAnalyzeRoute } from './server/routes/internal-analyze'
import { handleInterviewCodeRoutes } from './server/routes/interview-codes'
import { handleInterviewRoutes } from './server/routes/interviews'
import { handleCopilotInterviewRoutes } from './server/routes/copilot-interviews'
import { handleCoseatRoutes } from './server/routes/coseat'
import { handleInfrastructureRoutes } from './server/routes/infrastructure'
import type { RouteContext } from './server/types'

export async function startHttpServer({ port }: { port: number }): Promise<void> {
  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method || 'GET'
      const url = new URL(req.url || '/', 'http://localhost')
      const pathname = url.pathname
      const segments = pathname.split('/').filter(Boolean)

      const ctx: RouteContext = {
        req,
        res,
        method,
        url,
        pathname,
        segments,
      }

      if (method === 'GET' && pathname === '/health') {
        sendJson(res, 200, { ok: true })
        return
      }

      if (await handleInternalAnalyzeRoute(ctx)) {
        return
      }

      if (pathname.startsWith('/internal/')) {
        if (!requireInternalAuth(req, res)) return
      }

      if (await handleInterviewCodeRoutes(ctx)) return
      if (await handleInterviewRoutes(ctx)) return
      if (await handleCopilotInterviewRoutes(ctx)) return
      if (await handleCoseatRoutes(ctx)) return
      if (await handleInfrastructureRoutes(ctx)) return

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
