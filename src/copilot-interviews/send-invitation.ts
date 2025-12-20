import { getAppPublicUrl } from '../config'
import { createAdminClient } from '../supabase/admin'
import { getMailerSenderEmail, getTransporter } from '../email/transporter'
import { asRecord, getOptionalString } from '../utils/parse'

function detectLocale(input: string | undefined): 'en' | 'zh' | 'es' | 'fr' {
  const value = (input || '').toLowerCase()
  if (value.includes('zh')) return 'zh'
  if (value.includes('es')) return 'es'
  if (value.includes('fr')) return 'fr'
  return 'en'
}

export type CopilotSendInvitationResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 404 | 500; body: Record<string, unknown> }

export async function handleSendCopilotInvitationEmail(
  copilotInterviewId: string,
  body: unknown
): Promise<CopilotSendInvitationResponse> {
  try {
    const record = asRecord(body) ?? {}
    const localeInput = getOptionalString(record, 'locale') || getOptionalString(record, 'acceptLanguage')
    const locale = detectLocale(localeInput)

    const adminSupabase = createAdminClient()

    const { data: copilotInterview, error } = await adminSupabase
      .from('copilot_interviews')
      .select(
        `
        id,
        invitation_expires_at,
        interviewer_email,
        candidates(id, name, email),
        jobs(id, title),
        companies(id, name)
      `
      )
      .eq('id', copilotInterviewId)
      .single()

    if (error || !copilotInterview) {
      console.error('AI interview query error:', error)
      return { status: 404, body: { success: false, error: 'Interview not found' } }
    }

    const candidate = (copilotInterview as { candidates?: unknown }).candidates as
      | { name?: string | null; email?: string | null }
      | null
    const job = (copilotInterview as { jobs?: unknown }).jobs as { title?: string | null } | null
    const company = (copilotInterview as { companies?: unknown }).companies as { name?: string | null } | null
    const invitationExpiresAt = (copilotInterview as { invitation_expires_at?: string | null }).invitation_expires_at

    if (!candidate?.email || !job?.title || !company?.name || !invitationExpiresAt) {
      return { status: 500, body: { success: false, error: 'Interview data incomplete' } }
    }

    const baseUrl = getAppPublicUrl()
    const candidateUrl = `${baseUrl}/copilot-interview/${copilotInterviewId}/candidate`

    const expiresDate = new Date(invitationExpiresAt)
    const formattedExpiry = expiresDate.toLocaleDateString(
      locale === 'zh' ? 'zh-CN' : locale === 'es' ? 'es-ES' : locale === 'fr' ? 'fr-FR' : 'en-US',
      { year: 'numeric', month: 'long', day: 'numeric' }
    )

    const subjects: Record<typeof locale, string> = {
      zh: `${company.name} - 真人视频面试邀请 - ${job.title}`,
      en: `${company.name} - Live Interview Invitation - ${job.title}`,
      es: `${company.name} - Invitación a Entrevista en Video - ${job.title}`,
      fr: `${company.name} - Invitation à un Entretien Vidéo - ${job.title}`,
    }

    const greetings: Record<typeof locale, string> = {
      zh: `你好 ${candidate.name || ''}，`,
      en: `Hi ${candidate.name || 'there'},`,
      es: `Hola ${candidate.name || ''},`,
      fr: `Bonjour ${candidate.name || ''},`,
    }

    const intro: Record<typeof locale, string> = {
      zh: `我们想邀请你参加 <strong>${job.title}</strong> 的真人视频面试（AI 辅助）。`,
      en: `We'd like to invite you to a live video interview for <strong>${job.title}</strong> (AI-assisted).`,
      es: `Nos gustaría invitarte a una entrevista en video en vivo para <strong>${job.title}</strong> (asistida por IA).`,
      fr: `Nous aimerions vous inviter à un entretien vidéo en direct pour <strong>${job.title}</strong> (assisté par IA).`,
    }

    const cta: Record<typeof locale, string> = {
      zh: '进入面试房间',
      en: 'Enter Interview Room',
      es: 'Entrar a la Sala de Entrevista',
      fr: "Entrer dans la Salle d'Entretien",
    }

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #111827;">
        <h2 style="margin: 0 0 16px 0;">${company.name}</h2>
        <p style="margin: 0 0 12px 0;">${greetings[locale]}</p>
        <p style="margin: 0 0 16px 0;">${intro[locale]}</p>
        <p style="margin: 0 0 16px 0;"><strong>Valid Until:</strong> ${formattedExpiry}</p>
        <p style="margin: 24px 0;">
          <a href="${candidateUrl}" style="display: inline-block; padding: 12px 18px; background: #1E2E57; color: #00F0FF; text-decoration: none; border-radius: 8px; font-weight: 600;">
            ${cta[locale]}
          </a>
        </p>
        <p style="margin: 0 0 12px 0; color: #6b7280;">${candidateUrl}</p>
        <p style="margin: 24px 0 0 0; color: #6b7280; font-size: 12px;">Contact: ${(copilotInterview as { interviewer_email?: string | null }).interviewer_email || 'hr@company.com'}</p>
      </div>
    `

    const smtpReady = Boolean(process.env.SMTP_ADDRESS && process.env.SMTP_USERNAME && process.env.SMTP_PASSWORD && process.env.MAILER_SENDER_EMAIL)
    if (!smtpReady) {
      return { status: 200, body: { success: true, message: 'Interview scheduled but email not sent (SMTP not configured)' } }
    }

    try {
      await getTransporter().sendMail({
        from: `"${company.name}" <${getMailerSenderEmail()}>`,
        to: candidate.email,
        subject: subjects[locale],
        html,
      })
    } catch (emailError) {
      console.error('Send invitation email error:', emailError)
      return {
        status: 200,
        body: {
          success: true,
          warning: 'Interview scheduled but email failed to send',
          error: emailError instanceof Error ? emailError.message : 'Email error',
        },
      }
    }

    await adminSupabase
      .from('copilot_interviews')
      .update({ invitation_sent_at: new Date().toISOString() })
      .eq('id', copilotInterviewId)

    return { status: 200, body: { success: true, message: 'Invitation email sent successfully' } }
  } catch (error) {
    console.error('Send invitation API error:', error)
    return { status: 500, body: { success: false, error: 'Failed to send invitation' } }
  }
}

