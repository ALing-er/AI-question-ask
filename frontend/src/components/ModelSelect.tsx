import type { ModelInfo } from '../types'

interface Props {
  models: ModelInfo[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
}

export default function ModelSelect({ models, value, onChange, disabled }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="max-w-52 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none transition hover:border-blue-400 focus:border-blue-500 disabled:opacity-50"
    >
      {models.length === 0 && <option value="">无可用模型</option>}
      {models.map((m) => (
        <option key={m.id} value={m.id} disabled={!m.available}>
          {m.name}
          {m.supports_search ? ' · 联网' : ''}
          {m.available ? '' : '（未配置密钥）'}
        </option>
      ))}
    </select>
  )
}
