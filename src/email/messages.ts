import { getAppPublicUrl } from '../config'

const EN_MESSAGES = {
  email: {
    interviewReport: {
      subject: 'Interview report: {candidateName} - {jobTitle}',
      title: 'Interview report ready',
      subtitle: 'AI analysis completed',
      company: 'Company',
      candidateInfo: 'Candidate information',
      name: 'Name',
      email: 'Email',
      position: 'Position',
      overallScore: 'Overall score',
      overallAssessment: 'Overall assessment',
      strengths: 'Strengths',
      weaknesses: 'Weaknesses',
      loginPrompt: 'Log in to Foundire to view the full report and details.',
      footer: 'Sent by Foundire',
      recommendations: {
        strong_yes: 'Strong Yes',
        yes: 'Yes',
        maybe: 'Maybe',
        no: 'No',
        strong_no: 'Strong No',
      },
    },
    unsubscribe: {
      reasonInterviewReport: 'You received this email because your notification preference includes interview reports.',
      managePreferences: 'Manage your email preferences in',
      settingsLink: 'Settings',
    },
  },
} as const

const ZH_MESSAGES = {
  email: {
    interviewReport: {
      subject: '面试报告：{candidateName} - {jobTitle}',
      title: '面试报告已生成',
      subtitle: 'AI 分析已完成',
      company: '公司',
      candidateInfo: '候选人信息',
      name: '姓名',
      email: '邮箱',
      position: '职位',
      overallScore: '综合得分',
      overallAssessment: '总体评估',
      strengths: '优势',
      weaknesses: '不足',
      loginPrompt: '登录 Foundire 查看完整报告与详情。',
      footer: '来自 Foundire',
      recommendations: {
        strong_yes: '强烈推荐',
        yes: '推荐',
        maybe: '可考虑',
        no: '不推荐',
        strong_no: '强烈不推荐',
      },
    },
    unsubscribe: {
      reasonInterviewReport: '你收到这封邮件是因为你开启了“面试报告”通知。',
      managePreferences: '你可以在以下位置管理邮件偏好：',
      settingsLink: '设置',
    },
  },
} as const

export type Messages = typeof EN_MESSAGES

export function getMessages(locale: string): Messages {
  if (locale.startsWith('zh')) return ZH_MESSAGES as unknown as Messages
  return EN_MESSAGES
}

export function t(messages: Record<string, unknown>, key: string, params?: Record<string, string | number>): string {
  const keys = key.split('.')
  let value: unknown = messages
  for (const k of keys) {
    if (value && typeof value === 'object') {
      value = (value as Record<string, unknown>)[k]
    }
  }

  if (typeof value === 'string' && params) {
    return Object.entries(params).reduce((str, [k, v]) => str.replace(`{${k}}`, String(v)), value)
  }

  return typeof value === 'string' ? value : key
}

export function getUnsubscribeFooter(messages: Messages): { html: string; text: string } {
  const unsubscribe = messages.email.unsubscribe
  const baseUrl = getAppPublicUrl()
  const settingsUrl = `${baseUrl}/settings`

  const html = `
    <div style="border-top: 1px solid #e5e7eb; padding: 20px 30px; background-color: #f9fafb;">
      <p style="color: #6b7280; font-size: 12px; line-height: 1.6; margin: 0 0 12px 0;">
        ${unsubscribe.reasonInterviewReport}
      </p>
      <p style="color: #6b7280; font-size: 12px; margin: 0;">
        ${unsubscribe.managePreferences}
        <a href="${settingsUrl}" style="color: #00F0FF; text-decoration: underline;">${unsubscribe.settingsLink}</a>
      </p>
    </div>
  `

  const text = `
---
${unsubscribe.reasonInterviewReport}
${unsubscribe.managePreferences} ${settingsUrl}
  `

  return { html, text }
}
