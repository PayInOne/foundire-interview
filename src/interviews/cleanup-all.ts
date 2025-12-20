import { cleanupActiveCopilotInterviews, cleanupWaitingRoomCopilotInterviews } from '../copilot-interviews/cleanup'
import { handleCleanupStandardInterviews } from './cleanup'

export type CleanupAllInterviewsResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 500; body: Record<string, unknown> }

export async function handleCleanupAllInterviews(): Promise<CleanupAllInterviewsResponse> {
  try {
    let standardInterviews: { processed: number; results: unknown[]; message?: string; error?: string } = {
      processed: 0,
      results: [],
    }

    try {
      const standard = await handleCleanupStandardInterviews()
      if (standard.status === 200) {
        const body = standard.body as Record<string, unknown>
        standardInterviews = {
          processed: typeof body.processed === 'number' ? body.processed : 0,
          results: Array.isArray(body.results) ? (body.results as unknown[]) : [],
          ...(typeof body.message === 'string' ? { message: body.message } : {}),
        }
      } else {
        const body = standard.body as Record<string, unknown>
        standardInterviews = {
          processed: 0,
          results: [],
          error: typeof body.error === 'string' ? body.error : 'Failed to cleanup standard interviews',
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cleanup standard interviews'
      standardInterviews = { processed: 0, results: [], error: message }
    }

    const copilotResults = await cleanupActiveCopilotInterviews()
    const waitingRoomResults = await cleanupWaitingRoomCopilotInterviews()

    return {
      status: 200,
      body: {
        success: true,
        standardInterviews: {
          processed: standardInterviews.processed,
          results: standardInterviews.results,
          ...(standardInterviews.message ? { message: standardInterviews.message } : {}),
          ...(standardInterviews.error ? { error: standardInterviews.error } : {}),
        },
        copilotInterviews: {
          processed: copilotResults.length,
          results: copilotResults,
        },
        waitingRoomInterviews: {
          processed: waitingRoomResults.length,
          results: waitingRoomResults,
        },
      },
    }
  } catch (error) {
    console.error('Cleanup-all error:', error)
    return { status: 500, body: { success: false, error: 'Internal server error' } }
  }
}

