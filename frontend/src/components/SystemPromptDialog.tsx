import { useEffect, useState } from 'react'

interface Props {
  open: boolean
  initial: string | null
  saving: boolean
  onClose: () => void
  onSave: (prompt: string) => void
}

export default function SystemPromptDialog({
  open,
  initial,
  saving,
  onClose,
  onSave,
}: Props) {
  const [value, setValue] = useState(initial ?? '')

  useEffect(() => {
    if (open) setValue(initial ?? '')
  }, [open, initial])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-medium text-slate-100">会话人设 / 系统提示词</h2>
        <p className="mt-1 text-xs text-slate-400">
          只影响当前会话；留空则使用全局默认设置。
        </p>

        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={8}
          maxLength={4000}
          placeholder="例如：你是一名严谨的后端工程师，回答尽量给出代码示例。"
          className="mt-4 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={() => onSave(value)}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
