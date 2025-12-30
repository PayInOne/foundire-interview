export interface InterviewContext {
  job: {
    title: string
    description: string
    requirements?: string
    requiredSkills: string[]
  }

  candidate?: {
    name?: string
    resumeText?: string
    experience?: string
  }

  conversation: {
    history: ConversationMessage[]
    currentTopic?: string
    topicsCovered: string[]
    language: 'en' | 'zh' | 'es' | 'fr'
  }

  skills: {
    required: string[]
    evaluated: string[]
    unevaluated: string[]
  }

  timing: {
    remainingMinutes: number
    durationMinutes: number
  }

  context: {
    isScreenSharing: boolean
    interviewMode: 'ai_qa' | 'ai_dialogue' | 'assisted_video' | 'assisted_voice'
  }
}

export interface ConversationMessage {
  speaker: 'ai' | 'candidate' | 'interviewer' | 'interviewer_0' | 'interviewer_1' | 'interviewer_2' | string
  text: string
  timestamp: string
  topicTag?: string
}

export interface AnalysisResult {
  quality: {
    score: number
    shouldIncreaseDifficulty: boolean
  }

  skillsCoverage: {
    discussedSkills: string[]
    missingSkills: string[]
    coveragePercentage: number
  }

  suggestedActions: {
    followUpQuestions: string[]
    followUpQuestionsDetailed?: FollowUpQuestion[]
    nextTopic?: string
  }
}

export interface FollowUpQuestion {
  text: string
  source: 'transcript' | 'resume' | 'job' | 'skills' | 'unknown'
  evidence?: string
  confidence?: number
  intent?: 'follow_up' | 'resume_probe' | 'job_requirement' | 'skill_gap' | 'topic_switch'
}

export interface DigitalHumanOutput {
  aiResponse: string
  action: {
    type: 'continue' | 'switch_topic' | 'end'
    nextTopic?: string
  }
  assessment?: {
    score: number
    shouldIncreaseDifficulty: boolean
  }
}
