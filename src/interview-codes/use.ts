import { createAdminClient } from '../supabase/admin'

export type UseInterviewCodeResponse =
  | { status: 200; body: { success: true } }
  | { status: 400 | 404 | 500; body: { error: string } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export async function handleUseInterviewCode(body: unknown): Promise<UseInterviewCodeResponse> {
  const record = isRecord(body) ? body : null

  const codeId = typeof record?.codeId === 'string' ? record.codeId : ''
  const candidateId = typeof record?.candidateId === 'string' ? record.candidateId : null
  const candidateEmail = typeof record?.candidateEmail === 'string' ? record.candidateEmail : null
  const candidateName = typeof record?.candidateName === 'string' ? record.candidateName : null
  const success = typeof record?.success === 'boolean' ? record.success : true
  const errorMessage = typeof record?.errorMessage === 'string' ? record.errorMessage : null
  const ipAddress = typeof record?.ipAddress === 'string' ? record.ipAddress : 'unknown'
  const userAgent = typeof record?.userAgent === 'string' ? record.userAgent : 'unknown'

  if (!codeId) {
    return { status: 400, body: { error: 'Missing code ID' } }
  }

  try {
    const supabase = createAdminClient()

    if (success) {
      const { data: code, error: codeError } = await supabase
        .from('interview_codes')
        .select('used_count, max_uses')
        .eq('id', codeId)
        .single()

      if (codeError || !code) {
        console.error('Error fetching code:', codeError)
        if ((codeError as { code?: string } | null)?.code === 'PGRST116') {
          return { status: 404, body: { error: 'Interview code not found' } }
        }
        return { status: 500, body: { error: 'Failed to verify code availability' } }
      }

      const current = code as unknown as { used_count: number; max_uses: number }
      if (current.used_count >= current.max_uses) {
        return { status: 400, body: { error: 'Interview code has reached maximum uses' } }
      }
    }

    const { error: logError } = await supabase.from('code_usage_logs').insert({
      code_id: codeId,
      candidate_id: candidateId,
      candidate_email: candidateEmail,
      candidate_name: candidateName,
      ip_address: ipAddress || null,
      user_agent: userAgent,
      success,
      error_message: errorMessage,
    })

    if (logError) {
      console.error('Error logging code usage:', logError)
    }

    if (success) {
      const { error: updateError } = await supabase.rpc('increment_code_usage', {
        p_code_id: codeId,
      })

      if (updateError) {
        console.error('Error incrementing code usage:', updateError)

        const { data: code } = await supabase
          .from('interview_codes')
          .select('used_count')
          .eq('id', codeId)
          .single()

        const current = code as unknown as { used_count?: number } | null
        if (current && typeof current.used_count === 'number') {
          await supabase
            .from('interview_codes')
            .update({ used_count: current.used_count + 1 })
            .eq('id', codeId)
        }
      }

      const { error: invitationError } = await supabase
        .from('candidate_invitations')
        .update({ code_used: true, code_used_at: new Date().toISOString() })
        .eq('interview_code_id', codeId)
        .eq('code_used', false)

      if (invitationError) {
        console.error('Error updating candidate invitation usage:', invitationError)
      }
    }

    return { status: 200, body: { success: true } }
  } catch (error) {
    console.error('Error using interview code:', error)
    return { status: 500, body: { error: 'Internal server error' } }
  }
}
