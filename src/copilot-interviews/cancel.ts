import { createAdminClient } from '../supabase/admin'
import { deleteRoomForRegion } from '../livekit/rooms'
import type { LiveKitRegion } from '../livekit/geo-routing'
import { getMailerSenderEmail, getTransporter } from '../email/transporter'
import { asRecord, getOptionalString } from '../utils/parse'

function detectLocale(input: string | undefined): 'en' | 'zh' | 'es' | 'fr' {
  const value = (input || '').toLowerCase()
  if (value.includes('zh')) return 'zh'
  if (value.includes('es')) return 'es'
  if (value.includes('fr')) return 'fr'
  return 'en'
}

export type CopilotCancelResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 403 | 404 | 500; body: Record<string, unknown> }

export async function handleCancelCopilotInterview(
  copilotInterviewId: string,
  body: unknown
): Promise<CopilotCancelResponse> {
  try {
    const record = asRecord(body) ?? {}
    const reason = getOptionalString(record, 'reason')
    const cancelledBy = getOptionalString(record, 'cancelledBy') as 'interviewer' | 'candidate' | undefined
    const userId = getOptionalString(record, 'userId')
    const locale = detectLocale(getOptionalString(record, 'locale') || getOptionalString(record, 'acceptLanguage'))

    if (cancelledBy !== 'interviewer' && cancelledBy !== 'candidate') {
      return { status: 400, body: { success: false, error: 'cancelledBy must be interviewer or candidate' } }
    }

    const adminSupabase = createAdminClient()

    const { data: copilotInterview, error } = await adminSupabase
      .from('copilot_interviews')
      .select(
        `
        id,
        room_status,
        scheduled_at,
        interview_id,
        candidate_id,
        job_id,
        company_id,
        interviewer_email,
        livekit_room_name,
        livekit_region,
        candidates(id, name, email),
        jobs(id, title),
        companies(id, name)
      `
      )
      .eq('id', copilotInterviewId)
      .single()

    if (error || !copilotInterview) {
      return { status: 404, body: { success: false, error: 'Interview not found' } }
    }

    const interview = copilotInterview as {
      room_status: string
      interview_id: string
      candidate_id: string
      company_id: string
      interviewer_email: string | null
      livekit_room_name: string | null
      livekit_region: string | null
      candidates: { name?: string | null; email?: string | null } | null
      jobs: { title?: string | null } | null
      companies: { name?: string | null } | null
      scheduled_at: string | null
    }

    if (cancelledBy === 'interviewer') {
      if (!userId) {
        return { status: 403, body: { success: false, error: 'Unauthorized' } }
      }

      const { data: isMember } = await adminSupabase
        .from('company_members')
        .select('id')
        .eq('company_id', interview.company_id)
        .eq('user_id', userId)
        .single()

      if (!isMember) {
        return { status: 403, body: { success: false, error: 'Unauthorized' } }
      }
    }

    if (interview.room_status === 'in_progress') {
      return { status: 400, body: { success: false, error: 'Cannot cancel interview in progress' } }
    }
    if (interview.room_status === 'completed') {
      return { status: 400, body: { success: false, error: 'Cannot cancel completed interview' } }
    }
    if (interview.room_status === 'cancelled') {
      return { status: 400, body: { success: false, error: 'Interview already cancelled' } }
    }

    await adminSupabase
      .from('copilot_interviews')
      .update({ room_status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', copilotInterviewId)

    await adminSupabase.from('interviews').update({ status: 'cancelled' }).eq('id', interview.interview_id)

    await adminSupabase
      .from('candidates')
      .update({ status: 'pending', interview_mode: null })
      .eq('id', interview.candidate_id)

    if (interview.livekit_room_name) {
      await deleteRoomForRegion(
        interview.livekit_room_name,
        (interview.livekit_region as LiveKitRegion | null) ?? null
      )
    }

    const smtpReady = Boolean(process.env.SMTP_ADDRESS && process.env.SMTP_USERNAME && process.env.SMTP_PASSWORD && process.env.MAILER_SENDER_EMAIL)
    if (smtpReady && interview.candidates?.email && interview.jobs?.title && interview.companies?.name) {
      const companyName = interview.companies.name
      const jobTitle = interview.jobs.title
      const candidateEmail = interview.candidates.email
      const candidateName = interview.candidates.name || 'Candidate'

      const subjects: Record<typeof locale, string> = {
        zh: `${companyName} - 面试已取消 - ${jobTitle}`,
        en: `${companyName} - Interview Cancelled - ${jobTitle}`,
        es: `${companyName} - Entrevista Cancelada - ${jobTitle}`,
        fr: `${companyName} - Entretien Annulé - ${jobTitle}`,
      }

      const byLabel: Record<typeof locale, string> = {
        zh: cancelledBy === 'interviewer' ? '面试官' : '候选人',
        en: cancelledBy === 'interviewer' ? 'Interviewer' : 'Candidate',
        es: cancelledBy === 'interviewer' ? 'Entrevistador' : 'Candidato',
        fr: cancelledBy === 'interviewer' ? 'Recruteur' : 'Candidat',
      }

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #111827;">
          <h2 style="margin: 0 0 16px 0;">${subjects[locale]}</h2>
          <p style="margin: 0 0 8px 0;">Hi ${candidateName},</p>
          <p style="margin: 0 0 16px 0;">Your interview for <strong>${jobTitle}</strong> has been cancelled.</p>
          <p style="margin: 0 0 8px 0;"><strong>Cancelled by:</strong> ${byLabel[locale]}</p>
          ${reason ? `<p style="margin: 0 0 8px 0;"><strong>Reason:</strong> ${reason}</p>` : ''}
          <p style="margin: 24px 0 0 0; color: #6b7280; font-size: 12px;">Contact: ${interview.interviewer_email || 'hr@company.com'}</p>
        </div>
      `

      try {
        await getTransporter().sendMail({
          from: `"${companyName}" <${getMailerSenderEmail()}>`,
          to: candidateEmail,
          subject: subjects[locale],
          html,
        })

        if (cancelledBy === 'candidate' && interview.interviewer_email) {
          await getTransporter().sendMail({
            from: `"${companyName}" <${getMailerSenderEmail()}>`,
            to: interview.interviewer_email,
            subject: subjects[locale],
            html,
          })
        }
      } catch (emailError) {
        console.error('Failed to send cancellation email:', emailError)
      }
    }

    return {
      status: 200,
      body: { success: true, message: 'Interview cancelled successfully', data: { copilotInterviewId, status: 'cancelled' } },
    }
  } catch (error) {
    console.error('Cancel interview error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

