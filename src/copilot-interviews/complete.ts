import { createAdminClient } from '../supabase/admin'
import { enqueueInterviewAnalyzeTask } from '../workers/interview-analyze'
import { completeCopilotInterview } from './manager'

export type CopilotCompleteResponse =
  | { status: 200; body: { success: true; message: string } }
  | { status: 500; body: { error: string } }

export async function handleCompleteCopilotInterview(copilotInterviewId: string): Promise<CopilotCompleteResponse> {
  try {
    const adminSupabase = createAdminClient()

    const result = await completeCopilotInterview(copilotInterviewId, adminSupabase)
    if (!result.success || !result.data) {
      return { status: 500, body: { error: result.error || 'Failed to complete interview' } }
    }

    const copilot = result.data as { interview_id: string; interviewer_id: string | null }
    const interviewId = copilot.interview_id

    let locale = 'en'
    if (copilot.interviewer_id) {
      try {
        const { data } = await adminSupabase.auth.admin.getUserById(copilot.interviewer_id)
        const interviewer = data?.user
        locale = (interviewer?.user_metadata?.locale as string | undefined) || 'en'
      } catch (error) {
        console.warn('Failed to get interviewer locale:', error)
      }
    }

    if (process.env.RABBITMQ_URL && interviewId) {
      try {
        await enqueueInterviewAnalyzeTask({ interviewId, locale, sendEmail: true })
      } catch (error) {
        console.error('Failed to enqueue interview analysis:', error)
      }
    }

    return { status: 200, body: { success: true, message: 'Interview completed successfully' } }
  } catch (error) {
    console.error('Error completing copilot interview:', error)
    return { status: 500, body: { error: 'Internal server error' } }
  }
}

