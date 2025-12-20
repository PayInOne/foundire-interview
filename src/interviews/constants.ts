export const DEFAULT_INTERVIEW_DURATION_MINUTES = 30
export const MAX_INTERVIEW_DURATION_MINUTES = 180
export const ALLOWED_INTERVIEW_DURATIONS_MINUTES = [15, 30, 45, 60] as const

export type AllowedInterviewDurationMinutes = (typeof ALLOWED_INTERVIEW_DURATIONS_MINUTES)[number]

export function isAllowedInterviewDurationMinutes(value: unknown): value is AllowedInterviewDurationMinutes {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return false
  }

  return (ALLOWED_INTERVIEW_DURATIONS_MINUTES as readonly number[]).includes(parsed)
}

export function normalizeInterviewDurationMinutes(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_INTERVIEW_DURATION_MINUTES
  }

  const normalized = Math.round(parsed)
  return Math.min(Math.max(normalized, 1), MAX_INTERVIEW_DURATION_MINUTES)
}
