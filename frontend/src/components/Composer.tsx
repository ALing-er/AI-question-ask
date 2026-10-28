interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  disabled?: boolean
  maxLength?: number
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
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!streaming) onSend()
    }
  }

  return (
    <div className="border-t border-slate-800 p-3">
      <div className="flex items-end gap-2 rounded-xl border border-slate-700 bg-slate-900 p-2 focus-within:border-blue-500">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={maxLength}
          placeholder="输入问题，Enter 发送，Shift+Enter 换行"
          className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1 text-sm text-slate-100 outline-none placeholder:text-slate-500"
        />
        {streaming ? (
          <button
            onClick={onStop}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500"
          >
            停止
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={disabled || !value.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            发送
          </button>
        )}
      </div>
      <p className="mt-1 px-1 text-xs text-slate-600">
        回答由 AI 生成，可能存在错误，请自行判断。
      </p>
    </div>
  )
}
