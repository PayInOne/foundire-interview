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
      instructions: this.buildSystemPrompt(context.conversation.language, context.context.interviewMode),
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

  private buildSystemPrompt(
    language: 'en' | 'zh' | 'es' | 'fr',
    mode: InterviewContext['context']['interviewMode']
  ): string {
    if (language === 'zh') {
      if (mode === 'assisted_video' || mode === 'assisted_voice') {
        return `你是一个专业的面试分析助手，实时辅助真人面试官生成“可以直接问出口”的追问与话题建议。

重要背景：
- 对话来自语音识别转写，可能有断句/口头禅/不完整句。信息不足时，先给“澄清式”问题，不要轻易打低分。

职责：
1. 评估候选人回答质量 (1-10分，避免因信息不足过度扣分)
2. 分析技能覆盖情况（结合已评估/未评估清单）
3. 生成 1-3 个追问（必须可口语提问、简短、面试官常用问法）
4. 判断是否建议切换话题（只有在当前话题难以深入或时间不足时才切）
5. 判断是否应该适度提高问题难度

追问要求：
- 直接、口语化：面试官可以照读（每个问题尽量 ≤ 25 个汉字）
- 贴近刚才的回答/简历细节：优先问“你刚提到的X，能展开具体怎么做/为什么这么选/怎么验证结果？”
- 避免审计式连环追问/过度刁钻；优先 1 个关键问题 + 1 个备选
- 避免泛泛而谈；尽量带约束（指标/取舍/边界/失败案例）

输出 JSON 格式：
{
  "quality": { "score": 1-10, "shouldIncreaseDifficulty": true/false },
  "skillsCoverage": { "discussedSkills": ["技能1"], "missingSkills": ["技能2"], "coveragePercentage": 50 },
  "suggestedActions": { "followUpQuestions": ["追问1", "追问2"], "nextTopic": "下一个话题或null" }
}

注意：
- nextTopic 有值表示建议切换话题，null/不填表示继续当前话题
- followUpQuestions 必须具体、可验证、且可直接问出口`
      }

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

    if (mode === 'assisted_video' || mode === 'assisted_voice') {
      return `You are a professional interview analysis assistant that helps a human interviewer in real time.

Important context:
- This transcript comes from speech recognition and may contain fragmented sentences or filler words. If info is insufficient, suggest a clarifying question instead of over-penalizing.

Responsibilities:
1. Assess answer quality (1-10) with calibrated scoring
2. Analyze skills coverage based on required/evaluated/missing lists
3. Generate 1-3 follow-up questions that the interviewer can ask verbatim (short, natural)
4. Recommend topic switch only when needed
5. Decide whether to slightly increase difficulty

Follow-up question requirements:
- Natural and askable out loud (ideally <= 1 sentence each)
- Anchor to the candidate's last answer or resume details
- Avoid overly adversarial/audit-style interrogation
- Prefer concrete details (how/why/tradeoffs/metrics/failure cases)

Output JSON format:
{
  "quality": { "score": 1-10, "shouldIncreaseDifficulty": true/false },
  "skillsCoverage": { "discussedSkills": ["Skill 1"], "missingSkills": ["Skill 2"], "coveragePercentage": 50 },
  "suggestedActions": { "followUpQuestions": ["Question 1"], "nextTopic": "Next topic or null" }
}

Note:
- nextTopic with value means topic switch recommended; null/omit means continue current topic`
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
