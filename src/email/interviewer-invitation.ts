import { getMailerSenderEmail, getTransporter } from './transporter'

export interface SendInterviewerInvitationParams {
  to: string
  interviewerName: string
  candidateName: string
  jobTitle: string
  invitedBy: string
  interviewerUrl: string
  scheduledAt?: string | null
  locale?: string
}

export async function sendInterviewerInvitationEmail({
  to,
  interviewerName,
  candidateName,
  jobTitle,
  invitedBy,
  interviewerUrl,
  scheduledAt,
  locale = 'en',
}: SendInterviewerInvitationParams) {
  const tbdLabels: Record<string, string> = {
    zh: '待确认',
    en: 'To be confirmed',
    es: 'Por confirmar',
    fr: 'À confirmer',
  }
  const formattedDate = scheduledAt
    ? new Date(scheduledAt).toLocaleString(locale === 'zh' ? 'zh-CN' : locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : (tbdLabels[locale] || tbdLabels.en)

  const content = {
    en: {
      subject: `You're invited to interview ${candidateName} for ${jobTitle}`,
      title: 'Interview Invitation',
      greeting: `Hi ${interviewerName},`,
      inviteText: `${invitedBy} has invited you to join an AI-Assisted Video Interview as a co-interviewer.`,
      candidateLabel: 'Candidate',
      positionLabel: 'Position',
      scheduledLabel: 'Created',
      joinButton: 'Join Interview Room',
      linkLabel: 'Interview Link',
      note: 'Click the button above or copy the link to join the interview. You can join at any time while the interview is active.',
      regards: 'Best regards,',
      team: 'The Foundire Team',
    },
    zh: {
      subject: `您被邀请参加 ${candidateName} 的 ${jobTitle} 面试`,
      title: '面试邀请',
      greeting: `${interviewerName}，您好！`,
      inviteText: `${invitedBy} 邀请您作为面试官加入一场 AI 辅助视频面试。`,
      candidateLabel: '候选人',
      positionLabel: '职位',
      scheduledLabel: '创建时间',
      joinButton: '加入面试房间',
      linkLabel: '面试链接',
      note: '点击上方按钮或复制链接即可加入面试。面试进行期间您可以随时加入。',
      regards: '祝好，',
      team: 'Foundire 团队',
    },
    es: {
      subject: `Has sido invitado a entrevistar a ${candidateName} para ${jobTitle}`,
      title: 'Invitación a Entrevista',
      greeting: `Hola ${interviewerName},`,
      inviteText: `${invitedBy} te ha invitado a unirte a una Entrevista de Video con Asistencia de IA como co-entrevistador.`,
      candidateLabel: 'Candidato',
      positionLabel: 'Puesto',
      scheduledLabel: 'Creado',
      joinButton: 'Unirse a la Sala de Entrevista',
      linkLabel: 'Enlace de Entrevista',
      note: 'Haz clic en el botón de arriba o copia el enlace para unirte a la entrevista. Puedes unirte en cualquier momento mientras la entrevista esté activa.',
      regards: 'Saludos,',
      team: 'El Equipo de Foundire',
    },
    fr: {
      subject: `Vous êtes invité à interviewer ${candidateName} pour ${jobTitle}`,
      title: 'Invitation à un Entretien',
      greeting: `Bonjour ${interviewerName},`,
      inviteText: `${invitedBy} vous a invité à rejoindre un Entretien Vidéo Assisté par IA en tant que co-recruteur.`,
      candidateLabel: 'Candidat',
      positionLabel: 'Poste',
      scheduledLabel: 'Créé',
      joinButton: "Rejoindre la Salle d'Entretien",
      linkLabel: "Lien de l'Entretien",
      note: "Cliquez sur le bouton ci-dessus ou copiez le lien pour rejoindre l'entretien. Vous pouvez rejoindre à tout moment pendant que l'entretien est actif.",
      regards: 'Cordialement,',
      team: "L'Équipe Foundire",
    },
  }

  const t = (content as Record<string, typeof content.en>)[locale] || content.en

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
      <div style="background: linear-gradient(135deg, #1E2E57 0%, #0A0E27 100%); padding: 40px 30px; text-align: center;">
        <div style="margin-bottom: 12px;">
          <span style="font-size: 36px; font-weight: 700; color: #00F0FF; text-shadow: 0 0 20px rgba(0, 240, 255, 0.3);">
            Foundire
          </span>
        </div>
        <p style="color: #00F0FF; font-size: 13px; letter-spacing: 2px; margin: 0; font-weight: 600; opacity: 0.9;">
          AI-ASSISTED VIDEO INTERVIEW
        </p>
      </div>

      <div style="padding: 40px 30px;">
        <h1 style="color: #1E2E57; font-size: 24px; font-weight: 700; margin: 0 0 25px 0;">
          ${t.title}
        </h1>

        <p style="color: #4b5563; font-size: 16px; margin-bottom: 10px;">${t.greeting}</p>

        <p style="color: #1f2937; font-size: 16px; line-height: 1.7; margin-bottom: 25px;">
          ${t.inviteText}
        </p>

        <div style="background-color: #f0fdff; border: 1px solid #00F0FF33; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
          <div style="margin-bottom: 12px;">
            <span style="color: #6b7280; font-size: 14px;">${t.candidateLabel}:</span>
            <span style="color: #1E2E57; font-size: 16px; font-weight: 600; margin-left: 8px;">${candidateName}</span>
          </div>
          <div style="margin-bottom: 12px;">
            <span style="color: #6b7280; font-size: 14px;">${t.positionLabel}:</span>
            <span style="color: #1E2E57; font-size: 16px; font-weight: 600; margin-left: 8px;">${jobTitle}</span>
          </div>
          <div>
            <span style="color: #6b7280; font-size: 14px;">${t.scheduledLabel}:</span>
            <span style="color: #1E2E57; font-size: 16px; font-weight: 600; margin-left: 8px;">${formattedDate}</span>
          </div>
        </div>

        <div style="margin: 35px 0; text-align: center;">
          <a href="${interviewerUrl}"
             style="background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: #ffffff; padding: 16px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px;">
            ${t.joinButton}
          </a>
        </div>

        <div style="background-color: #f9fafb; border-left: 4px solid #10B981; padding: 20px; margin-bottom: 25px;">
          <p style="margin: 0 0 10px 0; color: #1E2E57; font-weight: 600;">
            ${t.linkLabel}:
          </p>
          <p style="margin: 0; word-break: break-all;">
            <a href="${interviewerUrl}" style="color: #2563eb;">${interviewerUrl}</a>
          </p>
        </div>

        <p style="color: #6b7280; font-size: 14px; margin-bottom: 25px;">
          ${t.note}
        </p>

        <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
          ${t.regards}<br/>
          ${t.team}
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

${t.inviteText}

${t.candidateLabel}: ${candidateName}
${t.positionLabel}: ${jobTitle}
${t.scheduledLabel}: ${formattedDate}

${t.linkLabel}: ${interviewerUrl}

${t.note}

${t.regards}
${t.team}
  `

  const info = await getTransporter().sendMail({
    from: `"Foundire" <${getMailerSenderEmail()}>`,
    to,
    subject: t.subject,
    text,
    html,
  })

  return { success: true, messageId: info.messageId }
}
