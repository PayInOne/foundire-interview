export function getAppPublicUrl(): string {
  return process.env.APP_PUBLIC_URL || 'https://foundire.com/app'
}
