import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import * as api from '../api'
import { useAuth } from '../store/auth'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const setSession = useAuth((s) => s.setSession)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allowRegistration, setAllowRegistration] = useState(true)

  const from = (location.state as { from?: string } | null)?.from ?? '/'

  useEffect(() => {
    api
      .getSystemConfig()
      .then((cfg) => setAllowRegistration(cfg.allow_registration))
      .catch(() => {
        /* 配置读取失败时保持默认可用 */
      })
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.login(username.trim(), password)
      setSession(res.access_token, res.user)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <h1 className="mb-1 text-xl font-semibold text-slate-900">AI 问答平台</h1>
        <p className="mb-6 text-sm text-slate-500">登录后开始对话</p>

        <label className="mb-1 block text-sm font-medium text-slate-700">用户名</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500"
          placeholder="请输入用户名"
        />

        <label className="mb-1 block text-sm font-medium text-slate-700">密码</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500"
          placeholder="请输入密码"
        />

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !username || !password}
          className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '登录中…' : '登录'}
        </button>

        {allowRegistration ? (
          <p className="mt-5 text-center text-sm text-slate-500">
            还没有账号？
            <Link to="/register" className="ml-1 text-blue-600 hover:underline">
              立即注册
            </Link>
          </p>
        ) : (
          <p className="mt-5 text-center text-sm text-slate-500">当前已关闭注册</p>
        )}
      </form>
    </div>
  )
}
