import { createAdminClient } from '../supabase/admin'
import { asRecord, getOptionalString, getString } from '../utils/parse'

export type CoseatCancelResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401 | 403 | 404 | 500; body: Record<string, unknown> }

export async function handleCancelCoseatInterview(
  coseatInterviewId: string,
  body: unknown
): Promise<CoseatCancelResponse> {
  try {
    const record = asRecord(body) ?? {}
    const userId = getString(record, 'userId')
    getOptionalString(record, 'reason')

    if (!userId) {
      return { status: 401, body: { success: false, error: 'Unauthorized' } }
    }

    const adminSupabase = createAdminClient()

    const { data: coseatInterview, error: fetchError } = await adminSupabase
      .from('coseat_interviews')
      .select('id, session_status, interview_id, candidate_id, company_id')
      .eq('id', coseatInterviewId)
      .single()

    if (fetchError || !coseatInterview) {
      return { status: 404, body: { success: false, error: 'CoSeat interview not found' } }
    }

    const meta = coseatInterview as {
      session_status: string | null
      interview_id: string
      candidate_id: string
      company_id: string
    }

    const { data: isMember } = await adminSupabase
      .from('company_members')
      .select('id')
      .eq('company_id', meta.company_id)
      .eq('user_id', userId)
      .single()

    if (!isMember) {
      return { status: 403, body: { success: false, error: 'Unauthorized' } }
    }

    if (meta.session_status === 'active') {
      return { status: 400, body: { success: false, error: 'Cannot cancel interview in progress' } }
    }
    if (meta.session_status === 'completed') {
      return { status: 400, body: { success: false, error: 'Interview already completed' } }
    }
    if (meta.session_status === 'cancelled') {
      return { status: 400, body: { success: false, error: 'Interview already cancelled' } }
    }

    const now = new Date().toISOString()

    const { error: updateCoseatError } = await adminSupabase
      .from('coseat_interviews')
      .update({ session_status: 'cancelled', ended_at: now })
      .eq('id', coseatInterviewId)

    if (updateCoseatError) {
      console.error('Failed to cancel coseat interview:', updateCoseatError)
      return { status: 500, body: { success: false, error: 'Failed to cancel CoSeat interview' } }
    }

    await adminSupabase
      .from('interviews')
      .update({ status: 'cancelled' })
      .eq('id', meta.interview_id)

    await adminSupabase
      .from('candidates')
      .update({ status: 'pending', interview_mode: null })
      .eq('id', meta.candidate_id)

    return { status: 200, body: { success: true, data: { cancelled: true } } }
  } catch (error) {
    console.error('Cancel CoSeat interview error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}
