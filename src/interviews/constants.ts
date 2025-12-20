export const DEFAULT_INTERVIEW_DURATION_MINUTES = 30
export const MAX_INTERVIEW_DURATION_MINUTES = 180

export function normalizeInterviewDurationMinutes(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_INTERVIEW_DURATION_MINUTES
  }

  const normalized = Math.round(parsed)
  return Math.min(Math.max(normalized, 1), MAX_INTERVIEW_DURATION_MINUTES)
}

