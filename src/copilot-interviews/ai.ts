import { createAdminClient } from '../supabase/admin'
import { asRecord, getBoolean, getString } from '../utils/parse'

export type CopilotAiToggleResponse =
  | { status: 200; body: { success: true; ai_enabled: boolean } }
  | { status: 400; body: { error: string } }
  | { status: 401 | 403 | 404 | 500; body: { error: string } }

export async function handleToggleCopilotAi(
  copilotInterviewId: string,
  body: unknown
): Promise<CopilotAiToggleResponse> {
  try {
    const record = asRecord(body)
    if (!record) return { status: 400, body: { error: 'Invalid request body' } }

    const enabled = getBoolean(record, 'enabled')
    if (enabled === null) return { status: 400, body: { error: 'Invalid request: enabled must be a boolean' } }

    const userId = getString(record, 'userId')
    if (!userId) return { status: 401, body: { error: 'Unauthorized' } }

    const adminSupabase = createAdminClient()

    const { data: copilotInterview, error: fetchError } = await adminSupabase
      .from('copilot_interviews')
      .select('company_id')
      .eq('id', copilotInterviewId)
      .single()

    if (fetchError || !copilotInterview) {
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
      return { status: 403, body: { error: 'You are not a member of this company' } }
    }

    const { error: updateError } = await adminSupabase
      .from('copilot_interviews')
      .update({ ai_enabled: enabled })
      .eq('id', copilotInterviewId)

    if (updateError) {
      console.error('Error updating ai_enabled:', updateError)
      return { status: 500, body: { error: 'Failed to update AI status' } }
    }

    return { status: 200, body: { success: true, ai_enabled: enabled } }
  } catch (error) {
    console.error('Error toggling copilot ai:', error)
    return { status: 500, body: { error: 'Internal server error' } }
  }
}

