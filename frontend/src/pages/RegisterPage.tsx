import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as api from '../api'
import { useAuth } from '../store/auth'

export default function RegisterPage() {
  const navigate = useNavigate()
  const setSession = useAuth((s) => s.setSession)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allowRegistration, setAllowRegistration] = useState<boolean | null>(null)

  useEffect(() => {
    api
      .getSystemConfig()
      .then((cfg) => setAllowRegistration(cfg.allow_registration))
      .catch(() => setAllowRegistration(true))
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await api.register(username.trim(), password)
      setSession(res.access_token, res.user)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败')
    } finally {
      setLoading(false)
    }
  }

  if (allowRegistration === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        正在加载…
      </div>
    )
  }

  if (!allowRegistration) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="mb-2 text-xl font-semibold text-slate-900">注册已关闭</h1>
          <p className="mb-5 text-sm text-slate-500">当前平台不开放自助注册。</p>
          <Link to="/login" className="text-sm text-blue-600 hover:underline">
            返回登录
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <h1 className="mb-1 text-xl font-semibold text-slate-900">创建账号</h1>
        <p className="mb-6 text-sm text-slate-500">注册后自动登录</p>

        <label className="mb-1 block text-sm font-medium text-slate-700">用户名</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="mb-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500"
          placeholder="3-20 位字母、数字或下划线"
        />
        <p className="mb-4 text-xs text-slate-500">只能用字母、数字、下划线，3-20 位</p>

        <label className="mb-1 block text-sm font-medium text-slate-700">密码</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          className="mb-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500"
          placeholder="至少 8 位"
        />
        <p className="mb-4 text-xs text-slate-500">至少 8 位</p>

        <label className="mb-1 block text-sm font-medium text-slate-700">确认密码</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500"
          placeholder="再输一次"
        />

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !username || !password || !confirm}
          className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '注册中…' : '注册'}
        </button>

        <p className="mt-5 text-center text-sm text-slate-500">
          已有账号？
          <Link to="/login" className="ml-1 text-blue-600 hover:underline">
            去登录
          </Link>
        </p>
      </form>
    </div>
  )
}
