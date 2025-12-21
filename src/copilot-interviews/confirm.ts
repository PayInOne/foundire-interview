import { createAdminClient } from '../supabase/admin'

export type CopilotConfirmPostResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 404 | 410 | 500; body: Record<string, unknown> }

export async function handleConfirmCopilotInterview(token: string): Promise<CopilotConfirmPostResponse> {
  try {
    const adminSupabase = createAdminClient()

    if (!token) {
      return { status: 400, body: { success: false, error: 'Invalid confirmation token' } }
    }

    const { data: target, error: targetError } = await adminSupabase
      .from('copilot_interviews')
      .select('id, invitation_expires_at, candidate_confirmed')
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
      return { status: 410, body: { success: false, error: 'Invitation expired' } }
    }

    const aiInterviewId = (target as { id: string }).id
    const alreadyConfirmed = Boolean((target as { candidate_confirmed?: boolean | null }).candidate_confirmed)

    if (!alreadyConfirmed) {
      const { error: confirmError } = await adminSupabase
        .from('copilot_interviews')
        .update({
          candidate_confirmed: true,
          candidate_confirmed_at: new Date().toISOString(),
        })
        .eq('id', aiInterviewId)

      if (confirmError) {
        console.error('Failed to confirm AI interview:', confirmError)
        return { status: 500, body: { success: false, error: 'Failed to confirm interview' } }
      }
    }

    const { data: copilotInterview, error: fetchError } = await adminSupabase
      .from('copilot_interviews')
      .select(
        `
        id,
        scheduled_at,
        interview_id,
        candidate_id,
        job_id,
        company_id,
        interviews(id),
        candidates(id, name, email),
        jobs(id, title),
        companies(id, name)
      `
      )
      .eq('id', aiInterviewId)
      .single()

    if (fetchError || !copilotInterview) {
      console.error('Failed to fetch interview details:', fetchError)
      return { status: 500, body: { success: false, error: 'Failed to fetch interview details' } }
    }

    const accessToken = `candidate_${aiInterviewId}_${Date.now()}_${Math.random().toString(36).substring(7)}`

    const scheduledTime = (copilotInterview as { scheduled_at?: string | null }).scheduled_at
      ? new Date((copilotInterview as { scheduled_at: string }).scheduled_at)
      : new Date()
    const expiryTime = new Date(scheduledTime)
    expiryTime.setHours(expiryTime.getHours() + 2)

    const { error: accessTokenError } = await adminSupabase
      .from('copilot_interviews')
      .update({
        candidate_access_token: accessToken,
        candidate_access_token_expires: expiryTime.toISOString(),
      })
      .eq('id', aiInterviewId)

    if (accessTokenError) {
      console.error('Failed to set candidate access token:', accessTokenError)
      return { status: 500, body: { success: false, error: 'Failed to issue access token' } }
    }

    return {
      status: 200,
      body: {
        success: true,
        data: {
          copilotInterviewId: aiInterviewId,
          interview: copilotInterview,
          accessToken,
        },
      },
    }
  } catch (error) {
    console.error('Confirm interview error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

export type CopilotConfirmGetResponse =
  | { status: 200; body: { success: true; data: unknown } }
  | { status: 400 | 404 | 410 | 500; body: { success: false; error: string } }

export async function handleGetCopilotConfirmInfo(token: string): Promise<CopilotConfirmGetResponse> {
  try {
    const adminSupabase = createAdminClient()

    const { data: copilotInterview, error } = await adminSupabase
      .from('copilot_interviews')
      .select(
        `
        id,
        confirmation_token,
        invitation_expires_at,
        scheduled_at,
        candidate_confirmed,
        room_status,
        interview_id,
        candidate_id,
        job_id,
        company_id,
        interviews(id),
        candidates(id, name, email),
        jobs(id, title, description),
        companies(id, name)
      `
      )
      .eq('confirmation_token', token)
      .single()

    if (error || !copilotInterview) {
      console.error('Get confirmation info error:', error)
      return { status: 404, body: { success: false, error: 'Invalid confirmation token' } }
    }

    const expiresAt = (copilotInterview as { invitation_expires_at?: string | null }).invitation_expires_at
    const scheduledAt = (copilotInterview as { scheduled_at?: string | null }).scheduled_at

    if (!expiresAt) {
      return { status: 400, body: { success: false, error: 'Invitation missing expiry time' } }
    }

    if (!scheduledAt) {
      return { status: 400, body: { success: false, error: 'Interview not scheduled' } }
    }

    if (new Date(expiresAt) < new Date()) {
      return { status: 410, body: { success: false, error: 'Invitation expired' } }
    }

    return { status: 200, body: { success: true, data: copilotInterview } }
  } catch (error) {
    console.error('Get confirmation info error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}
