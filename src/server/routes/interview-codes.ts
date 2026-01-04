import { handleUseInterviewCode } from '../../interview-codes/use'
import { handleVerifyInterviewCode } from '../../interview-codes/verify'
import { readJsonBody, sendJson } from '../http'
import type { RouteHandler } from '../types'

export const handleInterviewCodeRoutes: RouteHandler = async ({ req, res, method, pathname }) => {
  if (method === 'POST' && pathname === '/internal/interview-codes/verify') {
    const body = await readJsonBody(req)
    const response = await handleVerifyInterviewCode(body)
    sendJson(res, response.status, response.body)
    return true
  }

  if (method === 'POST' && pathname === '/internal/interview-codes/use') {
    const body = await readJsonBody(req)
    const response = await handleUseInterviewCode(body)
    sendJson(res, response.status, response.body)
    return true
  }

  return false
}
