import { createAdminClient } from '../supabase/admin'

export type CopilotConfirmPostResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 404 | 410 | 500; body: Record<string, unknown> }

export async function handleConfirmCopilotInterview(token: string): Promise<CopilotConfirmPostResponse> {
  try {
    const adminSupabase = createAdminClient()

    const { data, error } = await adminSupabase.rpc('confirm_ai_interview', {
      p_confirmation_token: token,
    })

    if (error) {
      return { status: 500, body: { success: false, error: error.message } }
    }

    const result = Array.isArray(data) && data.length > 0 ? (data[0] as { success?: boolean; error_message?: string; ai_interview_id?: string }) : null
    if (!result || !result.success || !result.ai_interview_id) {
      return {
        status: 400,
        body: { success: false, error: result?.error_message || 'Failed to confirm interview' },
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
      .eq('id', result.ai_interview_id)
      .single()

    if (fetchError || !copilotInterview) {
      console.error('Failed to fetch interview details:', fetchError)
      return { status: 500, body: { success: false, error: 'Failed to fetch interview details' } }
    }

    const accessToken = `candidate_${result.ai_interview_id}_${Date.now()}_${Math.random().toString(36).substring(7)}`

    const scheduledTime = (copilotInterview as { scheduled_at?: string | null }).scheduled_at
      ? new Date((copilotInterview as { scheduled_at: string }).scheduled_at)
      : new Date()
    const expiryTime = new Date(scheduledTime)
    expiryTime.setHours(expiryTime.getHours() + 2)

    await adminSupabase
      .from('copilot_interviews')
      .update({
        candidate_access_token: accessToken,
        candidate_access_token_expires: expiryTime.toISOString(),
      })
      .eq('id', result.ai_interview_id)

    return {
      status: 200,
      body: {
        success: true,
        data: {
          copilotInterviewId: result.ai_interview_id,
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

