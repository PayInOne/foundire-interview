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

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #111827;">
      <h2 style="margin: 0 0 16px 0;">${t.title}</h2>
      <p style="margin: 0 0 12px 0;">${t.greeting}</p>
      <p style="margin: 0 0 16px 0;">${t.confirmText}</p>
      <div style="background-color: #f0fdff; border-left: 4px solid #00F0FF; padding: 16px; margin: 0 0 16px 0;">
        <strong>${t.scheduledTime}:</strong> ${formattedScheduledTime}
      </div>
      <p style="margin: 0 0 16px 0;"><strong>${t.durationLabel}:</strong> ${t.durationText}</p>
      <p style="margin: 24px 0;">
        <a href="${joinLink}" style="display: inline-block; padding: 12px 18px; background: #1E2E57; color: #00F0FF; text-decoration: none; border-radius: 8px; font-weight: 600;">
          ${t.joinButton}
        </a>
      </p>
      <p style="margin: 0 0 16px 0; color: #6b7280;">${t.reminderTitle}:</p>
      <ul style="margin: 0 0 16px 16px; color: #6b7280;">
        <li>${t.reminder24h}</li>
        <li>${t.reminder1h}</li>
      </ul>
      <p style="margin: 24px 0 0 0; color: #6b7280;">${t.regards}<br/>${t.hiringTeam}</p>
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
