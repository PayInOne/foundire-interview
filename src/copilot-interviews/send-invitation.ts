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

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type SchedulingMode = 'instant' | 'scheduled' | 'candidate_choice'

interface TimeSlot {
  start: string
  end: string
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

export type CopilotSendInvitationResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 404 | 500; body: Record<string, unknown> }

export async function handleSendCopilotInvitationEmail(
  copilotInterviewId: string,
  body: unknown
): Promise<CopilotSendInvitationResponse> {
  try {
    console.log('[SendInvitation] Received body:', JSON.stringify(body))
    const record = asRecord(body) ?? {}
    const localeInput = getOptionalString(record, 'locale') || getOptionalString(record, 'acceptLanguage')
    const locale = detectLocale(localeInput)
    const candidateEmailOverride = getOptionalString(record, 'candidateEmail')?.trim()
    console.log('[SendInvitation] candidateEmailOverride:', candidateEmailOverride)

    if (candidateEmailOverride && !EMAIL_REGEX.test(candidateEmailOverride)) {
      return { status: 400, body: { success: false, error: 'Invalid candidate email' } }
    }

    const adminSupabase = createAdminClient()

    const { data: copilotInterview, error } = await adminSupabase
      .from('copilot_interviews')
      .select(
        `
        id,
        invitation_expires_at,
        interviewer_email,
        candidate_email,
        confirmation_token,
        scheduling_mode,
        scheduled_at,
        available_slots,
        interviewer_timezone,
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
    const interviewCandidateEmail = (copilotInterview as { candidate_email?: string | null }).candidate_email
    const job = (copilotInterview as { jobs?: unknown }).jobs as { title?: string | null } | null
    const company = (copilotInterview as { companies?: unknown }).companies as { name?: string | null } | null
    const invitationExpiresAt = (copilotInterview as { invitation_expires_at?: string | null }).invitation_expires_at
    const schedulingMode = (copilotInterview as { scheduling_mode?: SchedulingMode | null }).scheduling_mode || 'instant'
    const scheduledAt = (copilotInterview as { scheduled_at?: string | null }).scheduled_at
    const availableSlots = (copilotInterview as { available_slots?: TimeSlot[] | null }).available_slots
    const interviewerTimezone = (copilotInterview as { interviewer_timezone?: string | null }).interviewer_timezone
    const confirmationToken = (copilotInterview as { confirmation_token?: string | null }).confirmation_token

    const recipientEmail = candidateEmailOverride || interviewCandidateEmail || candidate?.email || null
    console.log('[SendInvitation] Email resolution:', {
      candidateEmailOverride,
      interviewCandidateEmail,
      candidateEmail: candidate?.email,
      recipientEmail,
    })

    if (!recipientEmail || !job?.title || !company?.name || !invitationExpiresAt) {
      return { status: 500, body: { success: false, error: 'Interview data incomplete' } }
    }

    if (candidateEmailOverride && candidateEmailOverride !== interviewCandidateEmail) {
      console.log('[SendInvitation] Updating candidate_email from', interviewCandidateEmail, 'to', candidateEmailOverride)
      const { error: updateError } = await adminSupabase
        .from('copilot_interviews')
        .update({ candidate_email: candidateEmailOverride, updated_at: new Date().toISOString() })
        .eq('id', copilotInterviewId)

      if (updateError) {
        console.warn('[SendInvitation] Failed to update candidate email:', updateError)
      } else {
        console.log('[SendInvitation] Successfully updated candidate_email')
      }
    }

    const baseUrl = getAppPublicUrl()
    const candidateUrl = `${baseUrl}/copilot-interview/${copilotInterviewId}/candidate`
    const confirmUrl = confirmationToken ? `${baseUrl}/copilot-interview/confirm/${confirmationToken}` : candidateUrl
    const actionUrl = schedulingMode === 'instant' ? candidateUrl : confirmUrl

    const expiresDate = new Date(invitationExpiresAt)
    const formattedExpiry = expiresDate.toLocaleDateString(
      locale === 'zh' ? 'zh-CN' : locale === 'es' ? 'es-ES' : locale === 'fr' ? 'fr-FR' : 'en-US',
      { year: 'numeric', month: 'long', day: 'numeric' }
    )

    const subjects: Record<typeof locale, Record<SchedulingMode, string>> = {
      zh: {
        instant: `${company.name} - 真人视频面试邀请 - ${job.title}`,
        scheduled: `${company.name} - 面试已预约 - ${job.title}`,
        candidate_choice: `${company.name} - 面试邀请（请选择时间） - ${job.title}`,
      },
      en: {
        instant: `${company.name} - Live Interview Invitation - ${job.title}`,
        scheduled: `${company.name} - Interview Scheduled - ${job.title}`,
        candidate_choice: `${company.name} - Interview Invitation (Select Your Time) - ${job.title}`,
      },
      es: {
        instant: `${company.name} - Invitación a Entrevista en Video - ${job.title}`,
        scheduled: `${company.name} - Entrevista Programada - ${job.title}`,
        candidate_choice: `${company.name} - Invitación a Entrevista (Seleccione Horario) - ${job.title}`,
      },
      fr: {
        instant: `${company.name} - Invitation à un Entretien Vidéo - ${job.title}`,
        scheduled: `${company.name} - Entretien Planifié - ${job.title}`,
        candidate_choice: `${company.name} - Invitation à un Entretien (Choisissez un Horaire) - ${job.title}`,
      },
    }

    const greetings: Record<typeof locale, string> = {
      zh: `你好 ${candidate?.name || ''}，`,
      en: `Hi ${candidate?.name || 'there'},`,
      es: `Hola ${candidate?.name || ''},`,
      fr: `Bonjour ${candidate?.name || ''},`,
    }

    const introByMode: Record<typeof locale, Record<SchedulingMode, string>> = {
      zh: {
        instant: `我们想邀请你参加 <strong>${job.title}</strong> 的真人视频面试（AI 辅助）。`,
        scheduled: `你已被安排参加 <strong>${job.title}</strong> 的真人视频面试（AI 辅助）。请确认参加。`,
        candidate_choice: `你已受邀参加 <strong>${job.title}</strong> 的真人视频面试（AI 辅助）。请从以下时间段中选择适合的时间。`,
      },
      en: {
        instant: `We'd like to invite you to a live video interview for <strong>${job.title}</strong> (AI-assisted).`,
        scheduled: `You are scheduled for a live video interview for <strong>${job.title}</strong> (AI-assisted). Please confirm your attendance.`,
        candidate_choice: `You've been invited to a live video interview for <strong>${job.title}</strong> (AI-assisted). Please choose a time slot below.`,
      },
      es: {
        instant: `Nos gustaría invitarte a una entrevista en video en vivo para <strong>${job.title}</strong> (asistida por IA).`,
        scheduled: `Tienes programada una entrevista en video en vivo para <strong>${job.title}</strong> (asistida por IA). Por favor confirma tu asistencia.`,
        candidate_choice: `Has sido invitado a una entrevista en video en vivo para <strong>${job.title}</strong> (asistida por IA). Por favor selecciona un horario abajo.`,
      },
      fr: {
        instant: `Nous aimerions vous inviter à un entretien vidéo en direct pour <strong>${job.title}</strong> (assisté par IA).`,
        scheduled: `Vous êtes planifié pour un entretien vidéo en direct pour <strong>${job.title}</strong> (assisté par IA). Merci de confirmer votre participation.`,
        candidate_choice: `Vous êtes invité à un entretien vidéo en direct pour <strong>${job.title}</strong> (assisté par IA). Merci de choisir un créneau ci-dessous.`,
      },
    }

    const labels: Record<typeof locale, {
      validUntil: string
      scheduledTime: string
      availableSlots: string
      enterRoom: string
      confirm: string
      selectTime: string
      slotOption: (index: number) => string
      timeWindow: string
    }> = {
      zh: {
        validUntil: '有效期至',
        scheduledTime: '面试时间',
        availableSlots: '可选时间段',
        enterRoom: '进入面试房间',
        confirm: '确认面试',
        selectTime: '选择时间',
        slotOption: (index: number) => `选项 ${index}`,
        timeWindow: '请在预约时间前后 15 分钟内进入面试房间',
      },
      en: {
        validUntil: 'Valid Until',
        scheduledTime: 'Scheduled Time',
        availableSlots: 'Available Time Slots',
        enterRoom: 'Enter Interview Room',
        confirm: 'Confirm Interview',
        selectTime: 'Select Time Slot',
        slotOption: (index: number) => `Option ${index}`,
        timeWindow: 'Please join within 15 minutes before or after the scheduled time',
      },
      es: {
        validUntil: 'Válido hasta',
        scheduledTime: 'Hora programada',
        availableSlots: 'Horarios disponibles',
        enterRoom: 'Entrar a la Sala de Entrevista',
        confirm: 'Confirmar Entrevista',
        selectTime: 'Seleccionar Horario',
        slotOption: (index: number) => `Opción ${index}`,
        timeWindow: 'Únete dentro de los 15 minutos antes o después de la hora programada',
      },
      fr: {
        validUntil: 'Valable jusqu’au',
        scheduledTime: 'Heure prévue',
        availableSlots: 'Créneaux disponibles',
        enterRoom: "Entrer dans la Salle d'Entretien",
        confirm: 'Confirmer l’entretien',
        selectTime: 'Choisir un créneau',
        slotOption: (index: number) => `Option ${index}`,
        timeWindow: 'Merci de rejoindre dans les 15 minutes avant ou après l’heure prévue',
      },
    }

    const actionLabel =
      schedulingMode === 'instant'
        ? labels[locale].enterRoom
        : schedulingMode === 'scheduled'
          ? labels[locale].confirm
          : labels[locale].selectTime

    const formattedScheduledTime =
      schedulingMode === 'scheduled' && scheduledAt
        ? formatDateTime(scheduledAt, locale, interviewerTimezone)
        : null

    let timeSlotsHtml = ''
    let timeSlotsText = ''
    if (schedulingMode === 'candidate_choice' && availableSlots && availableSlots.length > 0) {
      timeSlotsHtml = availableSlots
        .map((slot, index) => {
          const formattedTime = formatDateTime(slot.start, locale, interviewerTimezone)
          return `
            <div style="background-color: #f9fafb; padding: 10px 12px; border-radius: 6px; margin-bottom: 8px; border-left: 3px solid #00F0FF;">
              <strong style="color: #1E2E57;">${labels[locale].slotOption(index + 1)}:</strong>
              <span style="color: #4b5563; margin-left: 8px;">${formattedTime}</span>
            </div>
          `
        })
        .join('')

      timeSlotsText = availableSlots
        .map((slot, index) => {
          const formattedTime = formatDateTime(slot.start, locale, interviewerTimezone)
          return `${labels[locale].slotOption(index + 1)}: ${formattedTime}`
        })
        .join('\n')
    }

    const subject = subjects[locale][schedulingMode]
    const intro = introByMode[locale][schedulingMode]
    const introText = intro.replace(/<[^>]+>/g, '')

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #111827;">
        <h2 style="margin: 0 0 16px 0;">${company.name}</h2>
        <p style="margin: 0 0 12px 0;">${greetings[locale]}</p>
        <p style="margin: 0 0 16px 0;">${intro}</p>

        ${
          formattedScheduledTime
            ? `
        <div style="background-color: #f0fdff; border-left: 4px solid #00F0FF; padding: 16px; margin: 0 0 16px 0;">
          <strong>${labels[locale].scheduledTime}:</strong> ${formattedScheduledTime}
        </div>
        `
            : ''
        }

        ${
          timeSlotsHtml
            ? `
        <div style="margin: 0 0 16px 0;">
          <p style="margin: 0 0 10px 0; font-weight: 600;">${labels[locale].availableSlots}:</p>
          ${timeSlotsHtml}
        </div>
        `
            : ''
        }

        <p style="margin: 0 0 16px 0;"><strong>${labels[locale].validUntil}:</strong> ${formattedExpiry}</p>
        ${schedulingMode === 'instant' ? '' : `<p style="margin: 0 0 16px 0; color: #6b7280;">${labels[locale].timeWindow}</p>`}
        <p style="margin: 24px 0;">
          <a href="${actionUrl}" style="display: inline-block; padding: 12px 18px; background: #1E2E57; color: #00F0FF; text-decoration: none; border-radius: 8px; font-weight: 600;">
            ${actionLabel}
          </a>
        </p>
        <p style="margin: 0 0 12px 0; color: #6b7280;">${actionUrl}</p>
        <p style="margin: 24px 0 0 0; color: #6b7280; font-size: 12px;">Contact: ${(copilotInterview as { interviewer_email?: string | null }).interviewer_email || 'hr@company.com'}</p>
      </div>
    `

    const timeInfoText = formattedScheduledTime ? `${labels[locale].scheduledTime}: ${formattedScheduledTime}` : ''
    const slotsInfoText = timeSlotsText ? `${labels[locale].availableSlots}:\n${timeSlotsText}` : ''
    const timeWindowText = schedulingMode === 'instant' ? '' : labels[locale].timeWindow
    const contactEmail = (copilotInterview as { interviewer_email?: string | null }).interviewer_email || 'hr@company.com'

    const text = `
${company.name}

${greetings[locale]}

${introText}

${timeInfoText}
${slotsInfoText}
${labels[locale].validUntil}: ${formattedExpiry}
${timeWindowText}

${actionLabel}: ${actionUrl}

Contact: ${contactEmail}
    `

    const smtpReady = Boolean(
      process.env.SMTP_ADDRESS &&
        process.env.SMTP_USERNAME &&
        process.env.SMTP_PASSWORD &&
        process.env.MAILER_SENDER_EMAIL
    )
    if (!smtpReady) {
      return { status: 500, body: { success: false, error: 'SMTP not configured' } }
    }

    try {
      await getTransporter().sendMail({
        from: `"${company.name}" <${getMailerSenderEmail()}>`,
        to: recipientEmail,
        subject,
        html,
        text,
      })
    } catch (emailError) {
      console.error('Send invitation email error:', emailError)
      return {
        status: 500,
        body: {
          success: false,
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
