export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function getString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function getOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function getBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key]
  if (typeof value !== 'boolean') return null
  return value
}

export function getNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value)) return null
  return value
}

