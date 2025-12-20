import { createAdminClient } from '../supabase/admin'
import { getCopilotInterviewState, getInterviewParticipants } from './manager'

export type CopilotInterviewStatusResponse =
  | {
      status: 200
      body: {
        success: true
        data: unknown
        job: unknown
        candidate: unknown
        participants: unknown[]
      }
    }
  | { status: 404; body: { error: string } }
  | { status: 500; body: { error: string } }

export async function handleGetCopilotInterviewStatus(
  copilotInterviewId: string
): Promise<CopilotInterviewStatusResponse> {
  try {
    const result = await getCopilotInterviewState(copilotInterviewId)
    if (!result.success || !result.data) {
      return { status: 404, body: { error: result.error || 'AI interview not found' } }
    }

    const adminClient = createAdminClient()

    const copilot = result.data as {
      job_id: string
      candidate_id: string
    }

    const { data: job } = await adminClient
      .from('jobs')
      .select('id, title, employment_type')
      .eq('id', copilot.job_id)
      .single()

    const { data: candidate } = await adminClient
      .from('candidates')
      .select('id, name, email')
      .eq('id', copilot.candidate_id)
      .single()

    const participants = await getInterviewParticipants(copilotInterviewId, adminClient)

    const userInfoMap = new Map<string, { name: string; email?: string; avatarUrl?: string }>()
    await Promise.all(
      participants.map(async (p) => {
        try {
          const { data } = await adminClient.auth.admin.getUserById(p.user_id)
          const user = data?.user
          if (!user) return

          userInfoMap.set(p.user_id, {
            name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Interviewer',
            email: user.email,
            avatarUrl: user.user_metadata?.avatar_url,
          })
        } catch (err) {
          console.error(`Failed to get user ${p.user_id}:`, err)
        }
      })
    )

    const participantsWithInfo = participants.map((p) => {
      const userInfo = userInfoMap.get(p.user_id)
      return {
        ...p,
        name: userInfo?.name || 'Interviewer',
        email: userInfo?.email,
        avatarUrl: userInfo?.avatarUrl,
      }
    })

    return {
      status: 200,
      body: {
        success: true,
        data: result.data,
        job,
        candidate,
        participants: participantsWithInfo,
      },
    }
  } catch (error) {
    console.error('Error fetching AI interview status:', error)
    return { status: 500, body: { error: 'Internal server error' } }
  }
}

