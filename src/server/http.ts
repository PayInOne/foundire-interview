import http from 'node:http'

export function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function sendJsonWithHeaders(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string>
) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

export async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
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

export async function readTextBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks).toString('utf8')
}

export async function readFormDataBody(req: http.IncomingMessage, url: URL): Promise<FormData | null> {
  const contentType = req.headers['content-type'] || ''
  if (typeof contentType !== 'string') return null
  if (!contentType.includes('multipart/form-data')) return null

  const request = new Request(url.toString(), {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req as unknown as any,
    duplex: 'half',
  })

  return request.formData()
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
