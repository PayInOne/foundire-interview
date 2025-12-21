import type { LiveKitRegion } from './geo-routing'
import { getFallbackRegion, getRoomServiceClientForRegion } from './geo-routing'

export async function deleteRoomForRegion(roomName: string, region: LiveKitRegion | null): Promise<boolean> {
  const regionsToTry: LiveKitRegion[] = region ? [region, getFallbackRegion(region)] : ['self-hosted', 'cloud']

  let lastError: unknown = null

  for (const candidateRegion of regionsToTry) {
    let client
    try {
      client = getRoomServiceClientForRegion(candidateRegion)
    } catch (error) {
      lastError = error
      continue
    }

    let rooms
    try {
      rooms = await client.listRooms([roomName])
    } catch (error) {
      lastError = error
      if (region) {
        console.error(`❌ Failed to list room ${roomName} in region ${candidateRegion}:`, error)
        return false
      }
      continue
    }

    if (rooms.length === 0) continue

    try {
      await client.deleteRoom(roomName)
      return true
    } catch (error) {
      console.error(`❌ Failed to delete room ${roomName} in region ${candidateRegion}:`, error)
      return false
    }
  }

  if (lastError) {
    console.error(`❌ Failed to delete room ${roomName}:`, lastError)
  }

  return false
}

export async function removeParticipantIfExistsForRegion(
  roomName: string,
  identity: string,
  region: LiveKitRegion | null
): Promise<boolean> {
  const regionsToTry: LiveKitRegion[] = region ? [region, getFallbackRegion(region)] : ['self-hosted', 'cloud']

  let lastError: unknown = null

  for (const candidateRegion of regionsToTry) {
    let client
    try {
      client = getRoomServiceClientForRegion(candidateRegion)
    } catch (error) {
      lastError = error
      continue
    }

    let rooms
    try {
      rooms = await client.listRooms([roomName])
    } catch (error) {
      lastError = error
      if (region) {
        console.warn(`⚠️ Failed to list room ${roomName} in region ${candidateRegion}:`, error)
        return false
      }
      continue
    }

    if (rooms.length === 0) continue

    try {
      const participants = await client.listParticipants(roomName)
      const existingParticipant = participants.find((p) => p.identity === identity)
      if (!existingParticipant) return false

      await client.removeParticipant(roomName, identity)
      return true
    } catch (error) {
      console.warn(`⚠️ Failed to remove participant ${identity} in region ${candidateRegion}:`, error)
      return false
    }
  }

  if (lastError) {
    console.warn(`⚠️ Failed to remove participant ${identity}:`, lastError)
  }

  return false
}
