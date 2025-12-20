import { uploadToR2 } from '../cloudflare/r2'
import { createAdminClient } from '../supabase/admin'
import { toJson } from '../supabase/json'

export type CoseatProfileGetResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 401 | 404 | 500; body: Record<string, unknown> }

function buildProxyUrl(key: string, cacheBust: boolean): string {
  const base = `/app/api/audio-proxy?key=${encodeURIComponent(key)}`
  return cacheBust ? `${base}&t=${Date.now()}` : base
}

export async function handleGetCoseatProfile(userId: string, companyId: string): Promise<CoseatProfileGetResponse> {
  try {
    const fallbackTimestamp = new Date().toISOString()

    if (!userId) {
      return { status: 401, body: { success: false, error: 'Unauthorized' } }
    }

    if (!companyId) {
      return { status: 404, body: { success: false, error: 'No company membership found' } }
    }

    const adminSupabase = createAdminClient()
    const { data: profile, error } = await adminSupabase
      .from('hr_voice_profiles')
      .select('*')
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .single()

    if (error && (error as { code?: string }).code !== 'PGRST116') {
      console.error('Error fetching voice profile:', error)
      return { status: 500, body: { success: false, error: 'Failed to fetch voice profile' } }
    }

    let responseProfile = profile as Record<string, unknown> | null
    const audioUrl = typeof responseProfile?.audio_url === 'string' ? (responseProfile.audio_url as string) : null
    if (audioUrl) {
      const key = audioUrl.split('/').slice(-3).join('/')
      responseProfile = { ...responseProfile, audio_url: buildProxyUrl(key, false) }
    }

    if (!responseProfile) {
      return { status: 200, body: { success: true, data: null } }
    }

    return {
      status: 200,
      body: {
        success: true,
        data: {
          id: responseProfile.id,
          userId: responseProfile.user_id,
          companyId: responseProfile.company_id,
          audioUrl: responseProfile.audio_url,
          voicePrintFeatures: responseProfile.voice_print_features ?? null,
          language: (responseProfile.language as string | null) ?? 'en-US',
          isVerified: Boolean(responseProfile.is_verified),
          createdAt: (responseProfile.created_at as string | null) ?? fallbackTimestamp,
          updatedAt: (responseProfile.updated_at as string | null) ?? fallbackTimestamp,
        },
      },
    }
  } catch (error) {
    console.error('Error in GET /internal/coseat/profile:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

export type CoseatProfilePostPayload = {
  userId: string
  companyId: string
  audioFile: File
  language: string
  voicePrintFeaturesStr: string | null
}

export type CoseatProfilePostResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401 | 404 | 500; body: Record<string, unknown> }

export async function handlePostCoseatProfile(payload: CoseatProfilePostPayload): Promise<CoseatProfilePostResponse> {
  try {
    const fallbackTimestamp = new Date().toISOString()

    if (!payload.userId) {
      return { status: 401, body: { success: false, error: 'Unauthorized' } }
    }

    if (!payload.companyId) {
      return { status: 404, body: { success: false, error: 'No company membership found' } }
    }

    if (!payload.audioFile) {
      return { status: 400, body: { success: false, error: 'No audio file provided' } }
    }

    if (payload.audioFile.size > 10 * 1024 * 1024) {
      return { status: 400, body: { success: false, error: 'Audio file too large. Maximum size is 10MB.' } }
    }

    const arrayBuffer = await payload.audioFile.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const sanitizedUserId = payload.userId.replace(/[^a-zA-Z0-9]/g, '')
    const timestamp = Date.now()
    const extension = payload.audioFile.type.includes('webm') ? 'webm' : 'wav'
    const key = `hr-voice/${sanitizedUserId}/${timestamp}.${extension}`

    await uploadToR2(buffer, key, payload.audioFile.type)

    let voicePrintFeatures: unknown = null
    if (payload.voicePrintFeaturesStr) {
      try {
        voicePrintFeatures = JSON.parse(payload.voicePrintFeaturesStr)
      } catch (parseError) {
        console.warn('Failed to parse voice print features:', parseError)
      }
    }

    const adminSupabase = createAdminClient()
    const { data: profile, error } = await adminSupabase
      .from('hr_voice_profiles')
      .upsert(
        {
          user_id: payload.userId,
          company_id: payload.companyId,
          audio_url: key,
          voice_print_features: toJson(voicePrintFeatures),
          language: payload.language,
          is_verified: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,company_id' }
      )
      .select()
      .single()

    if (error || !profile) {
      console.error('Error saving voice profile:', error)
      return { status: 500, body: { success: false, error: 'Failed to save voice profile' } }
    }

    const proxyUrl = buildProxyUrl(key, true)

    return {
      status: 200,
      body: {
        success: true,
        data: {
          id: (profile as { id: string }).id,
          userId: (profile as { user_id: string }).user_id,
          companyId: (profile as { company_id: string }).company_id,
          audioUrl: proxyUrl,
          voicePrintFeatures: (profile as { voice_print_features?: unknown }).voice_print_features ?? null,
          language: (profile as { language?: string | null }).language ?? payload.language,
          isVerified: (profile as { is_verified?: boolean | null }).is_verified ?? true,
          createdAt: (profile as { created_at?: string | null }).created_at ?? fallbackTimestamp,
          updatedAt: (profile as { updated_at?: string | null }).updated_at ?? fallbackTimestamp,
        },
      },
    }
  } catch (error) {
    console.error('Error in POST /internal/coseat/profile:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

export type CoseatProfileDeleteResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 401 | 404 | 500; body: Record<string, unknown> }

export async function handleDeleteCoseatProfile(userId: string, companyId: string): Promise<CoseatProfileDeleteResponse> {
  try {
    if (!userId) {
      return { status: 401, body: { success: false, error: 'Unauthorized' } }
    }

    if (!companyId) {
      return { status: 404, body: { success: false, error: 'No company membership found' } }
    }

    const adminSupabase = createAdminClient()
    const { error } = await adminSupabase
      .from('hr_voice_profiles')
      .delete()
      .eq('user_id', userId)
      .eq('company_id', companyId)

    if (error) {
      console.error('Error deleting voice profile:', error)
      return { status: 500, body: { success: false, error: 'Failed to delete voice profile' } }
    }

    return { status: 200, body: { success: true, data: { deleted: true } } }
  } catch (error) {
    console.error('Error in DELETE /internal/coseat/profile:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

