export function getAppPublicUrl(): string {
  return process.env.APP_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://app.foundire.com'
}

