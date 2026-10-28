import type { ChatMessage } from '../types'
import MarkdownView from './MarkdownView'

export default function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const streaming = message.status === 'streaming'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm',
          isUser
            ? 'rounded-br-sm bg-blue-600 text-white'
            : 'rounded-bl-sm border border-slate-800 bg-slate-800/60 text-slate-100',
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
              <span className="ml-0.5 inline-block h-3.5 w-[3px] animate-pulse bg-slate-300 align-middle" />
            )}
            {message.reasoning && (
              <details className="mt-2 rounded-lg bg-slate-900/60 px-2 py-1 text-xs text-slate-400">
                <summary className="cursor-pointer select-none">思考过程</summary>
                <pre className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap font-sans">
                  {message.reasoning}
                </pre>
              </details>
            )}
            {message.status === 'aborted' && (
              <div className="mt-2 text-xs text-amber-400">已停止生成</div>
            )}
            {message.status === 'error' && (
              <div className="mt-2 text-xs text-red-400">生成失败，请重试</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
