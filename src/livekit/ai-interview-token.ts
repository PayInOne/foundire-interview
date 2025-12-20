import type { LiveKitConfig } from './geo-routing'
import { createLiveKitAccessToken } from './tokens'

export async function createInterviewerToken(params: {
  roomName: string
  interviewerId: string
  interviewerName: string
  interviewerEmail?: string
  participantIndex?: number
  livekitConfig?: LiveKitConfig
}): Promise<string> {
  const index = params.participantIndex ?? 0

  const metadata = JSON.stringify({
    role: 'interviewer',
    interviewerIndex: index,
    userId: params.interviewerId,
    email: params.interviewerEmail,
  })

  const identity = `interviewer_${index}-${params.interviewerId}`

  return createLiveKitAccessToken({
    roomName: params.roomName,
    identity,
    name: params.interviewerName,
    metadata,
    ttlSeconds: 60 * 60 * 4,
    canPublishData: true,
    config: params.livekitConfig
      ? {
          apiKey: params.livekitConfig.apiKey,
          apiSecret: params.livekitConfig.apiSecret,
        }
      : undefined,
  })
}

export async function createCandidateToken(params: {
  roomName: string
  candidateId: string
  candidateName: string
  candidateEmail?: string
  livekitConfig?: LiveKitConfig
}): Promise<string> {
  const metadata = JSON.stringify({
    role: 'candidate',
    userId: params.candidateId,
    email: params.candidateEmail,
  })

  return createLiveKitAccessToken({
    roomName: params.roomName,
    identity: `candidate-${params.candidateId}`,
    name: params.candidateName,
    metadata,
    ttlSeconds: 60 * 60 * 4,
    canPublishData: false,
    config: params.livekitConfig
      ? {
          apiKey: params.livekitConfig.apiKey,
          apiSecret: params.livekitConfig.apiSecret,
        }
      : undefined,
  })
}

