import { WebhookReceiver } from 'livekit-server-sdk'

export type LiveKitWebhookResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 401 | 500; body: Record<string, unknown> }

export async function handleLiveKitWebhook(params: {
  rawBody: string
  authorization: string
}): Promise<LiveKitWebhookResponse> {
  try {
    const apiKey = process.env.LIVEKIT_API_KEY
    const apiSecret = process.env.LIVEKIT_API_SECRET

    if (!apiKey || !apiSecret) {
      console.error('LiveKit credentials not configured for webhook verification')
      return { status: 500, body: { error: 'Configuration error' } }
    }

    const receiver = new WebhookReceiver(apiKey, apiSecret)

    let event: unknown
    try {
      event = await receiver.receive(params.rawBody, params.authorization || '')
    } catch (error) {
      console.error('Invalid webhook signature:', error)
      return { status: 401, body: { error: 'Invalid signature' } }
    }

    const webhookEvent = typeof event === 'string' ? (JSON.parse(event) as Record<string, unknown>) : (event as Record<string, unknown>)

    console.log('[LiveKit Webhook] Received:', {
      event: webhookEvent.event,
      room: (webhookEvent.room as { name?: string } | undefined)?.name,
      participant: (webhookEvent.participant as { identity?: string } | undefined)?.identity,
    })

    return { status: 200, body: { success: true } }
  } catch (error) {
    console.error('Error handling LiveKit webhook:', error)
    return { status: 200, body: { success: false, error: 'Internal error' } }
  }
}

