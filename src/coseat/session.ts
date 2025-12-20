import { enqueueInterviewAnalyzeTask } from '../workers/interview-analyze'
import { createAdminClient } from '../supabase/admin'
import { INTERVIEW_MODES } from '../interview/modes'
import { toJson } from '../supabase/json'
import { asRecord, getOptionalString, getString } from '../utils/parse'
import { uploadToR2 } from '../cloudflare/r2'

type CoSeatSessionStatus = 'pending' | 'preparing' | 'active' | 'completed' | 'cancelled'

function isCoSeatSessionStatus(value: string | null): value is CoSeatSessionStatus {
  return value === 'pending' || value === 'preparing' || value === 'active' || value === 'completed' || value === 'cancelled'
}

export type CoseatSessionStartResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401 | 404 | 500; body: Record<string, unknown> }

export async function handleStartCoseatSession(body: unknown): Promise<CoseatSessionStartResponse> {
  try {
    const record = asRecord(body) ?? {}
    const userId = getString(record, 'userId')
    const candidateId = getString(record, 'candidateId')
    const jobId = getString(record, 'jobId')

    if (!userId) {
      return { status: 401, body: { success: false, error: 'Unauthorized' } }
    }

    if (!candidateId || !jobId) {
      return { status: 400, body: { success: false, error: 'candidateId and jobId are required' } }
    }

    const adminSupabase = createAdminClient()

    const { data: candidate } = await adminSupabase
      .from('candidates')
      .select('id, company_id')
      .eq('id', candidateId)
      .single()

    const companyId = (candidate as { company_id?: string | null } | null)?.company_id
    if (!companyId) {
      return { status: 404, body: { success: false, error: 'Candidate not found or access denied' } }
    }

    const { data: membership } = await adminSupabase
      .from('company_members')
      .select('id')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .single()

    if (!membership) {
      return { status: 404, body: { success: false, error: 'Candidate not found or access denied' } }
    }

    const { data: job } = await adminSupabase
      .from('jobs')
      .select('id, company_id')
      .eq('id', jobId)
      .single()

    if (!job || (job as { company_id: string }).company_id !== companyId) {
      return { status: 404, body: { success: false, error: 'Job not found or access denied' } }
    }

    const now = new Date().toISOString()

    const { data: interview, error: interviewError } = await adminSupabase
      .from('interviews')
      .insert({
        candidate_id: candidateId,
        job_id: jobId,
        company_id: companyId,
        interview_mode: INTERVIEW_MODES.ASSISTED_VOICE,
        status: 'in-progress',
        transcript: toJson([]),
        started_at: now,
      })
      .select()
      .single()

    if (interviewError || !interview) {
      console.error('Failed to create interview:', interviewError)
      return { status: 500, body: { success: false, error: 'Failed to create interview' } }
    }

    const { data: coseatInterview, error: coseatError } = await adminSupabase
      .from('coseat_interviews')
      .insert({
        interview_id: (interview as { id: string }).id,
        company_id: companyId,
        interviewer_id: userId,
        candidate_id: candidateId,
        job_id: jobId,
        session_status: 'active',
        started_at: now,
        ai_enabled: true,
        transcript_count: 0,
      })
      .select()
      .single()

    if (coseatError || !coseatInterview) {
      console.error('Failed to create coseat interview:', coseatError)
      await adminSupabase.from('interviews').delete().eq('id', (interview as { id: string }).id)
      return { status: 500, body: { success: false, error: 'Failed to create CoSeat session' } }
    }

    await adminSupabase.from('candidates').update({ status: 'interviewing' }).eq('id', candidateId)

    const fallbackTimestamp = new Date().toISOString()
    const rawStatus = (coseatInterview as { session_status: string | null }).session_status
    const sessionStatus: CoSeatSessionStatus = isCoSeatSessionStatus(rawStatus) ? rawStatus : 'active'

    return {
      status: 200,
      body: {
        success: true,
        data: {
          id: (coseatInterview as { id: string }).id,
          interviewId: (coseatInterview as { interview_id: string }).interview_id,
          companyId: (coseatInterview as { company_id: string }).company_id,
          interviewerId: (coseatInterview as { interviewer_id: string }).interviewer_id,
          candidateId: (coseatInterview as { candidate_id: string }).candidate_id,
          jobId: (coseatInterview as { job_id: string }).job_id,
          sessionStatus,
          startedAt: (coseatInterview as { started_at: string | null }).started_at,
          endedAt: (coseatInterview as { ended_at: string | null }).ended_at,
          aiEnabled: (coseatInterview as { ai_enabled: boolean | null }).ai_enabled ?? true,
          aiLastSuggestionAt: (coseatInterview as { ai_last_suggestion_at: string | null }).ai_last_suggestion_at ?? null,
          transcriptCount: (coseatInterview as { transcript_count: number | null }).transcript_count ?? 0,
          createdAt: (coseatInterview as { created_at?: string | null }).created_at ?? fallbackTimestamp,
          updatedAt: (coseatInterview as { updated_at?: string | null }).updated_at ?? fallbackTimestamp,
        },
      },
    }
  } catch (error) {
    console.error('Error in POST /internal/coseat/session/start:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

export type CoseatSessionEndResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401 | 403 | 404 | 500; body: Record<string, unknown> }

export async function handleEndCoseatSession(body: unknown): Promise<CoseatSessionEndResponse> {
  try {
    const record = asRecord(body) ?? {}
    const userId = getString(record, 'userId')
    const coseatInterviewId = getString(record, 'coseatInterviewId')

    if (!userId) {
      return { status: 401, body: { success: false, error: 'Unauthorized' } }
    }

    if (!coseatInterviewId) {
      return { status: 400, body: { success: false, error: 'coseatInterviewId is required' } }
    }

    const adminSupabase = createAdminClient()

    const { data: coseatInterview, error: fetchError } = await adminSupabase
      .from('coseat_interviews')
      .select('id, interviewer_id, session_status, interview_id')
      .eq('id', coseatInterviewId)
      .single()

    if (fetchError || !coseatInterview) {
      return { status: 404, body: { success: false, error: 'CoSeat interview not found' } }
    }

    const meta = coseatInterview as { interviewer_id: string; session_status: string | null; interview_id: string }

    if (meta.interviewer_id !== userId) {
      return { status: 403, body: { success: false, error: 'Only the interviewer can end this session' } }
    }

    if (meta.session_status === 'completed') {
      return { status: 400, body: { success: false, error: 'Session already ended' } }
    }

    const now = new Date().toISOString()

    const { error: updateCoseatError } = await adminSupabase
      .from('coseat_interviews')
      .update({ session_status: 'completed', ended_at: now })
      .eq('id', coseatInterviewId)

    if (updateCoseatError) {
      console.error('Failed to update coseat interview:', updateCoseatError)
      return { status: 500, body: { success: false, error: 'Failed to end session' } }
    }

    await adminSupabase
      .from('interviews')
      .update({ status: 'completed', completed_at: now })
      .eq('id', meta.interview_id)

    if (process.env.RABBITMQ_URL) {
      let locale = 'en'
      try {
        const { data } = await adminSupabase.auth.admin.getUserById(userId)
        locale = (data?.user?.user_metadata?.locale as string | undefined) || 'en'
      } catch (error) {
        console.warn('Failed to get interviewer locale:', error)
      }

      try {
        await enqueueInterviewAnalyzeTask({ interviewId: meta.interview_id, locale, sendEmail: true })
      } catch (error) {
        console.error('Failed to enqueue interview analysis:', error)
      }
    }

    return { status: 200, body: { success: true, data: { ended: true } } }
  } catch (error) {
    console.error('Error in POST /internal/coseat/session/end:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

export type UploadRecordingPayload = {
  userId: string
  coseatInterviewId: string
  durationSeconds?: string
  audioFile: File
}

export type CoseatUploadRecordingResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401 | 403 | 404 | 500; body: Record<string, unknown> }

export async function handleUploadCoseatRecording(payload: UploadRecordingPayload): Promise<CoseatUploadRecordingResponse> {
  try {
    const { userId, coseatInterviewId, audioFile, durationSeconds } = payload

    if (!userId) {
      return { status: 401, body: { success: false, error: 'Unauthorized' } }
    }

    if (!audioFile || !coseatInterviewId) {
      return { status: 400, body: { success: false, error: 'audio and coseatInterviewId are required' } }
    }

    const adminSupabase = createAdminClient()

    const { data: coseatInterview, error: fetchError } = await adminSupabase
      .from('coseat_interviews')
      .select('id, interviewer_id')
      .eq('id', coseatInterviewId)
      .single()

    if (fetchError || !coseatInterview) {
      return { status: 404, body: { success: false, error: 'CoSeat interview not found' } }
    }

    if ((coseatInterview as { interviewer_id: string }).interviewer_id !== userId) {
      return { status: 403, body: { success: false, error: 'Only the interviewer can upload recordings' } }
    }

    const extension = audioFile.name.split('.').pop() || 'webm'
    const timestamp = Date.now()
    const key = `coseat-recordings/${coseatInterviewId}/${timestamp}.${extension}`

    const buffer = Buffer.from(await audioFile.arrayBuffer())
    await uploadToR2(buffer, key, audioFile.type || 'audio/webm')

    const updateData: { audio_recording_key: string; audio_duration_seconds?: number } = { audio_recording_key: key }
    if (durationSeconds) {
      updateData.audio_duration_seconds = parseInt(durationSeconds, 10)
    }

    const { error: updateError } = await adminSupabase
      .from('coseat_interviews')
      .update(updateData)
      .eq('id', coseatInterviewId)

    if (updateError) {
      console.error('Failed to update coseat interview with recording key:', updateError)
      return { status: 500, body: { success: false, error: 'Failed to save recording reference' } }
    }

    return { status: 200, body: { success: true, data: { key } } }
  } catch (error) {
    console.error('Error in POST /internal/coseat/session/upload-recording:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

