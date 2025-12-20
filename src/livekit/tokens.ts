import { AccessToken } from 'livekit-server-sdk'

function getDefaultApiKey(): string {
  const apiKey = process.env.LIVEKIT_API_KEY
  if (!apiKey) {
    throw new Error('LIVEKIT_API_KEY is not configured.')
  }
  return apiKey
}

function getDefaultApiSecret(): string {
  const apiSecret = process.env.LIVEKIT_API_SECRET
  if (!apiSecret) {
    throw new Error('LIVEKIT_API_SECRET is not configured.')
  }
  return apiSecret
}

export interface LiveKitAccessTokenParams {
  roomName: string
  identity: string
  name?: string
  ttlSeconds?: number
  metadata?: string
  canPublishData?: boolean
  config?: {
    apiKey: string
    apiSecret: string
  }
}

export async function createLiveKitAccessToken({
  roomName,
  identity,
  name,
  ttlSeconds = 60 * 60 * 4,
  metadata,
  canPublishData = true,
  config,
}: LiveKitAccessTokenParams): Promise<string> {
  const apiKey = config?.apiKey ?? getDefaultApiKey()
  const apiSecret = config?.apiSecret ?? getDefaultApiSecret()

  const accessToken = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl: ttlSeconds,
    metadata,
  })

  accessToken.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canPublishData,
    canSubscribe: true,
  })

  return await accessToken.toJwt()
}

