import { createAdminClient } from '../supabase/admin'
import { generateInterviewQuestions } from '../openai/interview-questions'
import { normalizeInterviewDurationMinutes } from './constants'

const MAX_JOB_CONTEXT_CHARS = 12_000
const MAX_RESUME_CONTEXT_CHARS = 12_000

export interface InterviewQuestionsRequest {
  interviewId: string
  jobId?: string
  jobTitle: string
  jobDescription?: string
  requirements?: unknown
  candidateId?: string
  interviewDuration?: unknown
  language?: string
}

export interface InterviewQuestionsResponse {
  question: string
  allQuestions: string[]
  presetQuestionsCount: number
  aiQuestionsCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeLooseText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function sanitizeInterviewQuestion(question: string): string {
  let cleaned = question.trim()
  cleaned = cleaned.replace(/^\s*(?:[-*•]\s+|\d+\s*(?:[.)、]|:)\s+)/u, '')
  cleaned = cleaned.replace(/^["'“”‘’]+|["'“”‘’]+$/gu, '')
  cleaned = cleaned.replace(/\s+/g, ' ').trim()
  return cleaned
}

function interviewQuestionKey(question: string): string {
  return sanitizeInterviewQuestion(question)
    .toLowerCase()
    .replace(/["'“”‘’]+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractPresetQuestions(value: unknown): string[] {
  const results: string[] = []
  const push = (text: unknown) => {
    const normalized = normalizeLooseText(text)
    if (normalized) results.push(normalized)
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        push(item)
        continue
      }
      if (!isRecord(item)) continue

      // Common shapes:
      // - { question: string }
      // - { text: string }
      // - { title: string, type?: 'question' }
      push(item.question)
      push(item.text)
      if (item.type === 'question') push(item.title)
    }
  } else if (isRecord(value)) {
    // e.g. { questions: [...] }
    if (Array.isArray(value.questions)) {
      results.push(...extractPresetQuestions(value.questions))
    }
  } else if (typeof value === 'string') {
    push(value)
  }

  const seen = new Set<string>()
  const unique: string[] = []
  for (const q of results) {
    const cleaned = sanitizeInterviewQuestion(q)
    const key = interviewQuestionKey(cleaned)
    if (!key) continue
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(cleaned)
  }
  return unique
}

function normalizeRequirements(value: unknown): string[] | string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const items = value
      .flatMap((v) => {
        if (typeof v === 'string') return [v]
        if (!isRecord(v)) return []
        const collected: string[] = []
        if (typeof v.name === 'string') collected.push(v.name)
        if (typeof v.skill === 'string') collected.push(v.skill)
        if (typeof v.requirement === 'string') collected.push(v.requirement)
        if (typeof v.text === 'string') collected.push(v.text)
        if (typeof v.title === 'string') collected.push(v.title)
        return collected
      })
      .map((v) => v.trim())
      .filter(Boolean)
    return items.length > 0 ? items : null
  }
  if (isRecord(value)) {
    if (typeof value.requirements === 'string' || Array.isArray(value.requirements)) {
      return normalizeRequirements(value.requirements)
    }
    if (typeof value.skills === 'string' || Array.isArray(value.skills)) {
      return normalizeRequirements(value.skills)
    }
  }
  return null
}

function postProcessQuestionList(params: {
  presetQuestions: string[]
  generatedQuestions: string[]
  maxTotalQuestions: number
}): { questions: string[]; presetQuestionsCount: number; aiQuestionsCount: number } {
  const presetQuestions = params.presetQuestions.map(sanitizeInterviewQuestion).filter(Boolean)
  const generatedQuestions = params.generatedQuestions.map(sanitizeInterviewQuestion).filter(Boolean)

  const presetMap = new Map<string, string>()
  for (const q of presetQuestions) {
    const key = interviewQuestionKey(q)
    if (!key) continue
    if (!presetMap.has(key)) presetMap.set(key, q)
  }

  const presetKeySet = new Set(presetMap.keys())
  const usedPresetKeys = new Set<string>()

  const seen = new Set<string>()
  const ordered: string[] = []

  const add = (q: string) => {
    const key = interviewQuestionKey(q)
    if (!key) return
    if (seen.has(key)) return
    seen.add(key)
    ordered.push(q)
  }

  for (const q of generatedQuestions) {
    const key = interviewQuestionKey(q)
    if (!key) continue
    const presetQuestion = presetMap.get(key)
    if (presetQuestion) {
      usedPresetKeys.add(key)
      add(presetQuestion)
      continue
    }
    add(q)
  }

  for (const q of presetQuestions) {
    const key = interviewQuestionKey(q)
    if (!key) continue
    if (usedPresetKeys.has(key)) continue
    add(q)
  }

  const finalQuestions = ordered

  if (finalQuestions.length > params.maxTotalQuestions) {
    for (let i = finalQuestions.length - 1; i >= 0 && finalQuestions.length > params.maxTotalQuestions; i -= 1) {
      const key = interviewQuestionKey(finalQuestions[i] ?? '')
      if (!key) {
        finalQuestions.splice(i, 1)
        continue
      }
      if (presetKeySet.has(key)) continue
      finalQuestions.splice(i, 1)
    }

    if (finalQuestions.length > params.maxTotalQuestions) {
      finalQuestions.splice(params.maxTotalQuestions)
    }
  }

  const presetQuestionsCount = finalQuestions.filter((q) => presetKeySet.has(interviewQuestionKey(q))).length

  return {
    questions: finalQuestions,
    presetQuestionsCount,
    aiQuestionsCount: Math.max(0, finalQuestions.length - presetQuestionsCount),
  }
}

