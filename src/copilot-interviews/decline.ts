import { createAdminClient } from '../supabase/admin'

export type CopilotDeclineResponse =
  | { status: 200; body: { success: true; message: string } }
  | { status: 400 | 404 | 410 | 500; body: { success: false; error: string; code?: string } }

export async function handleDeclineCopilotInterview(token: string): Promise<CopilotDeclineResponse> {
  try {
    const adminSupabase = createAdminClient()

    if (!token) {
      return { status: 400, body: { success: false, error: 'Invalid confirmation token' } }
    }

    const { data: target, error: targetError } = await adminSupabase
      .from('copilot_interviews')
      .select('id, invitation_expires_at, candidate_confirmed, room_status')
      .eq('confirmation_token', token)
      .single()

    if (targetError || !target) {
      return { status: 404, body: { success: false, error: 'Invalid confirmation token' } }
    }

    const expiresAt = (target as { invitation_expires_at?: string | null }).invitation_expires_at
    if (!expiresAt) {
      return { status: 400, body: { success: false, error: 'Invitation missing expiry time' } }
    }

    if (new Date(expiresAt) < new Date()) {
      return { status: 410, body: { success: false, error: 'Invitation expired', code: 'INVITATION_EXPIRED' } }
    }

    const roomStatus = (target as { room_status?: string }).room_status
    if (roomStatus === 'cancelled') {
      return { status: 410, body: { success: false, error: 'Interview has been cancelled', code: 'INTERVIEW_CANCELLED' } }
    }
    if (roomStatus === 'completed') {
      return { status: 410, body: { success: false, error: 'Interview has already been completed', code: 'INTERVIEW_COMPLETED' } }
    }
    if (roomStatus === 'missed') {
      return { status: 410, body: { success: false, error: 'Interview has been marked as missed', code: 'INTERVIEW_MISSED' } }
    }

    const aiInterviewId = (target as { id: string }).id

    // Mark interview as cancelled (declined by candidate)
    const { error: updateError } = await adminSupabase
      .from('copilot_interviews')
      .update({
        room_status: 'cancelled',
        candidate_confirmed: false,
      })
      .eq('id', aiInterviewId)

    if (updateError) {
      console.error('Failed to decline interview:', updateError)
      return { status: 500, body: { success: false, error: 'Failed to decline interview' } }
    }

    // Also update the linked interview status
    const { data: copilotInterview } = await adminSupabase
      .from('copilot_interviews')
      .select('interview_id, candidate_id')
      .eq('id', aiInterviewId)
      .single()

    if (copilotInterview) {
      const interviewId = (copilotInterview as { interview_id?: string }).interview_id
      const candidateId = (copilotInterview as { candidate_id?: string }).candidate_id

      if (interviewId) {
        await adminSupabase.from('interviews').update({ status: 'cancelled' }).eq('id', interviewId)
      }

      if (candidateId) {
        // Reset candidate status to pending (or whatever makes sense for your workflow)
        await adminSupabase.from('candidates').update({ status: 'pending' }).eq('id', candidateId)
      }
    }

    return { status: 200, body: { success: true, message: 'Interview declined successfully' } }
  } catch (error) {
    console.error('Decline interview error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}
