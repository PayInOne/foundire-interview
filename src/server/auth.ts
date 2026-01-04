import http from 'node:http'
import { sendJson } from './http'

export function isAuthorized(authHeader: string | null): boolean {
  const token = process.env.INTERNAL_API_TOKEN
  if (!token) return false
  return authHeader === `Bearer ${token}`
}

export function requireInternalAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
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