export async function generateQuestionsForInterview(request: InterviewQuestionsRequest): Promise<InterviewQuestionsResponse> {
  const {
    interviewId,
    jobId,
    jobTitle,
    jobDescription,
    requirements,
    candidateId,
    interviewDuration,
    language,
  } = request

  const adminClient = createAdminClient()

  let presetQuestions: string[] = []
  let companyIdForContext: string | null = null

  if (jobId) {
    try {
      const { data: job, error: jobError } = await adminClient
        .from('jobs')
        .select('company_id, questions')
        .eq('id', jobId)
        .single()

      if (!jobError && job) {
        const jobRecord = job as unknown as { company_id?: string | null; questions?: unknown }
        presetQuestions = extractPresetQuestions(jobRecord.questions)
        companyIdForContext = jobRecord.company_id ?? null
      } else if (jobError) {
        console.error('Error fetching job preset questions:', jobError)
      }
    } catch (error) {
      console.error('Error fetching job preset questions:', error)
    }
  }

  if (!companyIdForContext) {
    try {
      const { data: interview, error: interviewError } = await adminClient
        .from('interviews')
        .select('company_id')
        .eq('id', interviewId)
        .single()

      if (!interviewError && interview) {
        const interviewRecord = interview as unknown as { company_id?: string | null }
        companyIdForContext = interviewRecord.company_id ?? null
      } else if (interviewError) {
        console.error('Error fetching interview company context:', interviewError)
      }
    } catch (error) {
      console.error('Error fetching interview company context:', error)
    }
  }

  let companyName: string | undefined
  let companyDescription: string | null = null

  if (companyIdForContext) {
    try {
      const { data: company, error: companyError } = await adminClient
        .from('companies')
        .select('name, description')
        .eq('id', companyIdForContext)
        .single()

      if (companyError) {
        console.error('Error fetching company context:', companyError)
      } else if (company) {
        const companyRecord = company as unknown as { name?: string | null; description?: string | null }
        companyName = companyRecord.name ?? undefined
        companyDescription = companyRecord.description ?? null
      }
    } catch (error) {
      console.error('Error fetching company context:', error)
    }
  }

  const durationMinutes = normalizeInterviewDurationMinutes(interviewDuration)
  const maxTotalQuestions = Math.max(3, Math.min(20, Math.round(durationMinutes / 4)))

  if (presetQuestions.length > maxTotalQuestions) {
    console.warn(
      'Preset questions exceed duration-based limit, truncating',
      { presetQuestions: presetQuestions.length, maxTotalQuestions, interviewId, jobId }
    )
  }

  const presetQuestionsForInterview = presetQuestions.slice(0, Math.min(presetQuestions.length, maxTotalQuestions))
  const aiQuestionsNeeded = Math.max(0, maxTotalQuestions - presetQuestionsForInterview.length)

  let resumeText = ''
  if (candidateId) {
    try {
      const { data: candidate, error: fetchError } = await adminClient
        .from('candidates')
        .select('resume_text')
        .eq('id', candidateId)
        .single()

      if (fetchError) {
        console.error('Error fetching candidate from database:', fetchError)
      } else if (candidate) {
        const candidateRecord = candidate as unknown as { resume_text?: string | null }
        if (candidateRecord.resume_text) resumeText = candidateRecord.resume_text
      }
    } catch (error) {
      console.error('Error fetching candidate resume:', error)
    }
  }

  const trimmedJobDescription = (jobDescription || '').slice(0, MAX_JOB_CONTEXT_CHARS)
  const trimmedResumeText = resumeText.slice(0, MAX_RESUME_CONTEXT_CHARS)
  if (resumeText.length > MAX_RESUME_CONTEXT_CHARS) {
    console.warn('Candidate resume_text is long; truncating for question generation', {
      candidateId,
      originalChars: resumeText.length,
      keptChars: MAX_RESUME_CONTEXT_CHARS,
      interviewId,
    })
  }

  if (aiQuestionsNeeded <= 0) {
    const postProcessed = postProcessQuestionList({
      presetQuestions: presetQuestionsForInterview,
      generatedQuestions: [],
      maxTotalQuestions,
    })

    if (postProcessed.questions.length === 0) {
      throw new Error('No interview questions available after truncation')
    }

    return {
      question: postProcessed.questions[0],
      allQuestions: postProcessed.questions,
      presetQuestionsCount: postProcessed.presetQuestionsCount,
      aiQuestionsCount: postProcessed.aiQuestionsCount,
    }
  }

  const result = await generateInterviewQuestions({
    jobTitle,
    jobDescription: trimmedJobDescription,
    requirements: normalizeRequirements(requirements),
    resumeText: trimmedResumeText || undefined,
    numberOfQuestions: aiQuestionsNeeded,
    language: language || 'en',
    presetQuestions: presetQuestionsForInterview,
    companyName,
    companyDescription,
  })

  const postProcessed = postProcessQuestionList({
    presetQuestions: presetQuestionsForInterview,
    generatedQuestions: result.questions,
    maxTotalQuestions,
  })

  if (!postProcessed.questions || postProcessed.questions.length === 0) {
    throw new Error('Failed to generate questions')
  }

  return {
    question: postProcessed.questions[0],
    allQuestions: postProcessed.questions,
    presetQuestionsCount: postProcessed.presetQuestionsCount,
    aiQuestionsCount: postProcessed.aiQuestionsCount,
  }
}
