import { createAdminClient } from '../supabase/admin'
import { generateInterviewQuestions } from '../openai/interview-questions'
import { normalizeInterviewDurationMinutes } from './constants'

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

function normalizeRequirements(value: unknown): string[] | string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const items = value
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean)
    return items.length > 0 ? items : null
  }
  return null
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
        if (Array.isArray(jobRecord.questions)) {
          presetQuestions = jobRecord.questions
            .filter((question): question is string => typeof question === 'string')
            .map((question) => question.trim())
            .filter(Boolean)
        }
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
  const totalQuestionsNeeded = Math.max(3, Math.min(20, Math.round(durationMinutes / 4)))
  const aiQuestionsCount = Math.max(1, totalQuestionsNeeded - presetQuestions.length)

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

  const result = await generateInterviewQuestions({
    jobTitle,
    jobDescription: jobDescription || '',
    requirements: normalizeRequirements(requirements),
    resumeText: resumeText || undefined,
    numberOfQuestions: presetQuestions.length > 0 ? aiQuestionsCount : totalQuestionsNeeded,
    language: language || 'en',
    presetQuestions,
    companyName,
    companyDescription,
  })

  const allQuestions = result.questions

  if (!allQuestions || allQuestions.length === 0) {
    throw new Error('Failed to generate questions')
  }

  return {
    question: allQuestions[0],
    allQuestions,
    presetQuestionsCount: presetQuestions.length,
    aiQuestionsCount: Math.max(0, allQuestions.length - presetQuestions.length),
  }
}
