// Transcript types - unified definitions for all interview modes
export interface QATranscriptEntry {
  question: string
  answer: string
}

export interface ConversationalTranscriptEntry {
  speaker: 'ai' | 'candidate' | 'interviewer' | 'interviewer_0' | 'interviewer_1' | 'interviewer_2'
  text: string
  timestamp?: string
  topicTag?: string
  speaker_name?: string
  confidence?: number
  offset_seconds?: number
}

export type InterviewTranscriptData = QATranscriptEntry[] | ConversationalTranscriptEntry[]

export function isQATranscriptEntry(entry: unknown): entry is QATranscriptEntry {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'question' in entry &&
    'answer' in entry &&
    typeof (entry as QATranscriptEntry).question === 'string' &&
    typeof (entry as QATranscriptEntry).answer === 'string'
  )
}

export function isConversationalTranscriptEntry(entry: unknown): entry is ConversationalTranscriptEntry {
  if (typeof entry !== 'object' || entry === null) return false
  const e = entry as ConversationalTranscriptEntry
  const isValidSpeaker =
    e.speaker === 'ai' ||
    e.speaker === 'candidate' ||
    e.speaker === 'interviewer' ||
    (typeof e.speaker === 'string' && e.speaker.startsWith('interviewer_'))
  return isValidSpeaker && typeof e.text === 'string'
}

export function isQATranscript(entries: unknown[]): entries is QATranscriptEntry[] {
  if (entries.length === 0) return true
  return entries.every(isQATranscriptEntry)
}

export function isConversationalTranscript(entries: unknown[]): entries is ConversationalTranscriptEntry[] {
  if (entries.length === 0) return false
  return entries.every(isConversationalTranscriptEntry)
}

// Structured dimension scores for objective evaluation
export interface DimensionScores {
  relevance: { score: number; notes: string } // 1-10, weight 30%
  depth: { score: number; notes: string } // 1-10, weight 30%
  clarity: { score: number; notes: string } // 1-10, weight 20%
  engagement: { score: number; notes: string } // 1-10, weight 20%
}

export interface AIAnalysis {
  dimension_scores: DimensionScores
  overall_assessment: string
  strengths: string[]
  weaknesses: string[]
  preset_question_evaluations?: Array<{
    question: string
    expected_answer: string
    candidate_answer_summary: string
    alignment_score: number
    notes: string
  }>
  technical_skills: Array<{
    skill: string
    level: 'beginner' | 'intermediate' | 'advanced' | 'expert'
    notes: string
  }>
  soft_skills: Array<{
    skill: string
    rating: number // 1-5
    notes: string
  }>
  cultural_fit: {
    rating: number // 1-10
    notes: string
  }
  recommendation: 'strong_yes' | 'yes' | 'maybe' | 'no' | 'strong_no'
  red_flags?: string[]
}
