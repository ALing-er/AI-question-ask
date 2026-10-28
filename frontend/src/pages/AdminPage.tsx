import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../api'
import { useAuth } from '../store/auth'
import type { AdminStats, AdminUser, AuditLog } from '../types'

const errText = (e: unknown) => (e instanceof Error ? e.message : '操作失败')

export default function AdminPage() {
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)

  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [offset, setOffset] = useState(0)
  const limit = 20

  const [tab, setTab] = useState<'users' | 'audit'>('users')
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [logTotal, setLogTotal] = useState(0)
  const [logQuery, setLogQuery] = useState('')
  const [logOffset, setLogOffset] = useState(0)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .adminStats()
      .then((s) => {
        if (!cancelled) setStats(s)
      })
      .catch((e) => {
        if (!cancelled) setError(errText(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await api.adminListUsers({ q: query, status, limit, offset })
        setUsers(res.items)
        setTotal(res.total)
      } catch (e) {
        setError(errText(e))
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [query, status, offset])

  useEffect(() => {
    if (tab !== 'audit') return
    const timer = setTimeout(async () => {
      try {
        const res = await api.adminAuditLogs({ q: logQuery, limit, offset: logOffset })
        setLogs(res.items)
        setLogTotal(res.total)
      } catch (e) {
        setError(errText(e))
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [tab, logQuery, logOffset])

  async function reload() {
    try {
      const [s, res] = await Promise.all([
        api.adminStats(),
        api.adminListUsers({ q: query, status, limit, offset }),
      ])
      setStats(s)
      setUsers(res.items)
      setTotal(res.total)
    } catch (e) {
      setError(errText(e))
    }
  }

  async function toggleStatus(target: AdminUser) {
    const next = target.status === 'active' ? 'disabled' : 'active'
    const action = next === 'disabled' ? '禁用' : '启用'
    if (!window.confirm(`确定${action}用户「${target.username}」？`)) return
    setError(null)
    setNotice(null)
    try {
      await api.adminUpdateUserStatus(target.id, next)
      setNotice(`已${action} ${target.username}`)
      await reload()
    } catch (e) {
      setError(errText(e))
    }
  }

  async function resetPassword(target: AdminUser) {
    const pwd = window.prompt(`输入「${target.username}」的新密码（至少 8 位）`)
    if (!pwd) return
    if (pwd.length < 8) {
      setError('新密码至少 8 位')
      return
    }
    setError(null)
    setNotice(null)
    try {
      await api.adminResetPassword(target.id, pwd)
      setNotice(`已重置 ${target.username} 的密码，该用户需重新登录`)
      await reload()
    } catch (e) {
      setError(errText(e))
    }
  }

  async function removeUser(target: AdminUser) {
    if (!window.confirm(`确定删除用户「${target.username}」？该操作会使其立即下线。`)) return
    setError(null)
    setNotice(null)
    try {
      await api.adminDeleteUser(target.id)
      setNotice(`已删除 ${target.username}`)
      await reload()
    } catch (e) {
      setError(errText(e))
    }
  }

  async function handleLogout() {
    try {
      await api.logoutApi()
    } catch {
      /* 服务端撤销失败也允许本地登出 */
    }
    logout()
  }

  const page = Math.floor(offset / limit) + 1
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const logPage = Math.floor(logOffset / limit) + 1
  const logTotalPages = Math.max(1, Math.ceil(logTotal / limit))

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-slate-800 px-6 py-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-slate-100">管理后台</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            当前管理员：<span className="text-slate-200">{user?.nickname || user?.username}</span>
          </p>
        </div>
        <Link
          to="/"
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500"
        >
          返回对话
        </Link>
        <button
          onClick={handleLogout}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500"
        >
          退出登录
        </button>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-5">
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {[
            ['用户总数', stats?.total_users ?? 0],
            ['活跃用户', stats?.active_users ?? 0],
            ['停用用户', stats?.disabled_users ?? 0],
            ['会话总数', stats?.total_conversations ?? 0],
            ['消息总数', stats?.total_messages ?? 0],
            ['今日消息', stats?.today_messages ?? 0],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3"
            >
              <div className="text-xs text-slate-400">{label}</div>
              <div className="mt-1 text-xl font-semibold text-slate-100">{value}</div>
            </div>
          ))}
        </section>

        {notice && (
          <div className="mt-4 rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300">
            {notice}
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center gap-2 border-b border-slate-800">
          <button
            onClick={() => setTab('users')}
            className={`px-3 py-2 text-sm transition ${
              tab === 'users'
                ? 'border-b-2 border-blue-500 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            用户管理
          </button>
          <button
            onClick={() => setTab('audit')}
            className={`px-3 py-2 text-sm transition ${
              tab === 'audit'
                ? 'border-b-2 border-blue-500 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            审计日志
          </button>
        </div>

        {tab === 'users' ? (
          <section className="mt-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setOffset(0)
                }}
                placeholder="搜索用户名 / 昵称"
                className="w-56 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-slate-500"
              />
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value)
                  setOffset(0)
                }}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 outline-none"
              >
                <option value="">全部状态</option>
                <option value="active">正常</option>
                <option value="disabled">已停用</option>
              </select>
              <span className="text-xs text-slate-500">
                共 {total} 人{loading ? ' · 加载中…' : ''}
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-900/80 text-xs text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">用户名</th>
                    <th className="px-3 py-2 font-medium">角色</th>
                    <th className="px-3 py-2 font-medium">状态</th>
                    <th className="px-3 py-2 font-medium">会话</th>
                    <th className="px-3 py-2 font-medium">消息</th>
                    <th className="px-3 py-2 font-medium">注册时间</th>
                    <th className="px-3 py-2 font-medium">最后登录</th>
                    <th className="px-3 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isSelf = u.id === user?.id
                    return (
                      <tr key={u.id} className="border-t border-slate-800/80">
                        <td className="px-3 py-2">
                          <div className="text-slate-100">{u.username}</div>
                          {u.nickname && (
                            <div className="text-xs text-slate-500">{u.nickname}</div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs ${
                              u.role === 'admin'
                                ? 'bg-blue-950/60 text-blue-300'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`text-xs ${
                              u.status === 'active' ? 'text-emerald-400' : 'text-amber-400'
                            }`}
                          >
                            {u.status === 'active' ? '正常' : '已停用'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-300">{u.conversation_count}</td>
                        <td className="px-3 py-2 text-slate-300">{u.message_count}</td>
                        <td className="px-3 py-2 text-xs text-slate-400">
                          {new Date(u.created_at).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-400">
                          {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '从未'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            <button
                              onClick={() => toggleStatus(u)}
                              disabled={isSelf}
                              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:border-slate-500 disabled:opacity-40"
                            >
                              {u.status === 'active' ? '禁用' : '启用'}
                            </button>
                            <button
                              onClick={() => resetPassword(u)}
                              disabled={isSelf}
                              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:border-slate-500 disabled:opacity-40"
                            >
                              重置密码
                            </button>
                            <button
                              onClick={() => removeUser(u)}
                              disabled={isSelf || u.role === 'admin'}
                              className="rounded border border-red-900/70 px-2 py-1 text-xs text-red-300 transition hover:border-red-700 disabled:opacity-40"
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {users.length === 0 && !loading && (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-500">
                        没有匹配的用户
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-end gap-2 text-xs text-slate-400">
              <span>
                第 {page} / {totalPages} 页
              </span>
              <button
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0}
                className="rounded border border-slate-700 px-2 py-1 transition hover:border-slate-500 disabled:opacity-40"
              >
                上一页
              </button>
              <button
                onClick={() => setOffset(offset + limit)}
                disabled={offset + limit >= total}
                className="rounded border border-slate-700 px-2 py-1 transition hover:border-slate-500 disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </section>
        ) : (
          <section className="mt-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                value={logQuery}
                onChange={(e) => {
                  setLogQuery(e.target.value)
                  setLogOffset(0)
                }}
                placeholder="搜索操作者 / 动作 / 目标 ID"
                className="w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-slate-500"
              />
              <span className="text-xs text-slate-500">共 {logTotal} 条</span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-slate-900/80 text-xs text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">时间</th>
                    <th className="px-3 py-2 font-medium">操作者</th>
                    <th className="px-3 py-2 font-medium">动作</th>
                    <th className="px-3 py-2 font-medium">目标</th>
                    <th className="px-3 py-2 font-medium">详情</th>
                    <th className="px-3 py-2 font-medium">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-t border-slate-800/80">
                      <td className="px-3 py-2 text-xs text-slate-400">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-slate-200">{log.actor_username}</td>
                      <td className="px-3 py-2 text-xs text-slate-300">{log.action}</td>
                      <td className="px-3 py-2 text-xs text-slate-400">
                        {log.target_type ? `${log.target_type}#${log.target_id ?? '-'}` : '-'}
                      </td>
                      <td className="max-w-[280px] truncate px-3 py-2 text-xs text-slate-400">
                        {log.detail ? JSON.stringify(log.detail) : '-'}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{log.ip ?? '-'}</td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">
                        暂无审计记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-end gap-2 text-xs text-slate-400">
              <span>
                第 {logPage} / {logTotalPages} 页
              </span>
              <button
                onClick={() => setLogOffset(Math.max(0, logOffset - limit))}
                disabled={logOffset === 0}
                className="rounded border border-slate-700 px-2 py-1 transition hover:border-slate-500 disabled:opacity-40"
              >
                上一页
              </button>
              <button
                onClick={() => setLogOffset(logOffset + limit)}
                disabled={logOffset + limit >= logTotal}
                className="rounded border border-slate-700 px-2 py-1 transition hover:border-slate-500 disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
