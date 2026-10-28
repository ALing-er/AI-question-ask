import { useEffect, useRef, useState } from 'react'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  disabled?: boolean
  maxLength?: number
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
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
  const [listening, setListening] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const baseValueRef = useRef('')

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop()
      } catch {
        /* 忽略 */
      }
    }
  }, [])

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!streaming) onSend()
    }
  }

  function toggleVoice() {
    if (disabled || streaming) return
    if (listening) {
      recognitionRef.current?.stop()
      return
    }

    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setVoiceError('当前浏览器不支持语音输入，请使用 Edge 或 Chrome')
      return
    }

    const recognition: SpeechRecognitionLike = new SR()
    recognition.lang = 'zh-CN'
    recognition.continuous = false
    recognition.interimResults = true
    baseValueRef.current = value

    recognition.onresult = (event: any) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      onChange((baseValueRef.current + transcript).slice(0, maxLength))
    }
    recognition.onerror = (event: any) => {
      const messages: Record<string, string> = {
        'not-allowed': '麦克风权限被拒绝，请在浏览器设置中允许',
        'no-speech': '没有听到声音，请重试',
        network: '语音识别网络异常',
      }
      setVoiceError(messages[event.error] ?? '语音识别失败，请重试')
      setListening(false)
    }
    recognition.onend = () => setListening(false)

    recognitionRef.current = recognition
    setVoiceError(null)
    setListening(true)
    try {
      recognition.start()
    } catch {
      setVoiceError('语音输入启动失败，请检查麦克风权限')
      setListening(false)
    }
  }

  const micClass = listening
    ? 'border-blue-300 bg-blue-50 text-blue-700'
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
          onClick={toggleVoice}
          disabled={disabled || streaming}
          title="语音输入"
          className={`rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${micClass}`}
        >
          {listening ? '停止' : '语音'}
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
            disabled={disabled || !value.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            发送
          </button>
        )}
      </div>
      {voiceError && <p className="mt-1 px-1 text-xs text-red-600">{voiceError}</p>}
      <p className="mt-1 px-1 text-xs text-slate-400">
        回答由 AI 生成，可能存在错误，请自行判断。
      </p>
    </div>
  )
}
