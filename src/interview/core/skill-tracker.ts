export class SkillTracker {
  private coveredSkills: Map<string, SkillEvaluation> = new Map()

  constructor(
    private mode: 'ai_qa' | 'ai_dialogue' | 'assisted_video' | 'assisted_voice',
    private persistCallback?: (skill: string, evaluation: SkillEvaluation) => Promise<void>
  ) {}

  async markSkillEvaluated(skill: string, evaluation: SkillEvaluation): Promise<void> {
    this.coveredSkills.set(skill, evaluation)

    if ((this.mode === 'assisted_video' || this.mode === 'assisted_voice') && this.persistCallback) {
      await this.persistCallback(skill, evaluation)
    }
  }

  getUnevaluatedSkills(requiredSkills: string[]): string[] {
    return requiredSkills.filter((skill) => !this.coveredSkills.has(skill))
  }

  getCoveragePercentage(requiredSkills: string[]): number {
    if (requiredSkills.length === 0) return 100
    const covered = requiredSkills.filter((skill) => this.coveredSkills.has(skill)).length
    return Math.round((covered / requiredSkills.length) * 100)
  }

  detectDiscussedSkills(conversationHistory: Array<{ text: string }>, requiredSkills: string[]): string[] {
    const discussed: string[] = []

    for (const skill of requiredSkills) {
      const mentioned = conversationHistory.some((message) =>
        message.text.toLowerCase().includes(skill.toLowerCase())
      )

      if (mentioned) {
        discussed.push(skill)
      }
    }

    return discussed
  }

  buildContext(requiredSkills: string[]): {
    required: string[]
    evaluated: string[]
    unevaluated: string[]
  } {
    const evaluated = Array.from(this.coveredSkills.keys())
    const unevaluated = this.getUnevaluatedSkills(requiredSkills)

    return {
      required: requiredSkills,
      evaluated,
      unevaluated,
    }
  }

  exportState(): Record<string, SkillEvaluation> {
    return Object.fromEntries(this.coveredSkills)
  }

  restoreState(state: Record<string, SkillEvaluation>): void {
    this.coveredSkills = new Map(Object.entries(state))
  }
}

export interface SkillEvaluation {
  quality: 'shallow' | 'deep'
  timestamp: string
  offsetSeconds?: number
}

