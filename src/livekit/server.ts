import { EgressClient, EncodedFileOutput, EncodedFileType, RoomServiceClient, S3Upload } from 'livekit-server-sdk'

interface LiveKitConfig {
  apiUrl: string
  apiKey: string
  apiSecret: string
}

function getLiveKitConfig(): LiveKitConfig {
  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET
  const apiUrl = process.env.LIVEKIT_API_URL

  if (!apiKey || !apiSecret || !apiUrl) {
    throw new Error('LiveKit configuration is incomplete. Please set LIVEKIT_API_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.')
  }

  return { apiKey, apiSecret, apiUrl }
}

let roomServiceClient: RoomServiceClient | null = null
let egressClient: EgressClient | null = null

export function getLiveKitRoomServiceClient(): RoomServiceClient {
  if (!roomServiceClient) {
    const { apiUrl, apiKey, apiSecret } = getLiveKitConfig()
    roomServiceClient = new RoomServiceClient(apiUrl, apiKey, apiSecret)
  }
  return roomServiceClient
}

export function getLiveKitEgressClient(): EgressClient {
  if (!egressClient) {
    const { apiUrl, apiKey, apiSecret } = getLiveKitConfig()
    egressClient = new EgressClient(apiUrl, apiKey, apiSecret)
  }
  return egressClient
}

export function getLiveKitRoomName(interviewId: string) {
  return `interview-${interviewId}`
}

export function getLiveKitRecordingKey(interviewId: string) {
  return `interviews/${interviewId}/recording.mp4`
}

export function buildLiveKitS3Output(interviewId: string) {
  const bucket = process.env.R2_BUCKET_NAME
  const accessKey = process.env.R2_ACCESS_KEY_ID
  const secret = process.env.R2_SECRET_ACCESS_KEY
  const accountId = process.env.R2_ACCOUNT_ID

  if (!bucket || !accessKey || !secret || !accountId) {
    throw new Error('R2 configuration is incomplete. Please set R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_ACCOUNT_ID.')
  }

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`
  const filepath = getLiveKitRecordingKey(interviewId)

  const s3Upload = new S3Upload({
    accessKey,
    secret,
    bucket,
    region: 'auto',
    endpoint,
    forcePathStyle: true,
  })

  return new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath,
    output: {
      case: 's3',
      value: s3Upload,
    },
  })
}

export async function deleteRoom(roomName: string): Promise<boolean> {
  try {
    const client = getLiveKitRoomServiceClient()
    const rooms = await client.listRooms([roomName])
    if (rooms.length === 0) return false

    await client.deleteRoom(roomName)
    return true
  } catch (error) {
    console.error(`❌ Failed to delete room ${roomName}:`, error)
    return false
  }
}

