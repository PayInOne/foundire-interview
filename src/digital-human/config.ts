export type DigitalHumanProviderType = 'did' | 'heygen'

export type DigitalHumanConfigResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 500; body: Record<string, unknown> }

function getProviderType(): DigitalHumanProviderType {
  const provider = process.env.DIGITAL_HUMAN_PROVIDER?.toLowerCase()
  if (provider === 'heygen') return 'heygen'
  return 'did'
}

const FEMALE_TTS_VOICE_MAP: Record<string, string> = {
  zh: 'zh-CN-XiaoxiaoNeural',
  'zh-CN': 'zh-CN-XiaoxiaoNeural',
  'zh-TW': 'zh-TW-HsiaoChenNeural',
  en: 'en-US-JennyNeural',
  'en-US': 'en-US-JennyNeural',
  es: 'es-ES-ElviraNeural',
  'es-ES': 'es-ES-ElviraNeural',
  fr: 'fr-FR-DeniseNeural',
  'fr-FR': 'fr-FR-DeniseNeural',
}

const MALE_TTS_VOICE_MAP: Record<string, string> = {
  zh: 'zh-CN-YunxiNeural',
  'zh-CN': 'zh-CN-YunxiNeural',
  'zh-TW': 'zh-TW-YunJheNeural',
  en: 'en-US-GuyNeural',
  'en-US': 'en-US-GuyNeural',
  es: 'es-ES-AlvaroNeural',
  'es-ES': 'es-ES-AlvaroNeural',
  fr: 'fr-FR-HenriNeural',
  'fr-FR': 'fr-FR-HenriNeural',
}

function resolveInterviewerTtsVoice(language?: string): string | undefined {
  const override = process.env.AI_INTERVIEWER_TTS_VOICE?.trim()
  if (override) return override

  const normalized = language?.toLowerCase() || ''
  const genderOverride = process.env.AI_INTERVIEWER_GENDER?.toLowerCase()
  const isZh = normalized.startsWith('zh')

  const voiceMap =
    genderOverride === 'male'
      ? MALE_TTS_VOICE_MAP
      : genderOverride === 'female'
        ? FEMALE_TTS_VOICE_MAP
        : isZh
          ? FEMALE_TTS_VOICE_MAP
          : MALE_TTS_VOICE_MAP

  const key = language || (isZh ? 'zh' : 'en')
  return voiceMap[key] || voiceMap.en
}

function buildDidConfig(): { provider: 'did'; config: Record<string, unknown> } | null {
  const agentId = process.env.DID_AGENT_ID
  const clientKey = process.env.DID_CLIENT_KEY

  if (!agentId || !clientKey) return null

  return {
    provider: 'did' as const,
    config: {
      agentId,
      clientKey,
    },
  }
}

function buildHeygenConfig(params: {
  language?: string
  interviewId?: string
  candidateName?: string
  interviewMode?: string
}): { provider: 'heygen'; config: Record<string, unknown> } | null {
  if (!process.env.HEYGEN_API_KEY) return null

  const language = params.language
  const interviewId = params.interviewId
  const candidateName = params.candidateName
  const interviewMode = params.interviewMode

  let avatarId = process.env.HEYGEN_AVATAR_ID
  const ttsVoice = resolveInterviewerTtsVoice(language)

  if (!avatarId && language) {
    if (language.toLowerCase().startsWith('zh')) {
      avatarId = '65f9e3c9-d48b-4118-b73a-4ae2e3cbb8f0'
    } else {
      avatarId = '9650a758-1085-4d49-8bf3-f347565ec229'
    }
  }

  return {
    provider: 'heygen' as const,
    config: {
      mode: 'custom',
      interviewId,
      avatarId,
      language,
      candidateName,
      interviewMode,
      ...(ttsVoice ? { voice: ttsVoice } : {}),
    },
  }
}

function buildOpenAIRealtimeConfig(mode: 'static' | 'text'): Record<string, unknown> | null {
  if (!process.env.OPENAI_API_KEY) return null

  return {
    provider: mode === 'static' ? 'fallback-static' : 'fallback-text',
    config: {
      model: 'gpt-realtime',
      voice: 'alloy',
      instructions: 'You are a professional AI interviewer. Ask relevant questions and provide thoughtful responses.',
      mode,
      tokenEndpoint: '/api/openai/realtime/client-secret',
    },
    isFallback: true,
  }
}

export async function handleDigitalHumanConfig(params: {
  language?: string
  interviewId?: string
  candidateName?: string
  interviewMode?: string
}): Promise<DigitalHumanConfigResponse> {
  try {
    const providerType = getProviderType()

    const primary =
      providerType === 'heygen' ? buildHeygenConfig(params) : buildDidConfig()

    if (primary) {
      return { status: 200, body: primary }
    }

    const fallbackStatic = buildOpenAIRealtimeConfig('static')
    if (fallbackStatic) {
      return { status: 200, body: fallbackStatic }
    }

    const fallbackText = buildOpenAIRealtimeConfig('text')
    if (fallbackText) {
      return { status: 200, body: fallbackText }
    }

    return {
      status: 500,
      body: { error: 'Digital human provider not configured' },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get digital human config'
    return { status: 500, body: { error: message } }
  }
}
