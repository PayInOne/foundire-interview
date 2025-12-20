import { createAdminClient } from '../supabase/admin'
import { asRecord, getBoolean, getString } from '../utils/parse'

export type CoseatAiResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401 | 403 | 404 | 500; body: Record<string, unknown> }

export async function handleToggleCoseatAi(
  coseatInterviewId: string,
  body: unknown
): Promise<CoseatAiResponse> {
  try {
    const record = asRecord(body) ?? {}
    const enabled = getBoolean(record, 'enabled')
    const userId = getString(record, 'userId')

    if (enabled === null) {
      return { status: 400, body: { error: 'Invalid request: enabled must be a boolean' } }
    }

    if (!userId) {
      return { status: 401, body: { error: 'Unauthorized' } }
    }

    const adminSupabase = createAdminClient()

    const { data: coseatInterview, error: fetchError } = await adminSupabase
      .from('coseat_interviews')
      .select('company_id')
      .eq('id', coseatInterviewId)
      .single()

    if (fetchError || !coseatInterview) {
      return { status: 404, body: { error: 'CoSeat interview not found' } }
    }

    const companyId = (coseatInterview as { company_id: string }).company_id

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
      .from('coseat_interviews')
      .update({ ai_enabled: enabled })
      .eq('id', coseatInterviewId)

    if (updateError) {
      console.error('Error updating ai_enabled:', updateError)
      return { status: 500, body: { error: 'Failed to update AI status' } }
    }

    return { status: 200, body: { success: true, ai_enabled: enabled } }
  } catch (error) {
    console.error('Error in PATCH /internal/coseat/[id]/ai:', error)
    return { status: 500, body: { error: 'Internal server error' } }
  }
}

