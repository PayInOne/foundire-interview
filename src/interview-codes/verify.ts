import { createAdminClient } from '../supabase/admin'

export type VerifyInterviewCodeResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 500; body: Record<string, unknown> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export async function handleVerifyInterviewCode(body: unknown): Promise<VerifyInterviewCodeResponse> {
  const record = isRecord(body) ? body : null
  const code = typeof record?.code === 'string' ? record.code : ''
  const jobId = typeof record?.jobId === 'string' ? record.jobId : ''

  if (!code || !jobId) {
    return { status: 400, body: { error: 'Missing required fields', valid: false } }
  }

  try {
    const supabase = createAdminClient()

    const { data: codeCheck, error: codeCheckError } = await supabase
      .from('interview_codes')
      .select('*, jobs(id, title)')
      .eq('code', code.toUpperCase())
      .maybeSingle()

    if (codeCheckError) {
      console.error('Database error checking interview code:', codeCheckError)
      return { status: 500, body: { error: 'Database error. Please try again.', valid: false } }
    }

    if (!codeCheck) {
      return {
        status: 400,
        body: { error: 'Interview code not found. Please check the code and try again.', valid: false },
      }
    }

    const interviewCode = codeCheck as unknown as {
      id: string
      job_id: string
      expires_at: string
      max_uses: number
      used_count: number
      jobs?: { title?: string } | null
    }

    if (interviewCode.job_id !== jobId) {
      console.error(
        `Code ${code} is for job ${interviewCode.job_id} (${interviewCode.jobs?.title ?? 'unknown'}), but URL has job ${jobId}`
      )
      return {
        status: 400,
        body: {
          error:
            'This interview code does not match the job in the URL. Please use the complete link provided by the company.',
          valid: false,
        },
      }
    }

    if (new Date(interviewCode.expires_at) < new Date()) {
      return { status: 400, body: { error: 'Interview code has expired', valid: false } }
    }

    return {
      status: 200,
      body: {
        valid: true,
        codeId: interviewCode.id,
        remainingUses: interviewCode.max_uses - interviewCode.used_count,
        maxUses: interviewCode.max_uses,
        usedCount: interviewCode.used_count,
      },
    }
  } catch (error) {
    console.error('Error verifying interview code:', error)
    return { status: 500, body: { error: 'Internal server error', valid: false } }
  }
}

