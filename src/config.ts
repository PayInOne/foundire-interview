const DEFAULT_APP_ORIGIN = 'https://foundire.com'
const DEFAULT_APP_BASE_PATH = '/app'

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.trim()
  if (!trimmed) return ''
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  if (withLeading !== '/' && withLeading.endsWith('/')) {
    return withLeading.slice(0, -1)
  }
  return withLeading
}

export function getAppPublicUrl(): string {
  const origin = (process.env.APP_PUBLIC_URL || DEFAULT_APP_ORIGIN).replace(/\/$/, '')
  const basePath = normalizeBasePath(process.env.APP_PUBLIC_BASE_PATH || DEFAULT_APP_BASE_PATH)
  if (!basePath || basePath === '/') return origin
  return `${origin}${basePath}`
}
