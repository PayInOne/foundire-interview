import type { LiveKitRegion } from './geo-routing'
import { getRoomServiceClientForRegion } from './geo-routing'

export async function deleteRoomForRegion(roomName: string, region: LiveKitRegion | null): Promise<boolean> {
  try {
    const client = getRoomServiceClientForRegion(region)
    const rooms = await client.listRooms([roomName])
    if (rooms.length === 0) return false

    await client.deleteRoom(roomName)
    return true
  } catch (error) {
    console.error(`❌ Failed to delete room ${roomName}:`, error)
    return false
  }
}

export async function removeParticipantIfExistsForRegion(
  roomName: string,
  identity: string,
  region: LiveKitRegion | null
): Promise<boolean> {
  try {
    const client = getRoomServiceClientForRegion(region)

    const rooms = await client.listRooms([roomName])
    if (rooms.length === 0) return false

    const participants = await client.listParticipants(roomName)
    const existingParticipant = participants.find((p) => p.identity === identity)
    if (!existingParticipant) return false

    await client.removeParticipant(roomName, identity)
    return true
  } catch (error) {
    console.warn(`⚠️ Failed to remove participant ${identity}:`, error)
    return false
  }
}

