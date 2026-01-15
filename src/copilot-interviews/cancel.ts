import { createAdminClient } from '../supabase/admin'
import { deleteRoomForRegion } from '../livekit/rooms'
import type { LiveKitRegion } from '../livekit/geo-routing'
import { getMailerSenderEmail, getTransporter } from '../email/transporter'
import { asRecord, getOptionalString, getBoolean } from '../utils/parse'

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
    const sendEmail = getBoolean(record, 'sendEmail') ?? true

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
        candidate_email,
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
      candidate_email?: string | null
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
        .is('deleted_at', null)
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
    const candidateEmail = interview.candidate_email || interview.candidates?.email || null
    if (sendEmail && smtpReady && candidateEmail && interview.jobs?.title && interview.companies?.name) {
      const companyName = interview.companies.name
      const jobTitle = interview.jobs.title
      const candidateName = interview.candidates?.name || 'Candidate'

      const content: Record<typeof locale, {
        subject: string
        title: string
        greeting: string
        cancelText: string
        cancelledByLabel: string
        cancelledByValue: string
        reasonLabel: string
        apology: string
        regards: string
        team: string
        tagline: string
      }> = {
        zh: {
          subject: `${companyName} - 面试已取消 - ${jobTitle}`,
          title: '面试已取消',
          greeting: `${candidateName}，您好！`,
          cancelText: `很抱歉通知您，您在 ${companyName} 应聘 ${jobTitle} 职位的面试已被取消。`,
          cancelledByLabel: '取消方',
          cancelledByValue: cancelledBy === 'interviewer' ? '招聘方' : '候选人',
          reasonLabel: '原因',
          apology: '对此给您带来的不便，我们深表歉意。如有任何疑问，请联系招聘团队。',
          regards: '此致，',
          team: `${companyName} 招聘团队`,
          tagline: '从寻才到 Offer 的 AI 招聘工作流',
        },
        en: {
          subject: `${companyName} - Interview Cancelled - ${jobTitle}`,
          title: 'Interview Cancelled',
          greeting: `Hi ${candidateName},`,
          cancelText: `We regret to inform you that your interview for ${jobTitle} at ${companyName} has been cancelled.`,
          cancelledByLabel: 'Cancelled by',
          cancelledByValue: cancelledBy === 'interviewer' ? 'Hiring Team' : 'Candidate',
          reasonLabel: 'Reason',
          apology: 'We apologize for any inconvenience this may have caused. Please contact the hiring team if you have any questions.',
          regards: 'Best regards,',
          team: `The Hiring Team at ${companyName}`,
          tagline: 'AI hiring workflow from sourcing to offer',
        },
        es: {
          subject: `${companyName} - Entrevista Cancelada - ${jobTitle}`,
          title: 'Entrevista Cancelada',
          greeting: `Hola ${candidateName},`,
          cancelText: `Lamentamos informarte que tu entrevista para ${jobTitle} en ${companyName} ha sido cancelada.`,
          cancelledByLabel: 'Cancelada por',
          cancelledByValue: cancelledBy === 'interviewer' ? 'Equipo de Contratación' : 'Candidato',
          reasonLabel: 'Motivo',
          apology: 'Pedimos disculpas por las molestias que esto pueda haber causado. Por favor contacta al equipo de contratación si tienes alguna pregunta.',
          regards: 'Saludos cordiales,',
          team: `El Equipo de Contratación de ${companyName}`,
          tagline: 'Flujo de contratación con IA desde la búsqueda hasta la oferta',
        },
        fr: {
          subject: `${companyName} - Entretien Annulé - ${jobTitle}`,
          title: 'Entretien Annulé',
          greeting: `Bonjour ${candidateName},`,
          cancelText: `Nous avons le regret de vous informer que votre entretien pour ${jobTitle} chez ${companyName} a été annulé.`,
          cancelledByLabel: 'Annulé par',
          cancelledByValue: cancelledBy === 'interviewer' ? 'Équipe de Recrutement' : 'Candidat',
          reasonLabel: 'Raison',
          apology: 'Nous nous excusons pour tout inconvénient que cela a pu causer. Veuillez contacter l\'équipe de recrutement si vous avez des questions.',
          regards: 'Cordialement,',
          team: `L'Équipe de Recrutement de ${companyName}`,
          tagline: "Flux de recrutement IA du sourcing à l'offre",
        },
      }

      const c = content[locale]
      const contactEmail = interview.interviewer_email || 'hr@company.com'

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
          <div style="background: linear-gradient(135deg, #1E2E57 0%, #0A0E27 100%); padding: 40px 30px; text-align: center;">
            <div style="margin-bottom: 12px;">
              <span style="font-size: 36px; font-weight: 700; color: #00F0FF; text-shadow: 0 0 20px rgba(0, 240, 255, 0.3);">
                Foundire
              </span>
            </div>
            <p style="color: #00F0FF; font-size: 13px; letter-spacing: 2px; margin: 0; font-weight: 600; opacity: 0.9;">
              ${c.tagline}
            </p>
          </div>

          <div style="padding: 40px 30px;">
            <div style="text-align: center; margin-bottom: 25px;">
              <div style="display: inline-block; width: 60px; height: 60px; background-color: #ef4444; border-radius: 50%; line-height: 60px;">
                <span style="color: white; font-size: 28px;">✕</span>
              </div>
            </div>

            <h1 style="color: #1E2E57; font-size: 24px; font-weight: 700; margin: 0 0 25px 0; text-align: center;">
              ${c.title}
            </h1>

            <p style="color: #4b5563; font-size: 16px; margin-bottom: 10px;">${c.greeting}</p>

            <p style="color: #1f2937; font-size: 16px; line-height: 1.7; margin-bottom: 25px;">
              ${c.cancelText}
            </p>

            <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 20px; margin-bottom: 25px;">
              <p style="margin: 0 0 8px 0; color: #1E2E57;">
                <strong>${c.cancelledByLabel}:</strong> ${c.cancelledByValue}
              </p>
              ${reason ? `<p style="margin: 0; color: #1E2E57;"><strong>${c.reasonLabel}:</strong> ${reason}</p>` : ''}
            </div>

            <p style="color: #6b7280; font-size: 14px; margin-bottom: 25px;">
              ${c.apology}
            </p>

            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              ${c.regards}<br/>
              ${c.team}
            </p>

            <p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">
              Contact: <a href="mailto:${contactEmail}" style="color: #2563eb;">${contactEmail}</a>
            </p>
          </div>

          <div style="background-color: #f9fafb; padding: 20px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 12px; margin: 0;">
              © ${new Date().getFullYear()} Foundire. All rights reserved.
            </p>
          </div>
        </div>
      `

      try {
        await getTransporter().sendMail({
          from: `"${companyName}" <${getMailerSenderEmail()}>`,
          to: candidateEmail,
          subject: c.subject,
          html,
        })

        if (cancelledBy === 'candidate' && interview.interviewer_email) {
          await getTransporter().sendMail({
            from: `"${companyName}" <${getMailerSenderEmail()}>`,
            to: interview.interviewer_email,
            subject: c.subject,
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
