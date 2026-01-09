import { analyzeInterview } from '../openai/interview-analysis'
import { deductCredits } from '../credits/manager'
import { toJson } from '../supabase/json'
import { createAdminClient } from '../supabase/admin'
import {
  isQATranscript,
  isConversationalTranscript,
  type AIAnalysis,
  type InterviewTranscriptData,
} from '../types'
import { sendInterviewReport } from '../email'

interface InterviewAnalyzeDetails {
  id: string
  transcript: unknown
  started_at: string | null
  completed_at: string | null
  company_id: string
  credits_deducted: number
  interview_mode: string | null
  score: number | null
  ai_analysis: unknown | null
  candidates: {
    id: string
    name: string
    email: string
    resume_url: string | null
    source: string | null
  } | null
  jobs: {
    title: string
    description: string | null
    requirements: string | null
    companies: {
      name: string
      slug: string | null
    } | null
  } | null
}

export interface InterviewAnalyzeTaskPayload {
  interviewId: string
  locale?: string
  sendEmail?: boolean
}

export type InterviewAnalyzeTaskResult =
  | { status: 'completed'; interviewId: string; score: number }
  | { status: 'skipped'; interviewId: string; score: number; reason: 'already_analyzed' }
  | { status: 'not_found'; interviewId: string }

type EmailAnalysis = Pick<AIAnalysis, 'recommendation' | 'overall_assessment' | 'strengths' | 'weaknesses'>

function isRecommendation(value: unknown): value is AIAnalysis['recommendation'] {
  return value === 'strong_yes' || value === 'yes' || value === 'maybe' || value === 'no' || value === 'strong_no'
}

function parseEmailAnalysis(value: unknown): Partial<EmailAnalysis> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>

  const recommendation = isRecommendation(record.recommendation) ? record.recommendation : undefined
  const overall_assessment = typeof record.overall_assessment === 'string' ? record.overall_assessment : undefined
  const strengths = Array.isArray(record.strengths)
    ? record.strengths.filter((s): s is string => typeof s === 'string')
    : undefined
  const weaknesses = Array.isArray(record.weaknesses)
    ? record.weaknesses.filter((s): s is string => typeof s === 'string')
    : undefined

  return { recommendation, overall_assessment, strengths, weaknesses }
}

function parseNotificationPreferences(value: unknown): { interview_completed?: boolean } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const interview_completed = typeof record.interview_completed === 'boolean' ? record.interview_completed : undefined
  return { interview_completed }
}

function getUserLocale(userMetadata: unknown): string {
  if (!userMetadata || typeof userMetadata !== 'object' || Array.isArray(userMetadata)) return 'en'
  const record = userMetadata as Record<string, unknown>
  const locale = record.locale
  return typeof locale === 'string' && locale.trim() ? locale : 'en'
}

function parseTranscript(rawTranscript: unknown): InterviewTranscriptData {
  const transcriptEntries: unknown[] = Array.isArray(rawTranscript) ? rawTranscript : []

  if (isQATranscript(transcriptEntries)) return transcriptEntries
  if (isConversationalTranscript(transcriptEntries)) return transcriptEntries
  return []
}

function buildFallbackAnalysis(): AIAnalysis & { score: number } {
  return {
    dimension_scores: {
      relevance: { score: 0, notes: 'No responses provided' },
      depth: { score: 0, notes: 'No responses provided' },
      clarity: { score: 0, notes: 'No responses provided' },
      engagement: { score: 0, notes: 'No responses provided' },
    },
    overall_assessment: 'The candidate did not provide any answers during the interview.',
    strengths: [],
    weaknesses: ['No responses provided'],
    technical_skills: [],
    soft_skills: [],
    cultural_fit: { rating: 0, notes: 'Insufficient data to evaluate cultural fit.' },
    recommendation: 'no',
    red_flags: ['No responses provided'],
    score: 0,
  }
}

