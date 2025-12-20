import { openai } from './core'
import { COMMON_I18N, normalizeLocale } from './i18n'
import { INTERVIEW_QUESTIONS_I18N } from './question-prompts'

export async function generateInterviewQuestions(params: {
  jobTitle: string
  jobDescription: string
  requirements?: string[] | string | null
  resumeText?: string
  numberOfQuestions?: number
  language?: string
  presetQuestions?: string[]
  companyName?: string
  companyDescription?: string | null
}): Promise<{ questions: string[]; hasPresetQuestions: boolean }> {
  const {
    jobTitle,
    jobDescription,
    requirements = [],
    resumeText = '',
    numberOfQuestions = 10,
    language = 'en',
    presetQuestions = [],
    companyName,
    companyDescription = null,
  } = params

  const locale = normalizeLocale(language)
  const i18n = INTERVIEW_QUESTIONS_I18N[locale]
  const common = COMMON_I18N[locale]

  const trimmedCompanyDescription = companyDescription?.trim()
  const companySection = `${common.companyBackground}:
${common.companyName}: ${companyName || common.notProvided}
${common.companyOverview}: ${trimmedCompanyDescription && trimmedCompanyDescription.length > 0 ? trimmedCompanyDescription : common.notProvided}`

  let requirementsText = common.notSpecified
  if (requirements) {
    if (Array.isArray(requirements)) {
      requirementsText = requirements.length > 0 ? requirements.join('\n') : common.notSpecified
    } else if (typeof requirements === 'string') {
      requirementsText = requirements.trim() || common.notSpecified
    }
  }

  const systemMessage = resumeText ? i18n.systemWithResume : i18n.systemWithoutResume

  const hasResume = !!resumeText
  const hasPresets = presetQuestions.length > 0
  const intro = hasResume
    ? i18n.userPromptIntroWithResume(jobTitle, numberOfQuestions)
    : i18n.userPromptIntroWithoutResume(jobTitle, numberOfQuestions)

  let presetSection = ''
  if (hasPresets) {
    const presetList = presetQuestions.map((question, i) => `${i + 1}. ${question}`).join('\n')
    if (hasResume) {
      presetSection = `\n${i18n.presetQuestionsNote(presetQuestions.length)}\n${presetList}\n\n${i18n.presetQuestionsInstruction(numberOfQuestions, numberOfQuestions + presetQuestions.length)}`
    } else {
      presetSection = `\n${i18n.avoidDuplicateNote}\n${presetList}\n\nPlease ensure your generated questions are clearly different from the above preset questions.`
    }
  } else {
    presetSection = `\n${i18n.generateCountNote(numberOfQuestions)}`
  }

  const guidelines = hasResume ? i18n.questionGuidelinesWithResume : i18n.questionGuidelinesWithoutResume
  const languageInstruction = `All questions MUST be in ${i18n.languageName}. This is very important - do not use any other language.`

  const userPrompt = `${intro}

${companySection}

${i18n.labels.jobDescription}:
${jobDescription || common.notProvided}

${i18n.labels.jobRequirements}:
${requirementsText}
${hasResume ? `\n${i18n.labels.candidateResume}:\n${resumeText}` : ''}
${presetSection}

${guidelines}

${i18n.jsonInstruction} ${languageInstruction}`

  const response = await openai.responses.create({
    model: 'gpt-5.2',
    instructions: systemMessage,
    input: userPrompt + '\n\nPlease respond in JSON format.',
    text: {
      format: { type: 'json_object' },
    },
  })

  const result = JSON.parse(response.output_text || '{}') as { questions?: unknown }
  const questions = Array.isArray(result.questions)
    ? result.questions.filter((q): q is string => typeof q === 'string').map((q) => q.trim()).filter(Boolean)
    : []

  return {
    questions,
    hasPresetQuestions: presetQuestions.length > 0,
  }
}

