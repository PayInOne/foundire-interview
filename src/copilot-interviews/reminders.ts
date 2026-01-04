import { createAdminClient } from '../supabase/admin'
import { getAppPublicUrl } from '../config'
import { getMailerSenderEmail, getTransporter } from '../email/transporter'

type Locale = 'en' | 'zh' | 'es' | 'fr'
type ReminderType = '24h' | '1h'

interface InterviewData {
  id: string
  scheduled_at: string
  candidate_timezone?: string | null
  candidate_email?: string | null
  candidates: { name?: string | null; email?: string | null } | null
  companies: { name?: string | null } | null
  jobs: { title?: string | null } | null
  interviews: { interview_duration?: number | null } | null
}

function detectLocale(timezone?: string | null): Locale {
  if (timezone?.startsWith('Asia')) return 'zh'
  return 'en'
}

function formatDateTime(isoString: string, locale: Locale, timezone?: string | null): string {
  const date = new Date(isoString)
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone || undefined,
    timeZoneName: 'short',
  }
  const localeMap: Record<Locale, string> = {
    en: 'en-US',
    zh: 'zh-CN',
    es: 'es-ES',
    fr: 'fr-FR',
  }
  return date.toLocaleString(localeMap[locale], options)
}

function getEmailContent(
  reminderType: ReminderType,
  locale: Locale,
  data: {
    candidateName: string
    jobTitle: string
    companyName: string
    scheduledTime: string
    duration: number
    joinLink: string
  }
) {
  const { candidateName, jobTitle, companyName, scheduledTime, duration, joinLink } = data
  const is24h = reminderType === '24h'

  const content: Record<Locale, {
    subject: string
    title: string
    greeting: string
    reminderText: string
    scheduledTimeLabel: string
    durationLabel: string
    durationText: string
    joinButton: string
    checklist: string
    checkItems: string[]
    windowNote: string
    goodLuck: string
    regards: string
    team: string
    tagline: string
  }> = {
    en: {
      subject: is24h
        ? `Reminder: Interview Tomorrow - ${jobTitle}`
        : `Reminder: Interview in 1 Hour - ${jobTitle}`,
      title: is24h ? 'Your Interview is Tomorrow' : 'Your Interview is in 1 Hour',
      greeting: `Hi ${candidateName},`,
      reminderText: is24h
        ? `This is a friendly reminder that your interview for ${jobTitle} at ${companyName} is scheduled for tomorrow.`
        : `This is a friendly reminder that your interview for ${jobTitle} at ${companyName} starts in 1 hour.`,
      scheduledTimeLabel: 'Interview Time',
      durationLabel: 'Duration',
      durationText: `Approximately ${duration} minutes`,
      joinButton: 'Join Interview',
      checklist: 'Quick Checklist',
      checkItems: [
        'Webcam and microphone working',
        'Stable internet connection',
        'Quiet environment prepared',
        'Modern browser ready (Chrome recommended)',
      ],
      windowNote: 'The interview room will be available 15 minutes before the scheduled time.',
      goodLuck: 'Good luck with your interview!',
      regards: 'Best regards,',
      team: `The Hiring Team at ${companyName}`,
      tagline: 'AI hiring workflow from sourcing to offer',
    },
    zh: {
      subject: is24h
        ? `面试提醒：明天 - ${jobTitle}`
        : `面试提醒：1小时后 - ${jobTitle}`,
      title: is24h ? '您的面试在明天' : '您的面试在 1 小时后',
      greeting: `${candidateName}，您好！`,
      reminderText: is24h
        ? `友情提醒：您在 ${companyName} 应聘 ${jobTitle} 职位的面试定于明天进行。`
        : `友情提醒：您在 ${companyName} 应聘 ${jobTitle} 职位的面试将在 1 小时后开始。`,
      scheduledTimeLabel: '面试时间',
      durationLabel: '时长',
      durationText: `约 ${duration} 分钟`,
      joinButton: '加入面试',
      checklist: '快速检查清单',
      checkItems: [
        '摄像头和麦克风正常',
        '网络连接稳定',
        '环境安静',
        '浏览器就绪（推荐 Chrome）',
      ],
      windowNote: '面试室将在预约时间前 15 分钟开放。',
      goodLuck: '祝您面试顺利！',
      regards: '此致，',
      team: `${companyName} 招聘团队`,
      tagline: '从寻才到 Offer 的 AI 招聘工作流',
    },
    es: {
      subject: is24h
        ? `Recordatorio: Entrevista Mañana - ${jobTitle}`
        : `Recordatorio: Entrevista en 1 Hora - ${jobTitle}`,
      title: is24h ? 'Tu Entrevista es Mañana' : 'Tu Entrevista es en 1 Hora',
      greeting: `Hola ${candidateName},`,
      reminderText: is24h
        ? `Este es un recordatorio de que tu entrevista para ${jobTitle} en ${companyName} está programada para mañana.`
        : `Este es un recordatorio de que tu entrevista para ${jobTitle} en ${companyName} comienza en 1 hora.`,
      scheduledTimeLabel: 'Hora de la Entrevista',
      durationLabel: 'Duración',
      durationText: `Aproximadamente ${duration} minutos`,
      joinButton: 'Unirse a la Entrevista',
      checklist: 'Lista de Verificación',
      checkItems: [
        'Cámara y micrófono funcionando',
        'Conexión a internet estable',
        'Ambiente tranquilo preparado',
        'Navegador moderno listo (Chrome recomendado)',
      ],
      windowNote: 'La sala de entrevistas estará disponible 15 minutos antes de la hora programada.',
      goodLuck: '¡Buena suerte con tu entrevista!',
      regards: 'Saludos cordiales,',
      team: `El Equipo de Contratación de ${companyName}`,
      tagline: 'Flujo de contratación con IA desde la búsqueda hasta la oferta',
    },
    fr: {
      subject: is24h
        ? `Rappel: Entretien Demain - ${jobTitle}`
        : `Rappel: Entretien dans 1 Heure - ${jobTitle}`,
      title: is24h ? 'Votre Entretien est Demain' : 'Votre Entretien est dans 1 Heure',
      greeting: `Bonjour ${candidateName},`,
      reminderText: is24h
        ? `Ceci est un rappel que votre entretien pour ${jobTitle} chez ${companyName} est prévu pour demain.`
        : `Ceci est un rappel que votre entretien pour ${jobTitle} chez ${companyName} commence dans 1 heure.`,
      scheduledTimeLabel: "Heure de l'Entretien",
      durationLabel: 'Durée',
      durationText: `Environ ${duration} minutes`,
      joinButton: "Rejoindre l'Entretien",
      checklist: 'Liste de Vérification',
      checkItems: [
        'Caméra et microphone fonctionnels',
        'Connexion internet stable',
        'Environnement calme préparé',
        'Navigateur moderne prêt (Chrome recommandé)',
      ],
      windowNote: "La salle d'entretien sera disponible 15 minutes avant l'heure prévue.",
      goodLuck: 'Bonne chance pour votre entretien!',
      regards: 'Cordialement,',
      team: `L'Équipe de Recrutement de ${companyName}`,
      tagline: "Flux de recrutement IA du sourcing à l'offre",
    },
  }

  const c = content[locale]
  const urgencyColor = is24h ? '#3b82f6' : '#f59e0b'
  const urgencyBgColor = is24h ? '#eff6ff' : '#fffbeb'

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
          <div style="display: inline-block; width: 60px; height: 60px; background-color: ${urgencyColor}; border-radius: 50%; line-height: 60px;">
            <span style="color: white; font-size: 28px;">⏰</span>
          </div>
        </div>

        <h1 style="color: #1E2E57; font-size: 24px; font-weight: 700; margin: 0 0 25px 0; text-align: center;">
          ${c.title}
        </h1>

        <p style="color: #4b5563; font-size: 16px; margin-bottom: 10px;">${c.greeting}</p>

        <p style="color: #1f2937; font-size: 16px; line-height: 1.7; margin-bottom: 25px;">
          ${c.reminderText}
        </p>

        <div style="background-color: ${urgencyBgColor}; border-left: 4px solid ${urgencyColor}; padding: 20px; margin-bottom: 25px;">
          <p style="margin: 0 0 5px 0; color: #1E2E57; font-weight: 600;">
            ${c.scheduledTimeLabel}:
          </p>
          <p style="margin: 0; color: #1f2937; font-size: 18px; font-weight: 600;">
            ${scheduledTime}
          </p>
        </div>

        <p style="color: #4b5563; font-size: 16px; margin-bottom: 25px;">
          <strong>${c.durationLabel}:</strong> ${c.durationText}
        </p>

        <div style="margin: 35px 0; text-align: center;">
          <a href="${joinLink}"
             style="background: linear-gradient(135deg, #1E2E57 0%, #0A0E27 100%); color: #00F0FF; padding: 16px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px; border: 2px solid #00F0FF;">
            ${c.joinButton}
          </a>
        </div>

        <div style="background-color: #f9fafb; padding: 20px; border-radius: 8px; margin: 25px 0;">
          <h3 style="margin: 0 0 15px 0; color: #1E2E57; font-size: 16px; font-weight: 600;">${c.checklist}:</h3>
          <ul style="color: #4b5563; margin: 0; padding-left: 20px; line-height: 1.8;">
            ${c.checkItems.map((item) => `<li>☐ ${item}</li>`).join('')}
          </ul>
        </div>

        <p style="color: #6b7280; font-size: 14px; margin-top: 20px; text-align: center; font-style: italic;">
          ${c.windowNote}
        </p>

        <p style="color: #1f2937; font-size: 16px; margin-top: 25px; text-align: center; font-weight: 600;">
          ${c.goodLuck}
        </p>

        <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
          ${c.regards}<br/>
          ${c.team}
        </p>
      </div>

      <div style="background-color: #f9fafb; padding: 20px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
        <p style="color: #6b7280; font-size: 12px; margin: 0;">
          &copy; ${new Date().getFullYear()} Foundire. All rights reserved.
        </p>
      </div>
    </div>
  `

  const text = `
${c.title}

${c.greeting}

${c.reminderText}

${c.scheduledTimeLabel}: ${scheduledTime}

${c.durationLabel}: ${c.durationText}

${c.joinButton}: ${joinLink}

${c.checklist}:
${c.checkItems.map((item) => `[ ] ${item}`).join('\n')}

${c.windowNote}

${c.goodLuck}

${c.regards}
${c.team}
  `

  return { subject: c.subject, html, text }
}

async function sendReminderEmail(
  interview: InterviewData,
  reminderType: ReminderType,
  locale: Locale = 'en'
): Promise<boolean> {
  const candidate = interview.candidates
  const company = interview.companies
  const job = interview.jobs
  const recipientEmail = interview.candidate_email || candidate?.email || null

  if (!recipientEmail || !company?.name || !job?.title || !interview.scheduled_at) {
    console.error(`[Reminder] Missing data for interview ${interview.id}`)
    return false
  }

  const smtpReady = Boolean(
    process.env.SMTP_ADDRESS &&
      process.env.SMTP_USERNAME &&
      process.env.SMTP_PASSWORD &&
      process.env.MAILER_SENDER_EMAIL
  )

  if (!smtpReady) {
    console.warn(`[Reminder] SMTP not configured, skipping email for interview ${interview.id}`)
    return true // Return true to mark as "sent" even without SMTP
  }

  const baseUrl = getAppPublicUrl()
  const joinLink = `${baseUrl}/copilot-interview/${interview.id}/candidate`
  const scheduledTime = formatDateTime(interview.scheduled_at, locale, interview.candidate_timezone)
  const duration = interview.interviews?.interview_duration || 30

  const { subject, html, text } = getEmailContent(reminderType, locale, {
    candidateName: candidate?.name || 'Candidate',
    jobTitle: job.title,
    companyName: company.name,
    scheduledTime,
    duration,
    joinLink,
  })

  try {
    await getTransporter().sendMail({
      from: `"${company.name} via Foundire" <${getMailerSenderEmail()}>`,
      to: recipientEmail,
      subject,
      html,
      text,
    })

    console.log(`[Reminder] Sent ${reminderType} reminder to ${recipientEmail} for interview ${interview.id}`)
    return true
  } catch (error) {
    console.error(`[Reminder] Failed to send ${reminderType} reminder for interview ${interview.id}:`, error)
    return false
  }
}

export type SendRemindersResponse =
  | { status: 200; body: { success: true; sent24h: number; sent1h: number } }
  | { status: 500; body: { success: false; error: string } }

/**
 * Send interview reminders for scheduled interviews
 * - 24h reminder: sent 24 hours before scheduled time
 * - 1h reminder: sent 1 hour before scheduled time
 */
export async function handleSendInterviewReminders(): Promise<SendRemindersResponse> {
  try {
    const adminSupabase = createAdminClient()
    const now = new Date()

    // Find interviews that need 24h reminder
    // scheduled_at is between 23-25 hours from now, and reminder_sent_24h is false
    const in24hStart = new Date(now.getTime() + 23 * 60 * 60 * 1000)
    const in24hEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000)

    const { data: need24hReminder, error: error24h } = await adminSupabase
      .from('copilot_interviews')
      .select(
        `
        id,
        scheduled_at,
        candidate_timezone,
        candidate_email,
        candidates(id, name, email),
        companies(id, name),
        jobs(id, title),
        interviews(interview_duration)
      `
      )
      .in('scheduling_mode', ['scheduled', 'candidate_choice'])
      .eq('reminder_sent_24h', false)
      .eq('candidate_confirmed', true)
      .not('room_status', 'in', '("completed","cancelled","missed")')
      .gte('scheduled_at', in24hStart.toISOString())
      .lte('scheduled_at', in24hEnd.toISOString())

    if (error24h) {
      console.error('Error fetching 24h reminders:', error24h)
    }

    // Find interviews that need 1h reminder
    // scheduled_at is between 55-65 minutes from now, and reminder_sent_1h is false
    const in1hStart = new Date(now.getTime() + 55 * 60 * 1000)
    const in1hEnd = new Date(now.getTime() + 65 * 60 * 1000)

    const { data: need1hReminder, error: error1h } = await adminSupabase
      .from('copilot_interviews')
      .select(
        `
        id,
        scheduled_at,
        candidate_timezone,
        candidate_email,
        candidates(id, name, email),
        companies(id, name),
        jobs(id, title),
        interviews(interview_duration)
      `
      )
      .in('scheduling_mode', ['scheduled', 'candidate_choice'])
      .eq('reminder_sent_1h', false)
      .eq('candidate_confirmed', true)
      .not('room_status', 'in', '("completed","cancelled","missed")')
      .gte('scheduled_at', in1hStart.toISOString())
      .lte('scheduled_at', in1hEnd.toISOString())

    if (error1h) {
      console.error('Error fetching 1h reminders:', error1h)
    }

    let sent24h = 0
    let sent1h = 0

    // Process 24h reminders
    if (need24hReminder && need24hReminder.length > 0) {
      for (const interview of need24hReminder) {
        try {
          const interviewData: InterviewData = {
            id: interview.id,
            scheduled_at: interview.scheduled_at as string,
            candidate_timezone: interview.candidate_timezone,
            candidate_email: interview.candidate_email as string | null | undefined,
            candidates: interview.candidates as InterviewData['candidates'],
            companies: interview.companies as InterviewData['companies'],
            jobs: interview.jobs as InterviewData['jobs'],
            interviews: interview.interviews as InterviewData['interviews'],
          }

          const locale = detectLocale(interviewData.candidate_timezone)
          const emailSent = await sendReminderEmail(interviewData, '24h', locale)

          if (emailSent) {
            await adminSupabase
              .from('copilot_interviews')
              .update({ reminder_sent_24h: true })
              .eq('id', interview.id)

            sent24h++
          }
        } catch (err) {
          console.error(`Failed to process 24h reminder for ${interview.id}:`, err)
        }
      }
    }

    // Process 1h reminders
    if (need1hReminder && need1hReminder.length > 0) {
      for (const interview of need1hReminder) {
        try {
          const interviewData: InterviewData = {
            id: interview.id,
            scheduled_at: interview.scheduled_at as string,
            candidate_timezone: interview.candidate_timezone,
            candidate_email: interview.candidate_email as string | null | undefined,
            candidates: interview.candidates as InterviewData['candidates'],
            companies: interview.companies as InterviewData['companies'],
            jobs: interview.jobs as InterviewData['jobs'],
            interviews: interview.interviews as InterviewData['interviews'],
          }

          const locale = detectLocale(interviewData.candidate_timezone)
          const emailSent = await sendReminderEmail(interviewData, '1h', locale)

          if (emailSent) {
            await adminSupabase
              .from('copilot_interviews')
              .update({ reminder_sent_1h: true })
              .eq('id', interview.id)

            sent1h++
          }
        } catch (err) {
          console.error(`Failed to process 1h reminder for ${interview.id}:`, err)
        }
      }
    }

    console.log(`[Reminders] Sent ${sent24h} 24h reminders, ${sent1h} 1h reminders`)

    return {
      status: 200,
      body: { success: true, sent24h, sent1h },
    }
  } catch (error) {
    console.error('Error in handleSendInterviewReminders:', error)
    return {
      status: 500,
      body: { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
    }
  }
}

export type CheckMissedResponse =
  | { status: 200; body: { success: true; markedMissed: number } }
  | { status: 500; body: { success: false; error: string } }

/**
 * Check for interviews that have passed their time window and mark them as missed
 * Time window is scheduled_at + 15 minutes
 */
export async function handleCheckMissedInterviews(): Promise<CheckMissedResponse> {
  try {
    const adminSupabase = createAdminClient()
    const now = new Date()

    // Find scheduled interviews where:
    // - scheduling_mode is 'scheduled' or 'candidate_choice' (with confirmed time)
    // - scheduled_at + 15 minutes < now
    // - room_status is still waiting_*
    const cutoffTime = new Date(now.getTime() - 15 * 60 * 1000)

    const { data: missedInterviews, error } = await adminSupabase
      .from('copilot_interviews')
      .select('id, interview_id, candidate_id, scheduled_at, room_status')
      .in('scheduling_mode', ['scheduled', 'candidate_choice'])
      .not('scheduled_at', 'is', null)
      .lt('scheduled_at', cutoffTime.toISOString())
      .in('room_status', ['waiting_both', 'waiting_candidate', 'waiting_interviewer'])

    if (error) {
      console.error('Error fetching missed interviews:', error)
      return {
        status: 500,
        body: { success: false, error: error.message },
      }
    }

    let markedMissed = 0

    if (missedInterviews && missedInterviews.length > 0) {
      for (const record of missedInterviews) {
        try {
          // Update copilot_interviews status
          const { error: updateError } = await adminSupabase
            .from('copilot_interviews')
            .update({ room_status: 'missed' })
            .eq('id', record.id)

          if (updateError) {
            console.error(`Failed to mark interview ${record.id} as missed:`, updateError)
            continue
          }

          // Also update the related interviews table
          if (record.interview_id) {
            await adminSupabase
              .from('interviews')
              .update({ status: 'cancelled' })
              .eq('id', record.interview_id)
          }

          // Reset candidate status to pending
          if (record.candidate_id) {
            await adminSupabase
              .from('candidates')
              .update({ status: 'pending' })
              .eq('id', record.candidate_id)
          }

          console.log(`[Missed] Marked interview ${record.id} as missed (scheduled: ${record.scheduled_at})`)
          markedMissed++
        } catch (err) {
          console.error(`Error processing missed interview ${record.id}:`, err)
        }
      }
    }

    console.log(`[Missed] Marked ${markedMissed} interviews as missed`)

    return {
      status: 200,
      body: { success: true, markedMissed },
    }
  } catch (error) {
    console.error('Error in handleCheckMissedInterviews:', error)
    return {
      status: 500,
      body: { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
    }
  }
}
