import { openai } from './core'
import { COMMON_I18N, normalizeLocale } from './i18n'
import { INTERVIEW_ANALYSIS_I18N } from './prompts'
import { isConversationalTranscript, type AIAnalysis, type InterviewTranscriptData, type QATranscriptEntry } from '../types'

export async function analyzeInterview(
  jobDescription: string,
  jobRequirements: string,
  transcript: InterviewTranscriptData,
  locale: string = 'en'
): Promise<AIAnalysis & { score: number }> {
  const normalizedLocale = normalizeLocale(locale)
  const i18n = INTERVIEW_ANALYSIS_I18N[normalizedLocale]
  const common = COMMON_I18N[normalizedLocale]

  let formattedTranscript: string
  let totalQuestions: number
  let answeredQuestions: number
  let completionRate: number
  let isConversational: boolean

  if (isConversationalTranscript(transcript)) {
    isConversational = true
    const candidateMessages = transcript.filter((t) => t.speaker === 'candidate')
    const interviewerMessages = transcript.filter(
      (t) => t.speaker === 'ai' || t.speaker === 'interviewer' || t.speaker.startsWith('interviewer_')
    )

    const conversationTurns = Math.min(candidateMessages.length, interviewerMessages.length)
    totalQuestions = conversationTurns
    answeredQuestions = candidateMessages.filter((t) => t.text.trim().length > 10).length
    completionRate = -1

    formattedTranscript = transcript
      .map((entry) => {
        let speaker: string
        if (entry.speaker === 'candidate') {
          speaker = common.candidate
        } else if (entry.speaker === 'interviewer' || entry.speaker.startsWith('interviewer_')) {
          speaker = common.interviewer
        } else {
          speaker = common.aiInterviewer
        }
        const topicInfo = entry.topicTag ? ` [${common.topic}: ${entry.topicTag}]` : ''
        return `${speaker}${topicInfo}: ${entry.text}`
      })
      .join('\n\n')
  } else {
    isConversational = false
    const qaTranscript = transcript as QATranscriptEntry[]
    totalQuestions = qaTranscript.length
    answeredQuestions = qaTranscript.filter((t) => t.answer && t.answer.trim().length > 10).length
    completionRate = totalQuestions > 0 ? answeredQuestions / totalQuestions : 0

    formattedTranscript = qaTranscript
      .map(
        (t, idx) =>
          `${common.question}${idx + 1}: ${t.question}\n${common.answer}${idx + 1}: ${t.answer || i18n.labels.notAnswered}`
      )
      .join('\n\n')
  }

  const isHumanInterviewer =
    isConversational &&
    isConversationalTranscript(transcript) &&
    transcript.some((t) => t.speaker === 'interviewer' || t.speaker.startsWith('interviewer_'))
  const interviewTypeLabel = isHumanInterviewer ? i18n.interviewTypes.humanAssisted : i18n.interviewTypes.digitalHuman

  const typeExplanation = isHumanInterviewer ? i18n.interviewTypeExplanation.humanAssisted : i18n.interviewTypeExplanation.digitalHuman
  const guidelines = completionRate === -1 ? i18n.conversationalGuidelines : i18n.qaGuidelines

  const transcriptHeader =
    completionRate === -1
      ? `${i18n.labels.interviewTranscript} (${totalQuestions} ${i18n.labels.conversationTurns}, ${i18n.labels.candidateResponded} ${answeredQuestions} times):`
      : `${i18n.labels.interviewTranscript} (${totalQuestions} ${i18n.labels.questionsTotal}, ${answeredQuestions} ${i18n.labels.validAnswers}):`

  const completionRateSection =
    completionRate === -1 ? '' : `\n${i18n.labels.completionRate}: ${(completionRate * 100).toFixed(1)}%`

  const prompt = `You are an expert recruiter analyzing a ${interviewTypeLabel}. Based on the job requirements and the interview ${completionRate === -1 ? 'conversation' : 'transcript'}, provide a comprehensive and objective analysis.

${completionRate === -1 ? typeExplanation : ''}

${i18n.speechRecognitionNote}

${guidelines}

${i18n.labels.jobDescription}:
${jobDescription}

${i18n.labels.requirements}:
${jobRequirements}

${transcriptHeader}
${formattedTranscript}
${completionRateSection}

${i18n.jsonInstruction}`

  const response = await openai.responses.create({
    model: 'gpt-5.2',
    instructions: i18n.systemMessage,
    input: prompt + '\n\nPlease respond in JSON format.',
    text: { format: { type: 'json_object' } },
  })

  return JSON.parse(response.output_text || '{}') as AIAnalysis & { score: number }
}

