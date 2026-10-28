import * as api from '../api'

let audioContext: AudioContext | null = null
let currentSource: AudioBufferSourceNode | null = null

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext || (window as any).webkitAudioContext
  if (!Ctor) return null
  if (!audioContext) {
    audioContext = new Ctor()
  }
  return audioContext
}

/** 必须在用户点击等手势里调用，解锁浏览器音频播放。 */
export function unlockAudio(): void {
  const ctx = getAudioContext()
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume()
  }
}

/** 去掉 Markdown 标记，避免朗读时把符号也读出来。 */
export function plainTextForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' 代码块 ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 浏览器自带 TTS，仅在明确需要兜底时调用。 */
export function speakText(text: string, onEnd?: () => void): boolean {
  if (!speechSupported()) return false
  const clean = plainTextForSpeech(text)
  if (!clean) return false

  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(clean)
  utterance.lang = 'zh-CN'
  utterance.rate = 1
  utterance.onend = () => onEnd?.()
  utterance.onerror = () => onEnd?.()
  window.speechSynthesis.speak(utterance)
  return true
}

/**
 * 用后端百炼 TTS 合成，并通过 Web Audio 播放。
 * 返回 false 表示合成或播放失败，调用方应给出可见错误。
 */
export async function speakWithServer(
  text: string,
  voiceType?: string | null,
  onEnd?: () => void,
): Promise<boolean> {
  stopSpeaking()
  const clean = plainTextForSpeech(text)
  if (!clean) return false

  try {
    unlockAudio()
    const blob = await api.synthesizeSpeech(clean, voiceType)
    const ctx = getAudioContext()
    if (!ctx) return false

    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
    if (ctx.state !== 'running') {
      console.warn('AudioContext 未 running，可能被浏览器自动播放策略拦截')
      return false
    }

    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    currentSource = source
    source.onended = () => {
      if (currentSource === source) currentSource = null
      onEnd?.()
    }
    source.start(0)
    return true
  } catch (error) {
    console.error('TTS playback failed', error)
    return false
  }
}

/** 播放声音设计返回的 base64 预览音频。 */
export function playBase64Audio(base64: string, format = 'wav'): void {
  if (!base64) return
  unlockAudio()
  const mime = format === 'mp3' ? 'audio/mpeg' : 'audio/wav'
  const audio = new Audio(`data:${mime};base64,${base64}`)
  void audio.play().catch((error) => {
    console.error('preview playback failed', error)
  })
}

export function stopSpeaking(): void {
  if (currentSource) {
    try {
      currentSource.stop()
    } catch {
      /* 已结束 */
    }
    currentSource = null
  }
  if (speechSupported()) window.speechSynthesis.cancel()
}
