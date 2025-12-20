import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { Readable } from 'node:stream'

function getR2AccountId(): string {
  const value = process.env.R2_ACCOUNT_ID
  if (!value) {
    throw new Error('R2_ACCOUNT_ID is not configured')
  }
  return value
}

function getR2AccessKeyId(): string {
  const value = process.env.R2_ACCESS_KEY_ID
  if (!value) {
    throw new Error('R2_ACCESS_KEY_ID is not configured')
  }
  return value
}

function getR2SecretAccessKey(): string {
  const value = process.env.R2_SECRET_ACCESS_KEY
  if (!value) {
    throw new Error('R2_SECRET_ACCESS_KEY is not configured')
  }
  return value
}

export function getR2BucketName(): string {
  const value = process.env.R2_BUCKET_NAME
  if (!value) {
    throw new Error('R2_BUCKET_NAME is not configured')
  }
  return value
}

let cachedClient: S3Client | null = null

export function getR2Client(): S3Client {
  if (cachedClient) return cachedClient

  cachedClient = new S3Client({
    region: 'auto',
    endpoint: `https://${getR2AccountId()}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: getR2AccessKeyId(),
      secretAccessKey: getR2SecretAccessKey(),
    },
  })

  return cachedClient
}

export async function uploadToR2(buffer: Buffer, key: string, contentType: string): Promise<string> {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  )

  return key
}

export async function headR2Object(key: string): Promise<{ contentType: string | null; contentLength: number | null }> {
  const response = await getR2Client().send(
    new HeadObjectCommand({
      Bucket: getR2BucketName(),
      Key: key,
    })
  )

  return {
    contentType: response.ContentType ?? null,
    contentLength: typeof response.ContentLength === 'number' ? response.ContentLength : null,
  }
}

export async function getR2ObjectStream(key: string): Promise<{
  stream: Readable
  contentType: string | null
  contentLength: number | null
}> {
  const response = await getR2Client().send(
    new GetObjectCommand({
      Bucket: getR2BucketName(),
      Key: key,
    })
  )

  if (!response.Body) {
    throw new Error('R2 object body is empty')
  }

  return {
    stream: response.Body as unknown as Readable,
    contentType: response.ContentType ?? null,
    contentLength: typeof response.ContentLength === 'number' ? response.ContentLength : null,
  }
}

