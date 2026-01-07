import * as sdk from 'microsoft-cognitiveservices-speech-sdk'
import { asRecord, getOptionalString } from '../utils/parse'

export type AzureTtsResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 500; body: Record<string, unknown> }

export async function handleAzureTts(body: unknown): Promise<AzureTtsResponse> {
  try {
    const record = asRecord(body) ?? {}
    const text = getOptionalString(record, 'text') || ''
    const language = getOptionalString(record, 'language') || 'en-US'
    const requestedVoice = getOptionalString(record, 'voice') || ''
    const rate = getOptionalString(record, 'rate') || 'medium'
    const pitch = getOptionalString(record, 'pitch') || 'medium'

    if (!text) {
      return { status: 400, body: { error: 'Text is required' } }
    }

    const subscriptionKey = process.env.AZURE_SPEECH_KEY
    const region = process.env.AZURE_SPEECH_REGION

    if (!subscriptionKey || !region) {
      console.error('[Azure TTS] Missing credentials')
      return { status: 500, body: { error: 'Azure Speech credentials not configured' } }
    }

    const voiceMap: Record<string, string> = {
      zh: 'zh-CN-XiaoxiaoNeural',
      'zh-CN': 'zh-CN-XiaoxiaoNeural',
      'zh-TW': 'zh-TW-HsiaoChenNeural',
      en: 'en-US-JennyNeural',
      'en-US': 'en-US-JennyNeural',
      es: 'es-ES-ElviraNeural',
      'es-ES': 'es-ES-ElviraNeural',
      fr: 'fr-FR-DeniseNeural',
      'fr-FR': 'fr-FR-DeniseNeural',
    }

    const trimmedVoice = requestedVoice.trim()
    const safeVoice =
      trimmedVoice && /^[A-Za-z0-9-]+$/.test(trimmedVoice) ? trimmedVoice : null

    const voiceName = safeVoice || voiceMap[language] || voiceMap.en

    const rateMap: Record<string, string> = {
      slow: '-20%',
      medium: '0%',
      fast: '+20%',
    }
    const rateValue = rateMap[rate] || '0%'

    const pitchMap: Record<string, string> = {
      low: '-10%',
      medium: '0%',
      high: '+10%',
    }
    const pitchValue = pitchMap[pitch] || '0%'

    const escapeSsml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')

    const ssmlText = escapeSsml(text)

    const ssml = `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${language}">
        <voice name="${voiceName}">
          <prosody rate="${rateValue}" pitch="${pitchValue}">
            ${ssmlText}
          </prosody>
        </voice>
      </speak>
    `.trim()

    const speechConfig = sdk.SpeechConfig.fromSubscription(subscriptionKey, region)
    speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Raw24Khz16BitMonoPcm

    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, undefined)

    return await new Promise<AzureTtsResponse>((resolve) => {
      synthesizer.speakSsmlAsync(
        ssml,
        (result) => {
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            const audioData = result.audioData
            synthesizer.close()

            const base64Audio = Buffer.from(audioData).toString('base64')

            resolve({
              status: 200,
              body: {
                success: true,
                audio: base64Audio,
                format: 'raw24khz16bitmon',
                size: audioData.byteLength,
              },
            })
            return
          }

          synthesizer.close()
          console.error('[Azure TTS] Synthesis failed:', result.errorDetails)
          resolve({ status: 500, body: { error: `Speech synthesis failed: ${result.errorDetails}` } })
        },
        (error) => {
          synthesizer.close()
          console.error('[Azure TTS] Error:', error)
          resolve({ status: 500, body: { error: `Speech synthesis error: ${String(error)}` } })
        }
      )
    })
  } catch (error) {
    console.error('[Azure TTS] Request error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { status: 500, body: { error: message } }
  }
}
