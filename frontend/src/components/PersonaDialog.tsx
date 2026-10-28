import { useEffect, useState } from 'react'
import type { Persona } from '../types'

interface Props {
  open: boolean
  initialPrompt: string | null
  personas: Persona[]
  saving: boolean
  onClose: () => void
  onBeautify: (prompt: string) => Promise<string | null>
  onApply: (name: string, prompt: string, personaId: number | null) => void
  onDelete: (persona: Persona) => void
}

export default function PersonaDialog({
  open,
  initialPrompt,
  personas,
  saving,
  onClose,
  onBeautify,
  onApply,
  onDelete,
}: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [name, setName] = useState('自定义角色')
  const [prompt, setPrompt] = useState('')
  const [beautifying, setBeautifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const matched = personas.find((p) => p.prompt === (initialPrompt ?? ''))
    if (matched) {
      setSelectedId(matched.id)
      setName(matched.name)
      setPrompt(matched.prompt)
    } else {
      setSelectedId(null)
      setName('自定义角色')
      setPrompt(initialPrompt ?? '')
    }
    setError(null)
  }, [open, initialPrompt, personas])

  if (!open) return null

  const selectedPersona = personas.find((p) => p.id === selectedId) ?? null

  function selectPersona(value: string) {
    if (!value) {
      setSelectedId(null)
      setName('自定义角色')
      return
    }
    const persona = personas.find((p) => p.id === Number(value))
    if (!persona) return
    setSelectedId(persona.id)
    setName(persona.name)
    setPrompt(persona.prompt)
    setError(null)
  }

  async function beautify() {
    const text = prompt.trim()
    if (!text) {
      setError('请先输入角色描述')
      return
    }
    setBeautifying(true)
    setError(null)
    try {
      const result = await onBeautify(text)
      if (result) {
        setPrompt(result)
      } else {
        setError('美化失败，请稍后重试')
      }
    } finally {
      setBeautifying(false)
    }
  }

  function apply() {
    const finalName = name.trim()
    const finalPrompt = prompt.trim()
    if (!finalName) {
      setError('请填写角色名称')
      return
    }
    if (!finalPrompt) {
      setError('请填写角色提示词')
      return
    }
    onApply(finalName, finalPrompt, selectedId)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">角色设定</h2>
            <p className="mt-1 text-sm text-slate-500">
              写一段角色描述，可以让大模型帮你美化成更完整的系统提示词。
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        {personas.length > 0 && (
          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              使用已保存角色
            </label>
            <select
              value={selectedId ?? ''}
              onChange={(e) => selectPersona(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
            >
              <option value="">＋ 新建角色</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-slate-700">角色名称</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500"
            placeholder="例如：严谨的后端工程师"
          />
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <div className="mb-1 flex items-center justify-between gap-3">
            <label className="block text-sm font-medium text-slate-700">角色提示词</label>
            <button
              onClick={beautify}
              disabled={beautifying || saving || !prompt.trim()}
              className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {beautifying ? '美化中…' : '美化提示词'}
            </button>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={10}
            maxLength={4000}
            placeholder="例如：你是一名有十年经验的后端工程师，回答要严谨，先给结论，再给代码和边界条件。"
            className="min-h-48 w-full flex-1 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500"
          />
          <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
            <span>美化会调用大模型，结果可以继续手动修改。</span>
            <span>{prompt.length}/4000</span>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            {selectedPersona && (
              <button
                onClick={() => onDelete(selectedPersona)}
                disabled={saving}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                删除该角色
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={apply}
              disabled={saving || beautifying}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存并应用'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
