import { useEffect, useState } from 'react'
import type { Persona, VoiceDesignResponse, VoiceOption } from '../types'
import { playBase64Audio } from '../utils/speech'

interface Props {
  open: boolean
  initialPrompt: string | null
  initialVoiceType: string | null
  initialVoicePrompt: string | null
  personas: Persona[]
  defaultVoice: VoiceOption | null
  voices: VoiceOption[]
  saving: boolean
  onClose: () => void
  onBeautify: (prompt: string) => Promise<string | null>
  onBeautifyVoice: (rolePrompt: string, currentPrompt: string) => Promise<string | null>
  onDesignVoice: (
    name: string,
    prompt: string,
  ) => Promise<VoiceDesignResponse | null>
  onApply: (
    name: string,
    prompt: string,
    personaId: number | null,
    voiceType: string | null,
    voicePrompt: string | null,
  ) => void
  onDelete: (persona: Persona) => void
}

export default function PersonaDialog({
  open,
  initialPrompt,
  initialVoiceType,
  initialVoicePrompt,
  personas,
  defaultVoice,
  voices,
  saving,
  onClose,
  onBeautify,
  onBeautifyVoice,
  onDesignVoice,
  onApply,
  onDelete,
}: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [name, setName] = useState('自定义角色')
  const [prompt, setPrompt] = useState('')
  const [voiceType, setVoiceType] = useState('')
  const [voicePrompt, setVoicePrompt] = useState('')
  const [beautifying, setBeautifying] = useState(false)
  const [beautifyingVoice, setBeautifyingVoice] = useState(false)
  const [designing, setDesigning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const defaultVoiceValue = defaultVoice?.value ?? ''

  useEffect(() => {
    if (!open) return
    const matched = personas.find((p) => p.prompt === (initialPrompt ?? ''))
    if (matched) {
      setSelectedId(matched.id)
      setName(matched.name)
      setPrompt(matched.prompt)
      setVoiceType(
        matched.voice_type === defaultVoiceValue ? '' : matched.voice_type ?? '',
      )
      setVoicePrompt(matched.voice_prompt ?? '')
    } else {
      setSelectedId(null)
      setName('自定义角色')
      setPrompt(initialPrompt ?? '')
      setVoiceType(
        initialVoiceType === defaultVoiceValue ? '' : initialVoiceType ?? '',
      )
      setVoicePrompt(initialVoicePrompt ?? '')
    }
    setError(null)
  }, [
    open,
    initialPrompt,
    initialVoiceType,
    initialVoicePrompt,
    personas,
    defaultVoiceValue,
  ])

  if (!open) return null

  const selectedPersona = personas.find((p) => p.id === selectedId) ?? null

  function selectPersona(value: string) {
    if (!value) {
      setSelectedId(null)
      setName('自定义角色')
      setVoiceType('')
      setVoicePrompt('')
      return
    }
    const persona = personas.find((p) => p.id === Number(value))
    if (!persona) return
    setSelectedId(persona.id)
    setName(persona.name)
    setPrompt(persona.prompt)
    setVoiceType(
      persona.voice_type === defaultVoiceValue ? '' : persona.voice_type ?? '',
    )
    setVoicePrompt(persona.voice_prompt ?? '')
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

  async function beautifyVoice() {
    const roleText = prompt.trim()
    if (!roleText) {
      setError('请先填写角色提示词，再生成音色描述')
      return
    }
    setBeautifyingVoice(true)
    setError(null)
    try {
      const result = await onBeautifyVoice(roleText, voicePrompt.trim())
      if (result) {
        setVoicePrompt(result.slice(0, 500))
      } else {
        setError('音色描述生成失败，请稍后重试')
      }
    } finally {
      setBeautifyingVoice(false)
    }
  }

  async function createVoice() {
    const text = voicePrompt.trim()
    if (!text) {
      setError('请先填写或生成音色提示词')
      return
    }
    setDesigning(true)
    setError(null)
    try {
      const result = await onDesignVoice(name.trim() || '自定义音色', text)
      if (!result) {
        setError('自定义音色生成失败，请稍后重试')
        return
      }
      setVoiceType(result.voice.value)
      playBase64Audio(result.preview_audio, result.preview_format)
    } finally {
      setDesigning(false)
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
    onApply(
      finalName,
      finalPrompt,
      selectedId,
      voiceType || null,
      voicePrompt.trim() || null,
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
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

        <div className="mt-4">
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
            rows={6}
            maxLength={4000}
            placeholder="例如：你是一名有十年经验的后端工程师，回答要严谨，先给结论，再给代码和边界条件。"
            className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500"
          />
          <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
            <span>美化会调用大模型，结果可以继续手动修改。</span>
            <span>{prompt.length}/4000</span>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-sm font-medium text-slate-700">音色</label>
              <select
                value={voiceType}
                onChange={(e) => setVoiceType(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500"
              >
                <option value="">
                  默认音色（{defaultVoice?.label ?? 'Cherry'}）
                </option>
                {voices.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}（自定义）
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={beautifyVoice}
              disabled={beautifyingVoice || designing || saving || !prompt.trim()}
              className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-medium text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {beautifyingVoice ? '生成中…' : '根据角色生成音色描述'}
            </button>
          </div>

          <label className="mb-1 mt-3 block text-sm font-medium text-slate-700">
            音色提示词
          </label>
          <textarea
            value={voicePrompt}
            onChange={(e) => setVoicePrompt(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="例如：女性，语速中等偏快，音色清亮，语气温和但有力量。"
            className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500"
          />
          <p className="mt-1 text-xs text-slate-400">
            音色提示词最多 500 字；点底部「生成自定义音色」后会自动试听并选中。
          </p>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="sticky bottom-0 z-10 mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white pt-4">
          <div className="flex flex-wrap items-center gap-2">
            {selectedPersona && (
              <button
                onClick={() => onDelete(selectedPersona)}
                disabled={saving}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                删除该角色
              </button>
            )}
            <button
              onClick={createVoice}
              disabled={designing || saving || !voicePrompt.trim()}
              className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-sm text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {designing ? '生成音色中…' : '生成自定义音色'}
            </button>
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
              disabled={saving || beautifying || beautifyingVoice || designing}
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
