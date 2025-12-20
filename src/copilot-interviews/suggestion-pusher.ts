import { DataPacket_Kind, RoomServiceClient } from 'livekit-server-sdk'
import type { LiveKitRegion } from '../livekit/geo-routing'
import { getLiveKitConfigForRegion } from '../livekit/geo-routing'
import type { AISuggestion } from '../interview/ai-assisted/suggestion-adapter'

interface SuggestionMessage {
  type: 'ai_suggestion'
  timestamp: number
  suggestions: AISuggestion[]
}

export async function broadcastSuggestionsToInterviewers(params: {
  roomName: string
  suggestions: AISuggestion[]
  region: LiveKitRegion | null
}): Promise<{ success: boolean; error?: string }> {
  try {
    const livekitConfig = getLiveKitConfigForRegion(params.region || 'self-hosted')
    const roomService = new RoomServiceClient(livekitConfig.apiUrl, livekitConfig.apiKey, livekitConfig.apiSecret)

    const participants = await roomService.listParticipants(params.roomName)
    const interviewerIdentities = participants
      .filter((p) => p.identity.startsWith('interviewer_') || p.identity.startsWith('interviewer-'))
      .map((p) => p.identity)

    if (interviewerIdentities.length === 0) {
      return { success: false, error: 'No interviewers in room' }
    }

    const message: SuggestionMessage = {
      type: 'ai_suggestion',
      timestamp: Date.now(),
      suggestions: params.suggestions,
    }

    const encoder = new TextEncoder()
    const data = encoder.encode(JSON.stringify(message))

    await roomService.sendData(params.roomName, data, DataPacket_Kind.RELIABLE, {
      destinationIdentities: interviewerIdentities,
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to broadcast suggestions:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

