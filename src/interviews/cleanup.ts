import { createAdminClient } from '../supabase/admin'
import { toJson } from '../supabase/json'
import { deductCredits } from '../credits/manager'
import { deleteRoomForRegion } from '../livekit/rooms'
import type { LiveKitRegion } from '../livekit/geo-routing'

export type CleanupStandardInterviewsResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 500; body: { error: string } }

function parseRegion(value: unknown): LiveKitRegion | null {
  return value === 'self-hosted' || value === 'cloud' ? value : null
}

type InterviewRow = {
  id: string
  company_id: string
  candidate_id: string | null
  started_at: string | null
  last_active_at: string | null
  credits_deducted: number | null
  livekit_room_name: string | null
  livekit_region?: unknown
}

export async function handleCleanupStandardInterviews(): Promise<CleanupStandardInterviewsResponse> {
  try {
    const supabase = createAdminClient()
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

    let abandonedInterviews: unknown = null
    let fetchError: { code?: string } | null = null

    ;({ data: abandonedInterviews, error: fetchError } = await supabase
      .from('interviews')
      .select(
        'id, company_id, candidate_id, started_at, last_active_at, credits_deducted, livekit_room_name, livekit_region'
      )
      .eq('status', 'in-progress')
      .or(`last_active_at.lt.${fiveMinutesAgo},last_active_at.is.null`))

    if (fetchError?.code === '42703') {
      ;({ data: abandonedInterviews, error: fetchError } = await supabase
        .from('interviews')
        .select('id, company_id, candidate_id, started_at, last_active_at, credits_deducted, livekit_room_name')
        .eq('status', 'in-progress')
        .or(`last_active_at.lt.${fiveMinutesAgo},last_active_at.is.null`))
    }

    if (fetchError) {
      console.error('Error fetching abandoned interviews:', fetchError)
      return { status: 500, body: { error: 'Failed to fetch abandoned interviews' } }
    }

    const rows = (abandonedInterviews || []) as unknown as InterviewRow[]
    if (rows.length === 0) {
      return {
        status: 200,
        body: { success: true, message: 'No abandoned interviews found', processed: 0, results: [] },
      }
    }

    const candidateIds = rows
      .map((row) => row.candidate_id)
      .filter((candidateId): candidateId is string => Boolean(candidateId))
    const candidateSourceMap = new Map<string, string | null>()
    const companyIds = Array.from(new Set(rows.map((row) => row.company_id)))
    const companySlugMap = new Map<string, string | null>()

    if (candidateIds.length > 0) {
      const { data: candidates } = await supabase
        .from('candidates')
        .select('id, source')
        .in('id', candidateIds)

      if (Array.isArray(candidates)) {
        candidates.forEach((candidate) => {
          candidateSourceMap.set(candidate.id, candidate.source ?? null)
        })
      }
    }

    if (companyIds.length > 0) {
      const { data: companies } = await supabase
        .from('companies')
        .select('id, slug')
        .in('id', companyIds)

      if (Array.isArray(companies)) {
        companies.forEach((company) => {
          companySlugMap.set(company.id, company.slug ?? null)
        })
      }
    }

    const results: Array<Record<string, unknown>> = []

    for (const interview of rows) {
      try {
        const companySlug = companySlugMap.get(interview.company_id)
        const isTalentApplicant = interview.candidate_id
          ? candidateSourceMap.get(interview.candidate_id) === 'talent_applicant' || companySlug === 'foundire-talent'
          : companySlug === 'foundire-talent'
        const startedAt = interview.started_at ? new Date(interview.started_at) : null
        const completedAt = interview.last_active_at ? new Date(interview.last_active_at) : new Date()

        const alreadyDeducted = interview.credits_deducted || 0
        let totalMinutes = alreadyDeducted

        if (startedAt && completedAt > startedAt) {
          totalMinutes = Math.ceil((completedAt.getTime() - startedAt.getTime()) / 1000 / 60)
        }

        if (startedAt && startedAt > completedAt) {
          totalMinutes = alreadyDeducted
        }

        const remainingCredits = Math.max(0, totalMinutes - alreadyDeducted)

        const aiAnalysisJson = toJson({
          score: 0,
          summary: 'Interview was abandoned or disconnected before completion.',
          strengths: [],
          weaknesses: ['Interview not completed'],
          recommendations: ['Consider reaching out to the candidate to reschedule.'],
        })

        const { error: updateError } = await supabase
          .from('interviews')
          .update({
            status: 'completed',
            completed_at: completedAt.toISOString(),
            score: 0,
            ai_analysis: aiAnalysisJson,
          })
          .eq('id', interview.id)

        if (updateError) {
          console.error(`Error updating interview ${interview.id}:`, updateError)
          results.push({ interviewId: interview.id, success: false, error: 'Failed to update interview' })
          continue
        }

        if (interview.candidate_id) {
          await supabase
            .from('candidates')
            .update({ status: 'pending' })
            .eq('id', interview.candidate_id)
            .then(({ error }) => {
              if (error) console.error(`Error updating candidate status for interview ${interview.id}:`, error)
            })
        }

        let creditDeductionResult: { success: boolean; newBalance: number } | null = null
        const creditsToDeduct = isTalentApplicant ? 0 : remainingCredits
        if (creditsToDeduct > 0) {
          creditDeductionResult = await deductCredits(
            {
              companyId: interview.company_id,
              amount: creditsToDeduct,
              type: 'interview_minute',
              referenceId: interview.id,
              referenceType: 'interview',
              description: `Interview abandoned: final ${creditsToDeduct} minute(s)`,
            },
            supabase
          )

          if (creditDeductionResult.success) {
            await supabase
              .from('interviews')
              .update({ credits_deducted: totalMinutes })
              .eq('id', interview.id)
          }
        }

        let roomDeleted = false
        if (interview.livekit_room_name) {
          try {
            const region = parseRegion(interview.livekit_region)
            if (region) {
              roomDeleted = await deleteRoomForRegion(interview.livekit_room_name, region)
            } else {
              roomDeleted = await deleteRoomForRegion(interview.livekit_room_name, 'self-hosted')
              if (!roomDeleted) {
                roomDeleted = await deleteRoomForRegion(interview.livekit_room_name, 'cloud')
              }
            }
          } catch (roomError) {
            console.error(`Failed to delete room for interview ${interview.id}:`, roomError)
          }
        }

        results.push({
          interviewId: interview.id,
          success: true,
          totalMinutes,
          alreadyDeducted,
          creditsDeducted: creditsToDeduct,
          creditDeductionSuccess: creditDeductionResult?.success ?? true,
          newBalance: creditDeductionResult?.newBalance ?? 0,
          roomDeleted,
        })
      } catch (error) {
        console.error(`Error processing interview ${interview.id}:`, error)
        results.push({
          interviewId: interview.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return {
      status: 200,
      body: {
        success: true,
        processed: results.length,
        results,
      },
    }
  } catch (error) {
    console.error('Error in cleanup standard interviews:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return { status: 500, body: { error: message } }
  }
}
