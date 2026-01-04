import type http from 'node:http'

export interface RouteContext {
  req: http.IncomingMessage
  res: http.ServerResponse
  url: URL
  method: string
  pathname: string
  segments: string[]
}

export type RouteHandler = (ctx: RouteContext) => Promise<boolean>
