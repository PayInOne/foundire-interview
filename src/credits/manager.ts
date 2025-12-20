import type { SupabaseClient } from '@supabase/supabase-js'

export type CreditType = 'interview_minute'

export interface CreditUsage {
  companyId: string
  amount: number
  type: CreditType
  referenceId?: string
  referenceType?: 'interview'
  description?: string
  userId?: string
}

export async function deductCredits(
  usage: CreditUsage,
  supabase: SupabaseClient
): Promise<{ success: boolean; newBalance: number; error?: string }> {
  const { data: company, error: fetchError } = await supabase
    .from('companies')
    .select('credits_remaining')
    .eq('id', usage.companyId)
    .single()

  if (fetchError || !company) {
    console.error('Error fetching company for credit deduction:', fetchError)
    return { success: false, newBalance: 0, error: 'Company not found or error fetching credits' }
  }

  const currentBalance = (company as { credits_remaining: number | null }).credits_remaining ?? 0
  if (currentBalance < usage.amount) {
    return {
      success: false,
      newBalance: currentBalance,
      error: `Insufficient credits. Required: ${usage.amount}, Available: ${currentBalance}`,
    }
  }

  const newBalance = currentBalance - usage.amount
  const { error: updateError } = await supabase
    .from('companies')
    .update({ credits_remaining: newBalance })
    .eq('id', usage.companyId)

  if (updateError) {
    console.error('Error updating company credits:', updateError)
    return { success: false, newBalance: currentBalance, error: 'Failed to update credits' }
  }

  try {
    await supabase.from('credit_transactions').insert({
      company_id: usage.companyId,
      user_id: usage.userId || null,
      amount: usage.amount,
      type: usage.type,
      description: usage.description || null,
      reference_id: usage.referenceId || null,
      reference_type: usage.referenceType || null,
      balance_before: currentBalance,
      balance_after: newBalance,
    })
  } catch (logError) {
    console.error('Failed to log credit transaction:', logError)
  }

  return { success: true, newBalance }
}

