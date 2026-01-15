import { getAppPublicUrl } from '../config'
import { sendInterviewerInvitationEmail } from '../email'
import { createAdminClient } from '../supabase/admin'
import { asRecord, getString } from '../utils/parse'

export type CopilotParticipantsPostResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401 | 403 | 404 | 500; body: Record<string, unknown> }

export async function handleAddCopilotParticipants(
  copilotInterviewId: string,
  body: unknown
): Promise<CopilotParticipantsPostResponse> {
  try {
    const record = asRecord(body)
    if (!record) return { status: 400, body: { success: false, error: 'Invalid request body' } }

    const userId = getString(record, 'userId')
    if (!userId) return { status: 401, body: { success: false, error: 'Unauthorized' } }

    const interviewerIdsValue = record.interviewerIds
    const interviewerIds = Array.isArray(interviewerIdsValue)
      ? interviewerIdsValue.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : []

    if (interviewerIds.length === 0) {
      return { status: 400, body: { success: false, error: 'interviewerIds is required' } }
    }

    const adminSupabase = createAdminClient()

    const { data: interview, error: interviewError } = await adminSupabase
      .from('copilot_interviews')
      .select('id, company_id, candidate_id, job_id, room_status, scheduled_at, interviewer_timezone')
      .eq('id', copilotInterviewId)
      .single()

    if (interviewError || !interview) {
      return { status: 404, body: { success: false, error: 'Interview not found' } }
    }

    const interviewMeta = interview as {
      company_id: string
      candidate_id: string
      job_id: string
      room_status: string
      scheduled_at: string | null
      interviewer_timezone: string | null
    }

    if (interviewMeta.room_status === 'completed' || interviewMeta.room_status === 'cancelled') {
      return {
        status: 400,
        body: { success: false, error: 'Cannot add interviewers to completed/cancelled interview' },
      }
    }

    const { data: userMember } = await adminSupabase
      .from('company_members')
      .select('id')
      .eq('company_id', interviewMeta.company_id)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single()

    if (!userMember) {
      return { status: 403, body: { success: false, error: 'Unauthorized: Not a company member' } }
    }

    const { data: existingParticipants } = await adminSupabase
      .from('copilot_interview_participants')
      .select('user_id, participant_index')
      .eq('copilot_interview_id', copilotInterviewId)

    const currentCount = existingParticipants?.length || 0
    const maxParticipants = 3

    if (currentCount >= maxParticipants) {
      return { status: 400, body: { success: false, error: 'Maximum number of interviewers reached' } }
    }

    const { data: validMembers } = await adminSupabase
      .from('company_members')
      .select('user_id')
      .eq('company_id', interviewMeta.company_id)
      .is('deleted_at', null)
      .in('user_id', interviewerIds)

    const validUserIds = new Set((validMembers || []).map((m) => (m as { user_id: string }).user_id))
    const existingUserIds = new Set((existingParticipants || []).map((p) => (p as { user_id: string }).user_id))

    const newInterviewerIds = interviewerIds.filter((id) => validUserIds.has(id) && !existingUserIds.has(id))
    if (newInterviewerIds.length === 0) {
      return { status: 400, body: { success: false, error: 'No valid new interviewers to add' } }
    }

    const availableSlots = maxParticipants - currentCount
    const interviewersToAdd = newInterviewerIds.slice(0, availableSlots)

    const usedIndices = new Set((existingParticipants || []).map((p) => (p as { participant_index: number }).participant_index))
    let nextIndex = 0
    while (usedIndices.has(nextIndex) && nextIndex < maxParticipants) {
      nextIndex++
    }

    const participantsToCreate = interviewersToAdd.map((newUserId, i) => {
      let index = nextIndex + i
      while (usedIndices.has(index) && index < maxParticipants) {
        index++
      }
      usedIndices.add(index)
      return { copilot_interview_id: copilotInterviewId, user_id: newUserId, participant_index: index }
    })

    const { error: insertError } = await adminSupabase.from('copilot_interview_participants').insert(participantsToCreate)
    if (insertError) {
      console.error('Failed to add participants:', insertError)
      return { status: 500, body: { success: false, error: 'Failed to add participants' } }
    }

    const baseUrl = getAppPublicUrl()
    const interviewerUrl = `${baseUrl}/copilot-interview/${copilotInterviewId}/interviewer`
    const scheduledAt = interviewMeta.scheduled_at ?? new Date().toISOString()

    const inviterName = getString(record, 'inviterName')
    let resolvedInviterName = inviterName
    if (!resolvedInviterName) {
      try {
        const { data: inviterData } = await adminSupabase.auth.admin.getUserById(userId)
        const inviter = inviterData?.user
        resolvedInviterName = (inviter?.user_metadata?.full_name as string | undefined) || inviter?.email || 'A colleague'
      } catch {
        resolvedInviterName = 'A colleague'
      }
    }

    const { data: candidate } = await adminSupabase.from('candidates').select('name').eq('id', interviewMeta.candidate_id).single()
    const { data: job } = await adminSupabase.from('jobs').select('title').eq('id', interviewMeta.job_id).single()

    const candidateName = (candidate as { name?: string | null } | null)?.name || 'Candidate'
    const jobTitle = (job as { title?: string | null } | null)?.title || 'Position'

    const emailResults = await Promise.allSettled(
      interviewersToAdd.map(async (interviewerId) => {
        const { data: userData, error: userError } = await adminSupabase.auth.admin.getUserById(interviewerId)
        const email = userData?.user?.email
        if (userError || !email) {
          throw new Error(`User not found: ${interviewerId}`)
        }

        const interviewer = userData.user
        const locale = (interviewer.user_metadata?.locale as string | undefined) || 'en'
        await sendInterviewerInvitationEmail({
          to: email,
          interviewerName:
            (interviewer.user_metadata?.full_name as string | undefined) || email.split('@')[0] || 'Interviewer',
          candidateName,
          jobTitle,
          invitedBy: resolvedInviterName || 'A colleague',
          interviewerUrl,
          scheduledAt,
          interviewerTimezone: interviewMeta.interviewer_timezone,
          locale,
        })
      })
    )

    emailResults.forEach((result, idx) => {
      if (result.status === 'rejected') {
        console.error(`[Copilot Participants] Failed to send email to user ${interviewersToAdd[idx]}:`, result.reason)
      }
    })

    return {
      status: 200,
      body: {
        success: true,
        data: { addedCount: interviewersToAdd.length, addedInterviewers: interviewersToAdd },
      },
    }
  } catch (error) {
    console.error('Add participants error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

export type CopilotParticipantsGetResponse =
  | { status: 200; body: { success: true; data: unknown[] } }
  | { status: 401 | 403 | 404 | 500; body: { success: false; error: string } }

export async function handleGetCopilotParticipants(
  copilotInterviewId: string,
  userId: string
): Promise<CopilotParticipantsGetResponse> {
  try {
    if (!userId) return { status: 401, body: { success: false, error: 'Unauthorized' } }

    const adminSupabase = createAdminClient()

    const { data: interview, error: interviewError } = await adminSupabase
      .from('copilot_interviews')
      .select('id, company_id')
      .eq('id', copilotInterviewId)
      .single()

    if (interviewError || !interview) {
      return { status: 404, body: { success: false, error: 'Interview not found' } }
    }

    const companyId = (interview as { company_id: string }).company_id

    const { data: userMember } = await adminSupabase
      .from('company_members')
      .select('id')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single()

    if (!userMember) {
      return { status: 403, body: { success: false, error: 'Unauthorized: Not a company member' } }
    }

    const { data: participants, error: participantsError } = await adminSupabase
      .from('copilot_interview_participants')
      .select('user_id, participant_index, joined_at')
      .eq('copilot_interview_id', copilotInterviewId)
      .order('participant_index', { ascending: true })

    if (participantsError) {
      return { status: 500, body: { success: false, error: 'Failed to fetch participants' } }
    }

    if (participants && participants.length > 0) {
      const enrichedParticipants = await Promise.all(
        participants.map(async (p) => {
          try {
            const { data: userData } = await adminSupabase.auth.admin.getUserById((p as { user_id: string }).user_id)
            const email = userData?.user?.email
            const fullName = (userData?.user?.user_metadata?.full_name as string | undefined) || email?.split('@')[0]
            return { ...p, email, full_name: fullName }
          } catch {
            return { ...p, email: undefined, full_name: undefined }
          }
        })
      )

      return { status: 200, body: { success: true, data: enrichedParticipants } }
    }

    return { status: 200, body: { success: true, data: participants || [] } }
  } catch (error) {
    console.error('Get participants error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}
