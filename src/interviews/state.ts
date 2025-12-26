import { createAdminClient } from '../supabase/admin'
import { toJson, type Json } from '../supabase/json'
import { INTERVIEW_MODES, normalizeInterviewMode } from '../interview/modes'

export type GetStateResponse =
  | { status: 200; body: { conversation_state: unknown; interview_mode: unknown } }
  | { status: 400 | 404 | 500; body: { error: string } }

export async function handleGetConversationState(interviewId: string): Promise<GetStateResponse> {
  if (!interviewId) {
    return { status: 400, body: { error: 'Missing interview ID' } }
  }

  try {
    const supabase = createAdminClient()
    const { data: interview, error } = await supabase
      .from('interviews')
      .select('conversation_state, interview_mode')
      .eq('id', interviewId)
      .single()

    if (error || !interview) {
      return { status: 404, body: { error: 'Interview not found' } }
    }

    const record = interview as unknown as { conversation_state: unknown; interview_mode: unknown }

    return {
      status: 200,
      body: {
        conversation_state: record.conversation_state,
        interview_mode: record.interview_mode,
      },
    }
  } catch (error) {
    console.error('Error fetching conversation state:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return { status: 500, body: { error: message } }
  }
}

export type UpdateStateResponse =
  | { status: 200; body: { success: true } }
  | { status: 400 | 404 | 500; body: { error: string } }

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export async function handleUpdateConversationState(
  interviewId: string,
  conversationState: unknown
): Promise<UpdateStateResponse> {
  if (!interviewId) {
    return { status: 400, body: { error: 'Missing interview ID' } }
  }

  if (!conversationState) {
    return { status: 400, body: { error: 'Missing conversation_state' } }
  }

  try {
    const supabase = createAdminClient()

    const { data: interview, error: fetchError } = await supabase
      .from('interviews')
      .select('id, status, interview_mode, conversation_state')
      .eq('id', interviewId)
      .single()

    if (fetchError || !interview) {
      return { status: 404, body: { error: 'Interview not found' } }
    }

    const mode = normalizeInterviewMode((interview as { interview_mode: string | null }).interview_mode)
    if (mode !== INTERVIEW_MODES.AI_DIALOGUE) {
      return { status: 400, body: { error: 'State updates are only supported for conversational interviews' } }
    }

    // 避免客户端/服务端互相覆盖：对 object 形态做浅层 merge（incoming 覆盖 existing）
    const existingState = (interview as { conversation_state?: unknown }).conversation_state
    const mergedState =
      isPlainRecord(existingState) && isPlainRecord(conversationState)
        ? { ...existingState, ...conversationState }
        : conversationState

    let mergedStateJson: Json
    try {
      mergedStateJson = toJson(mergedState)
    } catch {
      return { status: 400, body: { error: 'conversation_state must be JSON-serializable' } }
    }

    const { error: updateError } = await supabase
      .from('interviews')
      .update({ conversation_state: mergedStateJson })
      .eq('id', interviewId)

    if (updateError) {
      console.error('Error updating conversation state:', updateError)
      return { status: 500, body: { error: 'Failed to update conversation state' } }
    }

    return { status: 200, body: { success: true } }
  } catch (error) {
    console.error('Error updating conversation state:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return { status: 500, body: { error: message } }
  }
}
