import type { FollowUpQuestion } from '../core/types'

export type SuggestedQuestionMeta = FollowUpQuestion

const SOURCE_PRIORITY: Record<SuggestedQuestionMeta['source'], number> = {
  transcript: 1,
  resume: 2,
  job: 3,
  skills: 4,
  unknown: 5,
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeConfidence(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

export function normalizeFollowUpQuestions(
  detailed: FollowUpQuestion[] | undefined,
  fallback: string[]
): SuggestedQuestionMeta[] {
  const normalized: SuggestedQuestionMeta[] = []

  if (Array.isArray(detailed) && detailed.length > 0) {
    for (const item of detailed) {
      const text = normalizeText(item.text)
      if (!text) continue
      const source = item.source ?? 'unknown'
      const evidence = normalizeText(item.evidence) || undefined
      const confidence = normalizeConfidence(item.confidence, source === 'transcript' ? 0.6 : 0.5)
      normalized.push({
        text,
        source,
        ...(evidence ? { evidence } : {}),
        ...(confidence !== undefined ? { confidence } : {}),
        ...(item.intent ? { intent: item.intent } : {}),
      })
    }
  } else {
    for (const q of fallback) {
      const text = normalizeText(q)
      if (!text) continue
      normalized.push({
        text,
        source: 'unknown',
        confidence: 0.4,
        intent: 'follow_up',
      })
    }
  }

  return normalized
}

export function selectTopQuestions(
  questions: SuggestedQuestionMeta[],
  limit: number
): SuggestedQuestionMeta[] {
  if (questions.length === 0) return []

  const seen = new Set<string>()
  const unique = questions.filter((q) => {
    const key = q.text.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const evidenceFiltered = unique.filter((q) => {
    if (q.source === 'transcript' || q.source === 'unknown') return true
    return Boolean(q.evidence && q.evidence.trim().length >= 4)
  })

  const pool = evidenceFiltered.length > 0 ? evidenceFiltered : unique
  const sorted = [...pool].sort((a, b) => {
    const priorityDiff = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]
    if (priorityDiff !== 0) return priorityDiff
    const confidenceA = a.confidence ?? 0.5
    const confidenceB = b.confidence ?? 0.5
    if (confidenceA !== confidenceB) return confidenceB - confidenceA
    return a.text.length - b.text.length
  })

  return sorted.slice(0, Math.max(0, limit))
}

export function buildSkillGapQuestions(
  skills: string[],
  limit: number,
  formatter?: (skill: string) => string
): SuggestedQuestionMeta[] {
  const output: SuggestedQuestionMeta[] = []
  for (const skill of skills) {
    const trimmed = normalizeText(skill)
    if (!trimmed) continue
    const text = formatter ? normalizeText(formatter(trimmed)) : trimmed
    if (!text) continue
    output.push({
      text,
      source: 'skills',
      evidence: trimmed,
      confidence: 0.45,
      intent: 'skill_gap',
    })
    if (output.length >= limit) break
  }
  return output
}
