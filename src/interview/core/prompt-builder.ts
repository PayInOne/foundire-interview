import type { InterviewContext, AnalysisResult } from './types'

function isInterviewerSpeaker(speaker: string): boolean {
  return speaker === 'ai' || speaker === 'interviewer' || speaker.startsWith('interviewer_')
}

function truncate(text: string | undefined, maxLength: number): string {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...[truncated]'
}

export function buildAnalysisPrompt(context: InterviewContext): string {
  const { job, conversation, skills, timing, candidate } = context
  const { language } = conversation

  const resume = candidate?.resumeText ? truncate(candidate.resumeText, 2000) : ''

  const historyText = conversation.history
    .map((message) => `${isInterviewerSpeaker(message.speaker) ? 'Interviewer' : 'Candidate'}: ${message.text}`)
    .join('\n')

  const common = `Job: ${job.title}
Description: ${job.description}
${job.requirements ? `Requirements: ${job.requirements}` : ''}

Required skills: ${skills.required.join(', ')}
Evaluated: ${skills.evaluated.length > 0 ? skills.evaluated.join(', ') : '(none)'}
Missing: ${skills.unevaluated.length > 0 ? skills.unevaluated.join(', ') : '(all covered)'}

Current topic: ${conversation.currentTopic || '(opening)'}
Topics covered: ${conversation.topicsCovered.length > 0 ? conversation.topicsCovered.join(', ') : '(none)'}
Time remaining: ${timing.remainingMinutes} minutes
Screen sharing: ${context.context.isScreenSharing ? 'yes' : 'no'}
`

  if (language === 'zh') {
    return `【职位信息】
职位：${job.title}
描述：${job.description}
${job.requirements ? `要求：${job.requirements}` : ''}

${candidate?.name ? `【候选人】\n姓名：${candidate.name}\n` : ''}${resume ? `【简历摘要】\n${resume}\n\n` : ''}【技能要求】
必需技能：${skills.required.join('、')}
已评估：${skills.evaluated.length > 0 ? skills.evaluated.join('、') : '暂无'}
未评估：${skills.unevaluated.length > 0 ? skills.unevaluated.join('、') : '已全部覆盖'}

【当前状态】
当前话题：${conversation.currentTopic || '开场'}
已覆盖话题：${conversation.topicsCovered.length > 0 ? conversation.topicsCovered.join('、') : '暂无'}
剩余时间：${timing.remainingMinutes} 分钟
是否共享屏幕：${context.context.isScreenSharing ? '是' : '否'}

【最近对话】
${historyText}

请输出 JSON：评估回答质量、技能覆盖、建议追问（尽量结合简历/细节验证），以及是否建议切换话题。`
  }

  return `${common}
${candidate?.name ? `Candidate: ${candidate.name}\n` : ''}${resume ? `Resume summary:\n${resume}\n\n` : ''}Recent conversation:
${historyText}

Return JSON: assess answer quality, skills coverage, deep follow-up questions (prefer resume/details verification), and whether to switch topics.`
}

export function buildConversationPrompt(context: InterviewContext, analysisResult: AnalysisResult): string {
  const { job, conversation, timing } = context
  const { language } = conversation

  const difficultyHint = analysisResult.quality.shouldIncreaseDifficulty
    ? 'Increase difficulty slightly.'
    : 'Keep questions approachable and guide the candidate.'

  if (language === 'zh') {
    return `你是一位专业、友好的 AI 面试官，正在为“${job.title}”岗位进行对话式面试。

风格：自然、简洁、像同事交流。
策略：
- 当回答较浅时，追问 1-2 次以获取细节（如何做/为什么/取舍/指标）。
- 每个话题最多追问 3 次；如果连续 2 次无法深入，礼貌切换话题。

当前话题：${conversation.currentTopic}
剩余时间：${timing.remainingMinutes} 分钟
表现：${analysisResult.quality.score}/10
建议：${analysisResult.quality.shouldIncreaseDifficulty ? '适度提高难度' : '保持友好引导'}

只输出你要说的话，不要加任何标记。`
  }

  return `You are a professional, friendly AI interviewer for the "${job.title}" position.

Style: natural, concise, conversational.
Strategy:
- If answers are shallow, ask 1-2 follow-ups to get concrete details (how/why/tradeoffs/metrics).
- Max 3 follow-ups per topic; if 2 attempts fail, politely switch topic.

Current topic: ${conversation.currentTopic}
Time remaining: ${timing.remainingMinutes} minutes
Performance: ${analysisResult.quality.score}/10
Hint: ${difficultyHint}

Output only what you will say. No markup.`
}

