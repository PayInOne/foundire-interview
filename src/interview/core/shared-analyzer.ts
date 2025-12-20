import type { InterviewContext, AnalysisResult } from './types'
import { buildAnalysisPrompt } from './prompt-builder'
import { openai } from '../../openai/core'

interface RawAnalysisResponse {
  quality?: { score?: number; shouldIncreaseDifficulty?: boolean }
  skillsCoverage?: { discussedSkills?: string[]; missingSkills?: string[]; coveragePercentage?: number }
  suggestedActions?: {
    followUpQuestions?: string[]
    nextTopic?: string
  }
}

export class ConversationAnalyzer {
  async analyze(context: InterviewContext): Promise<AnalysisResult> {
    if (!context.conversation.history || context.conversation.history.length === 0) {
      return this.getDefaultResult(context.job.requiredSkills || [])
    }

    const prompt = buildAnalysisPrompt(context)

    const response = await openai.responses.create({
      model: 'gpt-5.2',
      instructions: this.buildSystemPrompt(context.conversation.language),
      input: prompt + '\n\nPlease respond in JSON format.',
      text: {
        format: { type: 'json_object' },
      },
    })

    const content = response.output_text
    if (!content) {
      throw new Error('No response from GPT')
    }

    return this.parseAnalysisResult(JSON.parse(content))
  }

  private getDefaultResult(requiredSkills: string[]): AnalysisResult {
    return {
      quality: {
        score: 5,
        shouldIncreaseDifficulty: false,
      },
      skillsCoverage: {
        discussedSkills: [],
        missingSkills: requiredSkills,
        coveragePercentage: 0,
      },
      suggestedActions: {
        followUpQuestions: [],
        nextTopic: undefined,
      },
    }
  }

  async quickAnalyze(context: InterviewContext, recentMessageCount: number = 5): Promise<AnalysisResult> {
    const recentContext: InterviewContext = {
      ...context,
      conversation: {
        ...context.conversation,
        history: context.conversation.history.slice(-recentMessageCount),
      },
    }

    return this.analyze(recentContext)
  }

  private buildSystemPrompt(language: 'en' | 'zh' | 'es' | 'fr'): string {
    if (language === 'zh') {
      return `你是一个专业的面试分析助手，专门帮助面试官进行有深度的、针对候选人背景的面试。

职责：
1. 评估候选人回答的质量 (1-10分)
2. 分析技能覆盖情况
3. 基于候选人简历背景生成深度追问，验证真实性与深度
4. 判断是否应该切换到新话题
5. 判断是否应该提高问题难度

输出 JSON 格式：
{
  "quality": {
    "score": 1-10,
    "shouldIncreaseDifficulty": true/false
  },
  "skillsCoverage": {
    "discussedSkills": ["技能1"],
    "missingSkills": ["技能2"],
    "coveragePercentage": 50
  },
  "suggestedActions": {
    "followUpQuestions": ["深度追问1", "深度追问2"],
    "nextTopic": "下一个话题或null"
  }
}

注意：
- nextTopic 有值表示建议切换话题，null/不填表示继续当前话题
- followUpQuestions 必须具体且可验证（细节/取舍/指标），避免泛泛问题`
    }

    return `You are a professional interview analysis assistant, specialized in helping interviewers conduct in-depth, candidate-specific interviews.

Responsibilities:
1. Assess candidate's answer quality (1-10 score)
2. Analyze skills coverage
3. Generate deep, verifiable follow-up questions (prefer resume/experience validation)
4. Determine if switching to a new topic is needed
5. Determine if question difficulty should be increased

Output JSON format:
{
  "quality": {
    "score": 1-10,
    "shouldIncreaseDifficulty": true/false
  },
  "skillsCoverage": {
    "discussedSkills": ["Skill 1"],
    "missingSkills": ["Skill 2"],
    "coveragePercentage": 50
  },
  "suggestedActions": {
    "followUpQuestions": ["Deep follow-up 1", "Deep follow-up 2"],
    "nextTopic": "Next topic or null"
  }
}

Note:
- nextTopic with value means topic switch recommended; null/omit means continue current topic
- followUpQuestions must be specific and verifiable (details/tradeoffs/metrics), not generic`
  }

  private parseAnalysisResult(rawInput: unknown): AnalysisResult {
    const raw = rawInput as RawAnalysisResponse

    return {
      quality: {
        score: raw.quality?.score || 5,
        shouldIncreaseDifficulty: raw.quality?.shouldIncreaseDifficulty || false,
      },
      skillsCoverage: {
        discussedSkills: raw.skillsCoverage?.discussedSkills || [],
        missingSkills: raw.skillsCoverage?.missingSkills || [],
        coveragePercentage: raw.skillsCoverage?.coveragePercentage || 0,
      },
      suggestedActions: {
        followUpQuestions: raw.suggestedActions?.followUpQuestions || [],
        nextTopic: raw.suggestedActions?.nextTopic,
      },
    }
  }
}

export const conversationAnalyzer = new ConversationAnalyzer()