export async function processInterviewAnalyzeTask({
  interviewId,
  locale = 'en',
  sendEmail = true,
}: InterviewAnalyzeTaskPayload): Promise<InterviewAnalyzeTaskResult> {
  const supabase = createAdminClient()

  const { data: interview, error: fetchError } = await supabase
    .from('interviews')
    .select(`
      id,
      transcript,
      started_at,
      completed_at,
      company_id,
      credits_deducted,
      interview_mode,
      score,
      ai_analysis,
      candidates (
        id,
        name,
        email,
        resume_url,
        source
      ),
      jobs (
        title,
        description,
        requirements,
        companies (
          name,
          slug
        )
      )
    `)
    .eq('id', interviewId)
    .maybeSingle()

  if (fetchError) {
    throw new Error(fetchError.message)
  }

  const interviewData = interview as unknown as InterviewAnalyzeDetails | null
  if (!interviewData) return { status: 'not_found', interviewId }

  if (interviewData.ai_analysis && interviewData.score !== null && interviewData.score !== undefined) {
    return { status: 'skipped', interviewId, score: interviewData.score, reason: 'already_analyzed' }
  }

  const candidate = interviewData.candidates
  const job = interviewData.jobs
  if (!candidate || !job || !job.companies) {
    throw new Error('Interview is missing related candidate/job/company data')
  }

  const isTalentApplicant =
    candidate.source === 'talent_applicant' || job.companies?.slug === 'foundire-talent'
  const isAiDialogue = interviewData.interview_mode === 'ai_dialogue' || interviewData.interview_mode === 'ai_qa'
  const isFreeInterview = isAiDialogue || isTalentApplicant

  const transcript = parseTranscript(interviewData.transcript)

  const analysis = transcript.length === 0
    ? buildFallbackAnalysis()
    : await analyzeInterview(job.description || '', job.requirements || '', transcript, locale)

  const interviewUpdate = {
    status: 'completed',
    score: analysis.score,
    ai_analysis: toJson(analysis),
    ...(interviewData.completed_at ? {} : { completed_at: new Date().toISOString() }),
  }

  const { error: updateError } = await supabase
    .from('interviews')
    .update(interviewUpdate)
    .eq('id', interviewId)

  if (updateError) {
    throw new Error(updateError.message)
  }

  await supabase
    .from('candidates')
    .update({ status: 'completed' })
    .eq('id', candidate.id)
    .then(({ error }) => {
      if (error) console.error('Error updating candidate status:', error)
    })

  // Final credit deduction
  if (!isFreeInterview) {
    try {
      const { data: interviewRecord } = await supabase
        .from('interviews')
        .select('started_at, credits_deducted, completed_at')
        .eq('id', interviewId)
        .single()

      const record = interviewRecord as unknown as { started_at: string | null; credits_deducted: number | null; completed_at: string | null } | null
      if (record?.started_at) {
        const startedAt = new Date(record.started_at)
        const completedAtStr = record.completed_at || (interviewUpdate as { completed_at?: string }).completed_at

        if (completedAtStr) {
          const completedAt = new Date(completedAtStr)
          if (completedAt > startedAt) {
            const totalMinutes = Math.ceil((completedAt.getTime() - startedAt.getTime()) / 1000 / 60)
            const alreadyDeducted = record.credits_deducted || 0
            const remaining = totalMinutes - alreadyDeducted

            if (remaining > 0) {
              const deductResult = await deductCredits(
                {
                  companyId: interviewData.company_id,
                  amount: remaining,
                  type: 'interview_minute',
                  referenceId: interviewId,
                  referenceType: 'interview',
                  description: `Interview completed: final ${remaining} minute(s)`,
                },
                supabase
              )

              if (deductResult.success) {
                await supabase
                  .from('interviews')
                  .update({ credits_deducted: totalMinutes })
                  .eq('id', interviewId)
              }
            }
          }
        }
      }
    } catch (creditError) {
      console.error('Error processing final credits:', creditError)
    }
  }

  if (sendEmail && !isTalentApplicant) {
    try {
      const { data: savedInterview } = await supabase
        .from('interviews')
        .select('score, ai_analysis')
        .eq('id', interviewId)
        .single()

      const saved = savedInterview as unknown as { score: number | null; ai_analysis: unknown | null } | null
      const finalScore = saved?.score ?? analysis.score
      const savedEmailAnalysis = parseEmailAnalysis(saved?.ai_analysis)
      const finalAnalysis: EmailAnalysis = {
        recommendation: savedEmailAnalysis.recommendation ?? analysis.recommendation,
        overall_assessment: savedEmailAnalysis.overall_assessment ?? analysis.overall_assessment,
        strengths: savedEmailAnalysis.strengths ?? analysis.strengths,
        weaknesses: savedEmailAnalysis.weaknesses ?? analysis.weaknesses,
      }

      const { data: members, error: membersError } = await supabase
        .from('company_members')
        .select('user_id, notification_preferences')
        .eq('company_id', interviewData.company_id)

      if (membersError) {
        console.error('Failed to load company members:', membersError)
      } else if (members && Array.isArray(members) && members.length > 0) {
        for (const member of members as Array<{ user_id: string; notification_preferences: unknown }>) {
          const preferences = parseNotificationPreferences(member.notification_preferences) || { interview_completed: true }
          if (preferences.interview_completed === false) continue

          const { data: userData, error: userError } = await supabase.auth.admin.getUserById(member.user_id)
          if (userError) {
            console.error(`Failed to fetch user ${member.user_id}:`, userError)
            continue
          }

          const user = userData?.user
          const email = user?.email
          if (!email) continue

          const userLocale = getUserLocale(user?.user_metadata)

          try {
            await sendInterviewReport({
              to: email,
              candidateName: candidate.name,
              candidateEmail: candidate.email,
              jobTitle: job.title,
              companyName: job.companies.name || 'Unknown',
              score: finalScore,
              recommendation: finalAnalysis.recommendation ?? analysis.recommendation,
              overallAssessment: finalAnalysis.overall_assessment ?? analysis.overall_assessment,
              strengths: (finalAnalysis.strengths ?? analysis.strengths) || [],
              weaknesses: (finalAnalysis.weaknesses ?? analysis.weaknesses) || [],
              locale: userLocale,
            })
          } catch (userEmailError) {
            console.error(`Failed to send interview report to ${email}:`, userEmailError)
          }
        }
      }
    } catch (emailError) {
      console.error('Error sending interview report emails:', emailError)
    }
  }

  return { status: 'completed', interviewId, score: analysis.score }
}
