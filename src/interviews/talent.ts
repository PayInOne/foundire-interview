import type { SupabaseClient } from '@supabase/supabase-js'

const TALENT_COMPANY_SLUG = 'foundire-talent'

export async function isTalentApplicantCandidate(
  supabase: SupabaseClient,
  candidateId?: string | null
): Promise<boolean> {
  if (!candidateId) return false

  const { data } = await supabase
    .from('candidates')
    .select('source, companies ( slug )')
    .eq('id', candidateId)
    .maybeSingle()

  const company = data?.companies as { slug?: string } | { slug?: string }[] | null | undefined
  const companySlug = Array.isArray(company) ? company[0]?.slug : company?.slug

  return data?.source === 'talent_applicant' || companySlug === TALENT_COMPANY_SLUG
}
