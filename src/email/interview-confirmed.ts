import { getMailerSenderEmail, getTransporter } from './transporter'

export interface SendInterviewConfirmedParams {
  to: string
  candidateName: string
  jobTitle: string
  companyName: string
  joinLink: string
  scheduledAt: string
  duration: number
  candidateTimezone?: string | null
  locale?: 'en' | 'zh' | 'es' | 'fr'
}

function formatDateTime(isoString: string, locale: 'en' | 'zh' | 'es' | 'fr', timezone?: string | null): string {
  const date = new Date(isoString)
  const localeMap: Record<typeof locale, string> = {
    en: 'en-US',
    zh: 'zh-CN',
    es: 'es-ES',
    fr: 'fr-FR',
  }
  return date.toLocaleString(localeMap[locale], {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone || undefined,
    timeZoneName: 'short',
  })
}

export async function sendInterviewConfirmedEmail({
  to,
  candidateName,
  jobTitle,
  companyName,
  joinLink,
  scheduledAt,
  duration,
  candidateTimezone,
  locale = 'en',
}: SendInterviewConfirmedParams) {
  const content: Record<typeof locale, {
    subject: string
    title: string
    greeting: string
    confirmText: string
    scheduledTime: string
    durationLabel: string
    durationText: string
    joinButton: string
    reminderTitle: string
    reminder24h: string
    reminder1h: string
    regards: string
    hiringTeam: string
  }> = {
    en: {
      subject: `Interview Confirmed - ${jobTitle}`,
      title: 'Interview Time Confirmed',
      greeting: `Hi ${candidateName},`,
      confirmText: `Your interview for ${jobTitle} at ${companyName} has been confirmed.`,
      scheduledTime: 'Confirmed Time',
      durationLabel: 'Duration',
      durationText: `Approximately ${duration} minutes`,
      joinButton: 'Join Interview',
      reminderTitle: 'Reminders',
      reminder24h: 'You will receive a reminder 24 hours before the interview',
      reminder1h: 'You will receive a reminder 1 hour before the interview',
      regards: 'Best regards,',
      hiringTeam: `The Hiring Team at ${companyName}`,
    },
    zh: {
      subject: `面试确认 - ${jobTitle}`,
      title: '面试时间已确认',
      greeting: `${candidateName}，您好！`,
      confirmText: `您在 ${companyName} 应聘 ${jobTitle} 的面试时间已确认。`,
      scheduledTime: '确认时间',
      durationLabel: '时长',
      durationText: `约 ${duration} 分钟`,
      joinButton: '加入面试',
      reminderTitle: '提醒',
      reminder24h: '面试前 24 小时我们会发送提醒',
      reminder1h: '面试前 1 小时我们会发送提醒',
      regards: '此致，',
      hiringTeam: `${companyName} 招聘团队`,
    },
    es: {
      subject: `Entrevista Confirmada - ${jobTitle}`,
      title: 'Hora de la Entrevista Confirmada',
      greeting: `Hola ${candidateName},`,
      confirmText: `Tu entrevista para ${jobTitle} en ${companyName} ha sido confirmada.`,
      scheduledTime: 'Hora confirmada',
      durationLabel: 'Duración',
      durationText: `Aproximadamente ${duration} minutos`,
      joinButton: 'Unirse a la Entrevista',
      reminderTitle: 'Recordatorios',
      reminder24h: 'Recibirás un recordatorio 24 horas antes de la entrevista',
      reminder1h: 'Recibirás un recordatorio 1 hora antes de la entrevista',
      regards: 'Saludos cordiales,',
      hiringTeam: `El Equipo de Contratación de ${companyName}`,
    },
    fr: {
      subject: `Entretien Confirmé - ${jobTitle}`,
      title: 'Heure de l’entretien confirmée',
      greeting: `Bonjour ${candidateName},`,
      confirmText: `Votre entretien pour ${jobTitle} chez ${companyName} a été confirmé.`,
      scheduledTime: 'Heure confirmée',
      durationLabel: 'Durée',
      durationText: `Environ ${duration} minutes`,
      joinButton: "Rejoindre l'entretien",
      reminderTitle: 'Rappels',
      reminder24h: 'Vous recevrez un rappel 24 heures avant l’entretien',
      reminder1h: 'Vous recevrez un rappel 1 heure avant l’entretien',
      regards: 'Cordialement,',
      hiringTeam: `L'Équipe de Recrutement de ${companyName}`,
    },
  }

  const t = content[locale]
  const formattedScheduledTime = formatDateTime(scheduledAt, locale, candidateTimezone)

  const taglines: Record<typeof locale, string> = {
    en: 'AI hiring workflow from sourcing to offer',
    zh: '从寻才到 Offer 的 AI 招聘工作流',
    es: 'Flujo de contratación con IA desde la búsqueda hasta la oferta',
    fr: "Flux de recrutement IA du sourcing à l'offre",
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
      <div style="background: linear-gradient(135deg, #1E2E57 0%, #0A0E27 100%); padding: 40px 30px; text-align: center;">
        <div style="margin-bottom: 12px;">
          <span style="font-size: 36px; font-weight: 700; color: #00F0FF; text-shadow: 0 0 20px rgba(0, 240, 255, 0.3);">
            Foundire
          </span>
        </div>
        <p style="color: #00F0FF; font-size: 13px; letter-spacing: 2px; margin: 0; font-weight: 600; opacity: 0.9;">
          ${taglines[locale]}
        </p>
      </div>

      <div style="padding: 40px 30px;">
        <div style="text-align: center; margin-bottom: 25px;">
          <div style="display: inline-block; width: 60px; height: 60px; background-color: #22c55e; border-radius: 50%; line-height: 60px;">
            <span style="color: white; font-size: 28px;">✓</span>
          </div>
        </div>

        <h1 style="color: #1E2E57; font-size: 24px; font-weight: 700; margin: 0 0 25px 0; text-align: center;">
          ${t.title}
        </h1>

        <p style="color: #4b5563; font-size: 16px; margin-bottom: 10px;">${t.greeting}</p>

        <p style="color: #1f2937; font-size: 16px; line-height: 1.7; margin-bottom: 25px;">
          ${t.confirmText}
        </p>

        <div style="background-color: #f0fdff; border-left: 4px solid #00F0FF; padding: 20px; margin-bottom: 25px;">
          <p style="margin: 0 0 5px 0; color: #1E2E57; font-weight: 600;">
            ${t.scheduledTime}:
          </p>
          <p style="margin: 0; color: #1f2937; font-size: 18px; font-weight: 600;">
            ${formattedScheduledTime}
          </p>
        </div>

        <p style="color: #4b5563; font-size: 16px; margin-bottom: 25px;">
          <strong>${t.durationLabel}:</strong> ${t.durationText}
        </p>

        <div style="margin: 35px 0; text-align: center;">
          <a href="${joinLink}"
             style="background: linear-gradient(135deg, #1E2E57 0%, #0A0E27 100%); color: #00F0FF; padding: 16px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px; border: 2px solid #00F0FF;">
            ${t.joinButton}
          </a>
        </div>

        <div style="background-color: #f9fafb; padding: 20px; border-radius: 8px; margin: 25px 0;">
          <h3 style="margin: 0 0 15px 0; color: #1E2E57; font-size: 16px; font-weight: 600;">${t.reminderTitle}:</h3>
          <ul style="color: #4b5563; margin: 0; padding-left: 20px; line-height: 1.8;">
            <li>${t.reminder24h}</li>
            <li>${t.reminder1h}</li>
          </ul>
        </div>

        <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
          ${t.regards}<br/>
          ${t.hiringTeam}
        </p>
      </div>

      <div style="background-color: #f9fafb; padding: 20px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
        <p style="color: #6b7280; font-size: 12px; margin: 0;">
          © ${new Date().getFullYear()} Foundire. All rights reserved.
        </p>
      </div>
    </div>
  `

  const text = `
${t.title}

${t.greeting}

${t.confirmText}

${t.scheduledTime}: ${formattedScheduledTime}
${t.durationLabel}: ${t.durationText}

${t.joinButton}: ${joinLink}

${t.reminderTitle}:
- ${t.reminder24h}
- ${t.reminder1h}

${t.regards}
${t.hiringTeam}
  `

  try {
    const info = await getTransporter().sendMail({
      from: `"${companyName} via Foundire" <${getMailerSenderEmail()}>`,
      to,
      subject: t.subject,
      text,
      html,
    })

    console.log('Interview confirmed email sent:', info.messageId)
    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error('Error sending interview confirmed email:', error)
    throw error
  }
}
