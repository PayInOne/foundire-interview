import nodemailer from 'nodemailer'

let cachedTransporter: nodemailer.Transporter | null = null

export function resetTransporter(): void {
  if (cachedTransporter) {
    cachedTransporter.close()
    cachedTransporter = null
  }
}

export function getTransporter(): nodemailer.Transporter {
  if (cachedTransporter) return cachedTransporter

  const host = process.env.SMTP_ADDRESS
  const port = parseInt(process.env.SMTP_PORT || '465', 10)
  const secure = process.env.SMTP_SSL === 'true'
  const user = process.env.SMTP_USERNAME
  const pass = process.env.SMTP_PASSWORD

  if (!host || !user || !pass) {
    throw new Error('SMTP is not configured. Please set SMTP_ADDRESS, SMTP_USERNAME, SMTP_PASSWORD (and optionally SMTP_PORT, SMTP_SSL).')
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 60000,
  })

  return cachedTransporter
}

export function getMailerSenderEmail(): string {
  const sender = process.env.MAILER_SENDER_EMAIL
  if (!sender) {
    throw new Error('MAILER_SENDER_EMAIL is not configured.')
  }
  return sender
}

