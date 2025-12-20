import amqp, { type Channel, type ChannelModel, type Options } from 'amqplib'

let connectionPromise: Promise<ChannelModel> | null = null
let channelPromise: Promise<Channel> | null = null

function getRabbitMQUrl(): string {
  const url = process.env.RABBITMQ_URL
  if (!url) {
    throw new Error('RABBITMQ_URL is not configured.')
  }
  return url
}

async function getConnection(): Promise<ChannelModel> {
  if (!connectionPromise) {
    connectionPromise = amqp.connect(getRabbitMQUrl())
  }
  return connectionPromise
}

export async function getRabbitMQChannel(): Promise<Channel> {
  if (!channelPromise) {
    channelPromise = (async () => {
      const conn = await getConnection()
      const channel = await conn.createChannel()

      conn.on('close', () => {
        connectionPromise = null
        channelPromise = null
      })
      conn.on('error', () => {
        connectionPromise = null
        channelPromise = null
      })

      channel.on('close', () => {
        channelPromise = null
      })
      channel.on('error', () => {
        channelPromise = null
      })

      return channel
    })()
  }

  return channelPromise
}

export async function assertDurableQueue(queueName: string): Promise<Channel> {
  const channel = await getRabbitMQChannel()
  await channel.assertQueue(queueName, { durable: true })
  return channel
}

export async function publishJson(queueName: string, payload: unknown, options?: Options.Publish): Promise<boolean> {
  const channel = await assertDurableQueue(queueName)
  const content = Buffer.from(JSON.stringify(payload), 'utf8')
  return channel.sendToQueue(queueName, content, {
    contentType: 'application/json',
    deliveryMode: 2, // persistent
    ...options,
  })
}

