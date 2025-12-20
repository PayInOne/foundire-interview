export const INTERVIEW_MODES = {
  AI_QA: 'ai_qa',
  AI_DIALOGUE: 'ai_dialogue',
  ASSISTED_VIDEO: 'assisted_video',
  ASSISTED_VOICE: 'assisted_voice',
} as const

export type InterviewMode = (typeof INTERVIEW_MODES)[keyof typeof INTERVIEW_MODES]

export const LEGACY_MODE_MAP: Record<string, InterviewMode> = {
  qa: INTERVIEW_MODES.AI_QA,
  conversational: INTERVIEW_MODES.AI_DIALOGUE,
  copilot: INTERVIEW_MODES.ASSISTED_VIDEO,
  coseat: INTERVIEW_MODES.ASSISTED_VOICE,
}

export function normalizeInterviewMode(mode: string | null | undefined): InterviewMode {
  if (!mode) return INTERVIEW_MODES.AI_QA

  if (Object.values(INTERVIEW_MODES).includes(mode as InterviewMode)) {
    return mode as InterviewMode
  }

  return LEGACY_MODE_MAP[mode] || INTERVIEW_MODES.AI_QA
}

