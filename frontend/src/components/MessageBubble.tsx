import { useState } from 'react'
import type { ChatMessage } from '../types'
import { speakWithServer, stopSpeaking, unlockAudio } from '../utils/speech'
import MarkdownView from './MarkdownView'

export default function MessageBubble({
  message,
  voiceType,
}: {
  message: ChatMessage
  voiceType?: string | null
}) {
  const isUser = message.role === 'user'
  const streaming = message.status === 'streaming'
  const [speaking, setSpeaking] = useState(false)
  const [speakError, setSpeakError] = useState<string | null>(null)

  const canSpeak = !isUser && !streaming && !!message.content

  async function toggleSpeak() {
    if (speaking) {
      stopSpeaking()
      setSpeaking(false)
      return
    }
    unlockAudio()
    setSpeakError(null)
    setSpeaking(true)
    const started = await speakWithServer(message.content, voiceType, () =>
      setSpeaking(false),
    )
    if (!started) {
      setSpeaking(false)
      setSpeakError('朗读失败，请检查语音服务或浏览器音量')
    }
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[85%] rounded-2xl px-4 py-3 text-sm',
          isUser
            ? 'rounded-br-sm bg-blue-600 text-white shadow-sm'
            : 'rounded-bl-sm border border-slate-200 bg-white text-slate-800 shadow-sm',
        ].join(' ')}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          <>
            {message.content ? (
              <MarkdownView content={message.content} />
            ) : streaming ? (
              <span className="text-slate-400">思考中…</span>
            ) : null}
            {streaming && message.content && (
              <span className="ml-0.5 inline-block h-3.5 w-[3px] animate-pulse bg-blue-500 align-middle" />
            )}
            {message.reasoning && (
              <details className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-500">
                <summary className="cursor-pointer select-none">思考过程</summary>
                <pre className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap font-sans">
                  {message.reasoning}
                </pre>
              </details>
            )}
            {message.status === 'aborted' && (
              <div className="mt-2 text-xs text-amber-600">已停止生成</div>
            )}
            {message.status === 'error' && (
              <div className="mt-2 text-xs text-red-600">生成失败，请重试</div>
            )}
            {canSpeak && (
              <div className="mt-2">
                <button
                  onClick={toggleSpeak}
                  className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-400 transition hover:border-blue-300 hover:text-blue-600"
                >
                  {speaking ? '停止朗读' : '朗读'}
                </button>
                {speakError && (
                  <div className="mt-1 text-xs text-red-500">{speakError}</div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
