import * as sdk from 'microsoft-cognitiveservices-speech-sdk'
import { getOptionalString } from '../utils/parse'

export type AzureSpeechRecognizeResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 500; body: Record<string, unknown> }

function mapLocaleToSpeechLanguage(locale: string): string {
  const map: Record<string, string> = {
    zh: 'zh-CN',
    'zh-CN': 'zh-CN',
    es: 'es-ES',
    'es-ES': 'es-ES',
    fr: 'fr-FR',
    'fr-FR': 'fr-FR',
  }
  return map[locale] || 'en-US'
}

export async function handleAzureSpeechRecognize(params: {
  audioFile: File
  locale?: string
}): Promise<AzureSpeechRecognizeResponse> {
  try {
    if (!params.audioFile) {
      return { status: 400, body: { error: 'No audio file provided' } }
    }

    const subscriptionKey = process.env.AZURE_SPEECH_KEY
    const region = process.env.AZURE_SPEECH_REGION

    if (!subscriptionKey || !region) {
      return { status: 500, body: { error: 'Azure Speech credentials not configured' } }
    }

    const locale = getOptionalString({ locale: params.locale }, 'locale') || 'en-US'

    const audioBuffer = Buffer.from(await params.audioFile.arrayBuffer())

    const speechConfig = sdk.SpeechConfig.fromSubscription(subscriptionKey, region)
    speechConfig.speechRecognitionLanguage = mapLocaleToSpeechLanguage(locale)

    const audioFormat = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1)
    const pushStream = sdk.AudioInputStream.createPushStream(audioFormat)
    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream)

    const slice = audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength)
    pushStream.write(slice)
    pushStream.close()

    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig)

    return await new Promise<AzureSpeechRecognizeResponse>((resolve) => {
      recognizer.recognizeOnceAsync(
        (result) => {
          if (result.reason === sdk.ResultReason.RecognizedSpeech) {
            resolve({
              status: 200,
              body: {
                transcript: result.text,
                confidence: result.properties?.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult),
              },
            })
          } else if (result.reason === sdk.ResultReason.NoMatch) {
            resolve({ status: 200, body: { transcript: '', error: 'No speech could be recognized' } })
          } else {
            resolve({ status: 200, body: { transcript: '', error: 'Speech recognition failed' } })
          }
          recognizer.close()
        },
        (err) => {
          console.error('Recognition error:', err)
          resolve({
            status: 500,
            body: { error: 'Speech recognition error', details: String(err) },
          })
          recognizer.close()
        }
      )
    })
  } catch (error) {
    console.error('Azure Speech API error:', error)
    return { status: 500, body: { error: 'Internal server error' } }
  }
}

