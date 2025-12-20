import { EgressClient, RoomServiceClient } from 'livekit-server-sdk'

export type LiveKitRegion = 'self-hosted' | 'cloud'

export interface LiveKitConfig {
  apiUrl: string
  wsUrl: string
  apiKey: string
  apiSecret: string
  region: LiveKitRegion
}

const NORTH_AMERICA_COUNTRIES = ['US', 'CA', 'MX']

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  key: string
): string | null {
  const value = headers[key.toLowerCase()]
  if (!value) return null
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

export function getCountryFromHeaders(headers: Record<string, string | string[] | undefined>): string | null {
  const cfCountry = readHeader(headers, 'cf-ipcountry')
  if (cfCountry && cfCountry !== 'XX') return cfCountry.toUpperCase()

  const vercelCountry = readHeader(headers, 'x-vercel-ip-country')
  if (vercelCountry) return vercelCountry.toUpperCase()

  const geoCountry = readHeader(headers, 'x-geo-country')
  if (geoCountry) return geoCountry.toUpperCase()

  return null
}

export function getRegionFromCountry(countryCode: string | null): LiveKitRegion {
  if (!countryCode) return 'cloud'
  if (NORTH_AMERICA_COUNTRIES.includes(countryCode)) return 'self-hosted'
  return 'cloud'
}

function getSelfHostedConfig(): LiveKitConfig | null {
  const apiUrl = process.env.LIVEKIT_API_URL
  const wsUrl = process.env.LIVEKIT_WS_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL
  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET

  if (!apiUrl || !wsUrl || !apiKey || !apiSecret) {
    return null
  }

  return { apiUrl, wsUrl, apiKey, apiSecret, region: 'self-hosted' }
}

function getCloudConfig(): LiveKitConfig | null {
  const wsUrl = process.env.LIVEKIT_CLOUD_URL
  const apiKey = process.env.LIVEKIT_CLOUD_API_KEY
  const apiSecret = process.env.LIVEKIT_CLOUD_API_SECRET

  if (!wsUrl || !apiKey || !apiSecret) {
    return null
  }

  const apiUrl = wsUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')

  return { apiUrl, wsUrl, apiKey, apiSecret, region: 'cloud' }
}

export function getLiveKitConfigForRegion(region: LiveKitRegion): LiveKitConfig {
  if (region === 'self-hosted') {
    const config = getSelfHostedConfig()
    if (config) return config
  }

  if (region === 'cloud') {
    const config = getCloudConfig()
    if (config) return config
  }

  const fallback = getSelfHostedConfig() || getCloudConfig()
  if (!fallback) {
    throw new Error('No LiveKit configuration available')
  }

  console.warn(`⚠️ Requested LiveKit region ${region} unavailable, using fallback ${fallback.region}`)
  return fallback
}

export async function healthCheckLiveKit(config: LiveKitConfig): Promise<boolean> {
  const timeout = setTimeout(() => undefined, 5000)
  try {
    const client = new RoomServiceClient(config.apiUrl, config.apiKey, config.apiSecret)
    await client.listRooms([])
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export function getFallbackRegion(region: LiveKitRegion): LiveKitRegion {
  return region === 'cloud' ? 'self-hosted' : 'cloud'
}

export interface RegionSelectionResult {
  config: LiveKitConfig
  actualRegion: LiveKitRegion
  usedFallback: boolean
}

export async function selectRegionWithFallback(preferredRegion: LiveKitRegion): Promise<RegionSelectionResult> {
  const fallbackRegion = getFallbackRegion(preferredRegion)

  const preferredConfig = preferredRegion === 'cloud' ? getCloudConfig() : getSelfHostedConfig()
  if (preferredConfig) {
    const preferredHealthy = await healthCheckLiveKit(preferredConfig)
    if (preferredHealthy) {
      return { config: preferredConfig, actualRegion: preferredRegion, usedFallback: false }
    }
  }

  const fallbackConfig = fallbackRegion === 'cloud' ? getCloudConfig() : getSelfHostedConfig()
  if (fallbackConfig) {
    const fallbackHealthy = await healthCheckLiveKit(fallbackConfig)
    if (fallbackHealthy) {
      return { config: fallbackConfig, actualRegion: fallbackRegion, usedFallback: true }
    }
  }

  throw new Error(`Both LiveKit regions unavailable: ${preferredRegion} and ${fallbackRegion}`)
}

export function getRoomServiceClientForRegion(region: LiveKitRegion | null): RoomServiceClient {
  const config = getLiveKitConfigForRegion(region || 'self-hosted')
  return new RoomServiceClient(config.apiUrl, config.apiKey, config.apiSecret)
}

export function getEgressClientForRegion(region: LiveKitRegion | null): EgressClient {
  const config = getLiveKitConfigForRegion(region || 'self-hosted')
  return new EgressClient(config.apiUrl, config.apiKey, config.apiSecret)
}
