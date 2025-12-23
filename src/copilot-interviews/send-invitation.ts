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
      tagline: string
      whatYouNeed: string
      needWebcam: string
      needMicrophone: string
      needQuiet: string
      needBrowser: string
      goodLuck: string
      regards: string
      hiringTeam: string
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
        tagline: '像创始人一样招聘',
        whatYouNeed: '面试准备',
        needWebcam: '确保摄像头正常工作',
        needMicrophone: '确保麦克风正常工作',
        needQuiet: '选择安静的面试环境',
        needBrowser: '使用 Chrome 或 Edge 浏览器',
        goodLuck: '祝面试顺利！',
        regards: '此致',
        hiringTeam: '招聘团队',
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
        tagline: 'HIRE LIKE A FOUNDER',
        whatYouNeed: 'What You Need',
        needWebcam: 'A working webcam',
        needMicrophone: 'A working microphone',
        needQuiet: 'A quiet environment',
        needBrowser: 'Chrome or Edge browser',
        goodLuck: 'Good luck with your interview!',
        regards: 'Best regards,',
        hiringTeam: 'The Hiring Team',
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
        tagline: 'CONTRATA COMO UN FUNDADOR',
        whatYouNeed: 'Lo que necesitas',
        needWebcam: 'Una cámara web funcionando',
        needMicrophone: 'Un micrófono funcionando',
        needQuiet: 'Un ambiente tranquilo',
        needBrowser: 'Navegador Chrome o Edge',
        goodLuck: '¡Buena suerte con tu entrevista!',
        regards: 'Saludos cordiales,',
        hiringTeam: 'El Equipo de Contratación',
      },
      fr: {
        validUntil: "Valable jusqu'au",
        scheduledTime: 'Heure prévue',
        availableSlots: 'Créneaux disponibles',
        enterRoom: "Entrer dans la Salle d'Entretien",
        confirm: "Confirmer l'entretien",
        selectTime: 'Choisir un créneau',
        slotOption: (index: number) => `Option ${index}`,
        timeWindow: "Merci de rejoindre dans les 15 minutes avant ou après l'heure prévue",
        tagline: 'RECRUTEZ COMME UN FONDATEUR',
        whatYouNeed: 'Ce dont vous avez besoin',
        needWebcam: 'Une webcam fonctionnelle',
        needMicrophone: 'Un microphone fonctionnel',
        needQuiet: 'Un environnement calme',
        needBrowser: 'Navigateur Chrome ou Edge',
        goodLuck: 'Bonne chance pour votre entretien !',
        regards: 'Cordialement,',
        hiringTeam: "L'équipe de recrutement",
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
    const contactEmail = (copilotInterview as { interviewer_email?: string | null }).interviewer_email || 'hr@company.com'

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
        <!-- Header with Brand -->
        <div style="background: linear-gradient(135deg, #1E2E57 0%, #0A0E27 100%); padding: 40px 30px; text-align: center;">
          <div style="margin-bottom: 12px;">
            <span style="font-size: 36px; font-weight: 700; color: #00F0FF; text-shadow: 0 0 20px rgba(0, 240, 255, 0.3);">
              Foundire
            </span>
          </div>
          <p style="color: #00F0FF; font-size: 13px; letter-spacing: 2px; margin: 0; font-weight: 600; opacity: 0.9;">
            ${labels[locale].tagline}
          </p>
        </div>

        <!-- Main Content -->
        <div style="padding: 40px 30px;">
          <h1 style="color: #1E2E57; font-size: 24px; font-weight: 700; margin: 0 0 25px 0;">
            ${company.name}
          </h1>

          <p style="color: #4b5563; font-size: 16px; margin-bottom: 10px;">${greetings[locale]}</p>

          <p style="color: #1f2937; font-size: 16px; line-height: 1.7; margin-bottom: 25px;">
            ${intro}
          </p>

          ${
            formattedScheduledTime
              ? `
          <div style="background-color: #f0fdff; border-left: 4px solid #00F0FF; padding: 20px; margin-bottom: 25px;">
            <p style="margin: 0; color: #1E2E57; font-weight: 600;">
              ${labels[locale].scheduledTime}:
            </p>
            <p style="margin: 8px 0 0 0; color: #1f2937; font-size: 18px;">
              ${formattedScheduledTime}
            </p>
          </div>
          `
              : ''
          }

          ${
            timeSlotsHtml
              ? `
          <div style="margin-bottom: 25px;">
            <p style="margin: 0 0 15px 0; font-weight: 600; color: #1E2E57;">${labels[locale].availableSlots}:</p>
            ${timeSlotsHtml}
          </div>
          `
              : ''
          }

          <p style="color: #4b5563; font-size: 16px; margin-bottom: 25px;">
            <strong>${labels[locale].validUntil}:</strong> ${formattedExpiry}
          </p>

          ${schedulingMode === 'instant' ? '' : `<p style="color: #6b7280; font-size: 14px; margin-bottom: 25px;">${labels[locale].timeWindow}</p>`}

          <!-- CTA Button -->
          <div style="margin: 35px 0; text-align: center;">
            <a href="${actionUrl}"
               style="background: linear-gradient(135deg, #1E2E57 0%, #0A0E27 100%); color: #00F0FF; padding: 16px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px; border: 2px solid #00F0FF;">
              ${actionLabel}
            </a>
          </div>

          <!-- Interview Link -->
          <div style="background-color: #f0fdff; border-left: 4px solid #00F0FF; padding: 20px; margin-bottom: 25px;">
            <p style="margin: 0 0 10px 0; color: #1E2E57; font-weight: 600;">
              ${schedulingMode === 'instant' ? labels[locale].enterRoom : labels[locale].confirm}:
            </p>
            <p style="margin: 0; word-break: break-all;">
              <a href="${actionUrl}" style="color: #2563eb;">${actionUrl}</a>
            </p>
          </div>

          <!-- What You Need -->
          <div style="background-color: #f9fafb; padding: 20px; border-radius: 8px; margin: 25px 0;">
            <h3 style="margin: 0 0 15px 0; color: #1E2E57; font-size: 16px; font-weight: 600;">${labels[locale].whatYouNeed}:</h3>
            <ul style="color: #4b5563; margin: 0; padding-left: 20px; line-height: 1.8;">
              <li>${labels[locale].needWebcam}</li>
              <li>${labels[locale].needMicrophone}</li>
              <li>${labels[locale].needQuiet}</li>
              <li>${labels[locale].needBrowser}</li>
            </ul>
          </div>

          <p style="color: #1f2937; font-size: 16px; margin-top: 25px;">${labels[locale].goodLuck}</p>

          <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
            ${labels[locale].regards}<br/>
            ${labels[locale].hiringTeam}
          </p>

          <p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">
            Contact: <a href="mailto:${contactEmail}" style="color: #2563eb;">${contactEmail}</a>
          </p>
        </div>

        <!-- Footer -->
        <div style="background-color: #f9fafb; padding: 20px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
          <p style="color: #6b7280; font-size: 12px; margin: 0;">
            © ${new Date().getFullYear()} Foundire. All rights reserved.
          </p>
        </div>
      </div>
    `

    const timeInfoText = formattedScheduledTime ? `${labels[locale].scheduledTime}: ${formattedScheduledTime}` : ''
    const slotsInfoText = timeSlotsText ? `${labels[locale].availableSlots}:\n${timeSlotsText}` : ''
    const timeWindowText = schedulingMode === 'instant' ? '' : labels[locale].timeWindow

    const text = `
================================
Foundire - ${labels[locale].tagline}
================================

${company.name}

${greetings[locale]}

${introText}

${timeInfoText}
${slotsInfoText}
${labels[locale].validUntil}: ${formattedExpiry}
${timeWindowText}

${actionLabel}: ${actionUrl}

${labels[locale].whatYouNeed}:
- ${labels[locale].needWebcam}
- ${labels[locale].needMicrophone}
- ${labels[locale].needQuiet}
- ${labels[locale].needBrowser}

${labels[locale].goodLuck}

${labels[locale].regards}
${labels[locale].hiringTeam}

Contact: ${contactEmail}

© ${new Date().getFullYear()} Foundire. All rights reserved.
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
