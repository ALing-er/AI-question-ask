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
      className="max-w-52 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 outline-none transition hover:border-slate-500 disabled:opacity-50"
    >
      {models.length === 0 && <option value="">无可用模型</option>}
      {models.map((m) => (
        <option key={m.id} value={m.id} disabled={!m.available}>
          {m.name}
          {m.available ? '' : '（未配置密钥）'}
        </option>
      ))}
    </select>
  )
}
