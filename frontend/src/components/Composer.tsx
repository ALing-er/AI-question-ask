import { useEffect, useRef, useState } from 'react'
import * as api from '../api'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  disabled?: boolean
  maxLength?: number
}

function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || input.length === 0) return input
  const ratio = from / to
  const length = Math.max(1, Math.floor(input.length / ratio))
  const output = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const idx = i * ratio
    const i0 = Math.floor(idx)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = idx - i0
    output[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return output
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }
  return buffer
}

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled,
  maxLength = 8000,
}: Props) {
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)

  const baseValueRef = useRef('')
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const chunksRef = useRef<Float32Array[]>([])

  useEffect(() => {
    return () => {
      cleanupRecording()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function cleanupRecording() {
    try {
      processorRef.current?.disconnect()
      sourceRef.current?.disconnect()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      contextRef.current?.close()
    } catch {
      /* 忽略 */
    }
    processorRef.current = null
    sourceRef.current = null
    streamRef.current = null
    contextRef.current = null
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!streaming && !recording && !transcribing) onSend()
    }
  }

  async function startRecording() {
    if (disabled || streaming || transcribing) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const context = new AudioContext({ sampleRate: 16000 })
      await context.resume()
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(4096, 1, 1)
      const chunks: Float32Array[] = []

      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      }
      source.connect(processor)
      processor.connect(context.destination)

      streamRef.current = stream
      contextRef.current = context
      processorRef.current = processor
      sourceRef.current = source
      chunksRef.current = chunks
      baseValueRef.current = value
      setVoiceError(null)
      setRecording(true)
    } catch {
      setVoiceError('无法访问麦克风，请检查浏览器权限')
    }
  }

  async function stopRecording() {
    const context = contextRef.current
    const sampleRate = context?.sampleRate ?? 16000
    const chunks = chunksRef.current
    setRecording(false)
    cleanupRecording()

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    if (total === 0) {
      setVoiceError('没有录到声音，请重试')
      return
    }

    const merged = new Float32Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }

    setTranscribing(true)
    setVoiceError(null)
    try {
      const audio = resample(merged, sampleRate, 16000)
      const wav = encodeWav(audio, 16000)
      const result = await api.transcribeVoice(new Blob([wav], { type: 'audio/wav' }))
      const text = result.text.trim()
      if (text) {
        const base = baseValueRef.current.trim()
        onChange((base ? `${base} ${text}` : text).slice(0, maxLength))
      } else {
        setVoiceError('没有识别到文字')
      }
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : '语音识别失败')
    } finally {
      setTranscribing(false)
      chunksRef.current = []
    }
  }

  const micClass = recording
    ? 'border-amber-300 bg-amber-50 text-amber-700'
    : 'border-slate-300 text-slate-600 hover:bg-slate-50'

  return (
    <div className="border-t border-slate-200 bg-white p-3">
      <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-2 transition focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={maxLength}
          placeholder="输入问题，Enter 发送，Shift+Enter 换行"
          className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1 text-sm text-slate-900 outline-none placeholder:text-slate-400"
        />
        <button
          type="button"
          onClick={() => (recording ? stopRecording() : startRecording())}
          disabled={disabled || streaming || transcribing}
          title="语音输入"
          className={`rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${micClass}`}
        >
          {recording ? '停止' : transcribing ? '识别中…' : '语音'}
        </button>
        {streaming ? (
          <button
            onClick={onStop}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
          >
            停止
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={disabled || !value.trim() || recording || transcribing}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            发送
          </button>
        )}
      </div>
      {voiceError && <p className="mt-1 px-1 text-xs text-red-600">{voiceError}</p>}
      <p className="mt-1 px-1 text-xs text-slate-400">
        回答由 AI 生成，可能存在错误，请自行判断；语音由百炼 Qwen3 提供。
      </p>
    </div>
  )
}
