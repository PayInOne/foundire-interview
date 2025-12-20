import { getMailerSenderEmail, getTransporter } from './transporter'
import { getMessages, getUnsubscribeFooter, t } from './messages'

export interface SendInterviewReportParams {
  to: string
  candidateName: string
  candidateEmail: string
  jobTitle: string
  companyName: string
  score: number
  recommendation: string
  overallAssessment: string
  strengths: string[]
  weaknesses: string[]
  locale: string
}

export async function sendInterviewReport({
  to,
  candidateName,
  candidateEmail,
  jobTitle,
  companyName,
  score,
  recommendation,
  overallAssessment,
  strengths,
  weaknesses,
  locale,
}: SendInterviewReportParams) {
  const messages = getMessages(locale)
  const emailT = messages.email.interviewReport

  const subject = t(messages as unknown as Record<string, unknown>, 'email.interviewReport.subject', { candidateName, jobTitle })
  const recommendationLabel = t(messages as unknown as Record<string, unknown>, `email.interviewReport.recommendations.${recommendation}`)

  const getScoreColor = (value: number) => {
    if (value >= 80) return '#22c55e'
    if (value >= 60) return '#3b82f6'
    if (value >= 40) return '#f59e0b'
    return '#ef4444'
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 650px; margin: 0 auto; background-color: #ffffff;">
      <div style="background: linear-gradient(135deg, #1E2E57 0%, #0A0E27 100%); padding: 40px 30px; text-align: center;">
        <div style="margin-bottom: 12px;">
          <span style="font-size: 36px; font-weight: 700; color: #00F0FF; text-shadow: 0 0 20px rgba(0, 240, 255, 0.3);">
            Foundire
          </span>
        </div>
        <p style="color: #00F0FF; font-size: 13px; letter-spacing: 2px; margin: 0; font-weight: 600; opacity: 0.9;">
          HIRE LIKE A FOUNDER
        </p>
      </div>

      <div style="padding: 40px 30px;">
        <h1 style="color: #1E2E57; font-size: 24px; font-weight: 700; margin: 0 0 8px 0;">
          ${emailT.title}
        </h1>
        <p style="color: #00F0FF; font-size: 14px; margin: 0 0 20px 0; font-weight: 500;">
          ${emailT.subtitle}
        </p>
        <p style="color: #1E2E57; font-size: 14px; margin: 0 0 30px 0; font-weight: 600;">
          ${emailT.company}: <span style="font-weight: 700;">${companyName}</span>
        </p>

        <div style="background-color: #f0fdff; border-left: 4px solid #00F0FF; padding: 20px; margin-bottom: 30px; border-radius: 4px;">
          <h2 style="margin: 0 0 15px 0; color: #1E2E57; font-size: 16px; font-weight: 600;">${emailT.candidateInfo}</h2>
          <p style="margin: 6px 0; color: #4b5563;"><strong>${emailT.name}:</strong> ${candidateName}</p>
          <p style="margin: 6px 0; color: #4b5563;"><strong>${emailT.email}:</strong> ${candidateEmail}</p>
          <p style="margin: 6px 0; color: #4b5563;"><strong>${emailT.position}:</strong> ${jobTitle}</p>
        </div>

        <div style="background-color: #f0fdf4; border: 2px solid ${getScoreColor(score)}; border-radius: 12px; padding: 25px; margin-bottom: 30px; text-align: center;">
          <div style="font-size: 56px; font-weight: 700; color: ${getScoreColor(score)}; margin-bottom: 12px;">
            ${score}
          </div>
          <div style="color: #6b7280; font-size: 13px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px;">${emailT.overallScore}</div>
          <div style="display: inline-block; background-color: ${getScoreColor(score)}; color: white; padding: 8px 20px; border-radius: 20px; font-size: 14px; font-weight: 600;">
            ${recommendationLabel}
          </div>
        </div>

        <div style="margin-bottom: 28px;">
          <h3 style="color: #1E2E57; margin-bottom: 12px; font-size: 16px; font-weight: 600;">${emailT.overallAssessment}</h3>
          <p style="color: #4b5563; line-height: 1.7; margin: 0;">${overallAssessment}</p>
        </div>

        ${strengths.length > 0 ? `
        <div style="margin-bottom: 28px;">
          <h3 style="color: #059669; margin-bottom: 12px; font-size: 16px; font-weight: 600;">✓ ${emailT.strengths}</h3>
          <ul style="color: #4b5563; margin: 0; padding-left: 20px; line-height: 1.8;">
            ${strengths.map((s) => `<li style="margin-bottom: 6px;">${s}</li>`).join('')}
          </ul>
        </div>
        ` : ''}

        ${weaknesses.length > 0 ? `
        <div style="margin-bottom: 28px;">
          <h3 style="color: #dc2626; margin-bottom: 12px; font-size: 16px; font-weight: 600;">⚠ ${emailT.weaknesses}</h3>
          <ul style="color: #4b5563; margin: 0; padding-left: 20px; line-height: 1.8;">
            ${weaknesses.map((w) => `<li style="margin-bottom: 6px;">${w}</li>`).join('')}
          </ul>
        </div>
        ` : ''}

        <div style="background: linear-gradient(135deg, #f0fdff 0%, #e0f2fe 100%); border: 2px solid #00F0FF; border-radius: 8px; padding: 20px; margin-top: 35px;">
          <p style="margin: 0; color: #1E2E57; font-size: 14px; line-height: 1.6; font-weight: 500;">
            💡 ${emailT.loginPrompt}
          </p>
        </div>
      </div>

      <div style="background-color: #1E2E57; padding: 25px 30px; text-align: center;">
        <p style="color: #00F0FF; font-size: 12px; margin: 0 0 8px 0; opacity: 0.8;">
          ${emailT.footer}
        </p>
      </div>

      ${getUnsubscribeFooter(messages).html}
    </div>
  `

  const text = `
${emailT.title} - ${jobTitle}

${emailT.company}: ${companyName}

${emailT.candidateInfo}:
${emailT.name}: ${candidateName}
${emailT.email}: ${candidateEmail}
${emailT.position}: ${jobTitle}

${emailT.overallScore}: ${score}/100
${recommendationLabel}

${emailT.overallAssessment}:
${overallAssessment}

${strengths.length > 0 ? `${emailT.strengths}:\n${strengths.map((s) => `• ${s}`).join('\n')}\n` : ''}
${weaknesses.length > 0 ? `${emailT.weaknesses}:\n${weaknesses.map((w) => `• ${w}`).join('\n')}\n` : ''}

${emailT.loginPrompt}

${emailT.footer}
${getUnsubscribeFooter(messages).text}
  `

  const info = await getTransporter().sendMail({
    from: `"Foundire" <${getMailerSenderEmail()}>`,
    to,
    subject,
    text,
    html,
  })

  return { success: true, messageId: info.messageId }
}

