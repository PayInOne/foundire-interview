import { createAdminClient } from '../supabase/admin'
import { startCopilotInterview } from './manager'
import { asRecord, getString } from '../utils/parse'

export type CopilotStartResponse =
  | { status: 200; body: { success: true; data: unknown } }
  | { status: 400 | 401 | 403 | 404 | 500; body: { error: string } }

export async function handleStartCopilotInterview(copilotInterviewId: string, body: unknown): Promise<CopilotStartResponse> {
  try {
    const record = asRecord(body) ?? {}
    const userId = getString(record, 'userId')
    if (!userId) return { status: 401, body: { error: 'Unauthorized' } }

    const adminSupabase = createAdminClient()

    const { data: copilotInterview, error } = await adminSupabase
      .from('copilot_interviews')
      .select('company_id')
      .eq('id', copilotInterviewId)
      .single()

    if (error || !copilotInterview) {
      return { status: 404, body: { error: 'Copilot interview not found' } }
    }

    const companyId = (copilotInterview as { company_id: string }).company_id

    const { data: isMember } = await adminSupabase
      .from('company_members')
      .select('id')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .single()

    if (!isMember) {
      return { status: 403, body: { error: 'Unauthorized: You are not a member of this company' } }
    }

    const result = await startCopilotInterview(copilotInterviewId, adminSupabase)
    if (!result.success) {
      return { status: 400, body: { error: result.error || 'Failed to start interview' } }
    }

    return { status: 200, body: { success: true, data: result.data } }
  } catch (error) {
    console.error('Error starting copilot interview:', error)
    return { status: 500, body: { error: 'Internal server error' } }
  }
}

