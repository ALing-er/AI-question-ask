import type {
  AdminStats,
  AdminUserList,
  AuditLogList,
  ChatMessage,
  Conversation,
  ModelInfo,
  SystemConfig,
  TokenResponse,
  UserInfo,
} from './types'

export class ApiError extends Error {
  code: string
  status: number
  requestId?: string

  constructor(message: string, code: string, status: number, requestId?: string) {
    super(message)
    this.code = code
    this.status = status
    this.requestId = requestId
  }
}

const TOKEN_KEY = 'aiqa.token'
const USER_KEY = 'aiqa.user'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export function getStoredUser(): UserInfo | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as UserInfo
  } catch {
    return null
  }
}

export function setStoredUser(user: UserInfo | null): void {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
  else localStorage.removeItem(USER_KEY)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(path, { ...init, headers })
  if (res.status === 204) return undefined as T

  const text = await res.text()
  const data = text ? JSON.parse(text) : null

  if (!res.ok) {
    const err = data?.error ?? {}
    // 401 统一视为登录失效，交给页面跳转
    if (res.status === 401) {
      setToken(null)
      setStoredUser(null)
      window.dispatchEvent(new Event('aiqa:unauthorized'))
    }
    throw new ApiError(err.message ?? '请求失败', err.code ?? 'UNKNOWN', res.status, err.request_id)
  }
  return data as T
}

// ---------------- 认证 ----------------

export const login = (username: string, password: string) =>
  request<TokenResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })

export const register = (username: string, password: string) =>
  request<TokenResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })

export const me = () => request<UserInfo>('/api/auth/me')

export const logoutApi = () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })

// ---------------- 模型 / 会话 ----------------

export const listModels = () => request<{ models: ModelInfo[] }>('/api/models')

export const getSystemConfig = () => request<SystemConfig>('/api/system/config')

export const listConversations = (q?: string) => {
  const query = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''
  return request<Conversation[]>(`/api/conversations${query}`)
}

export const createConversation = (modelId?: string) =>
  request<Conversation>('/api/conversations', {
    method: 'POST',
    body: JSON.stringify(modelId ? { model_id: modelId } : {}),
  })

export const updateConversation = (
  id: number,
  patch: { title?: string; model_id?: string; system_prompt?: string | null },
) =>
  request<Conversation>(`/api/conversations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const deleteConversation = (id: number) =>
  request<void>(`/api/conversations/${id}`, { method: 'DELETE' })

export const listMessages = (id: number) =>
  request<ChatMessage[]>(`/api/conversations/${id}/messages`)

export async function exportConversation(id: number): Promise<Blob> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`/api/conversations/${id}/export`, { headers })
  if (!res.ok) {
    const text = await res.text()
    let err: Record<string, unknown> = {}
    try {
      err = JSON.parse(text)?.error ?? {}
    } catch {
      /* 忽略 */
    }
    throw new ApiError(
      (err.message as string) ?? '导出失败',
      (err.code as string) ?? 'UNKNOWN',
      res.status,
      err.request_id as string | undefined,
    )
  }
  return res.blob()
}

// ---------------- 管理后台 ----------------

export const adminListUsers = (params: {
  q?: string
  status?: string
  limit?: number
  offset?: number
} = {}) => {
  const sp = new URLSearchParams()
  if (params.q?.trim()) sp.set('q', params.q.trim())
  if (params.status) sp.set('status', params.status)
  if (params.limit != null) sp.set('limit', String(params.limit))
  if (params.offset != null) sp.set('offset', String(params.offset))
  return request<AdminUserList>(`/api/admin/users?${sp.toString()}`)
}

export const adminUpdateUserStatus = (id: number, status: 'active' | 'disabled') =>
  request<{ ok: boolean; status: string }>(`/api/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })

export const adminResetPassword = (id: number, newPassword: string) =>
  request<{ ok: boolean }>(`/api/admin/users/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ new_password: newPassword }),
  })

export const adminDeleteUser = (id: number) =>
  request<void>(`/api/admin/users/${id}`, { method: 'DELETE' })

export const adminStats = () => request<AdminStats>('/api/admin/stats')

export const adminAuditLogs = (params: {
  q?: string
  limit?: number
  offset?: number
} = {}) => {
  const sp = new URLSearchParams()
  if (params.q?.trim()) sp.set('q', params.q.trim())
  if (params.limit != null) sp.set('limit', String(params.limit))
  if (params.offset != null) sp.set('offset', String(params.offset))
  return request<AuditLogList>(`/api/admin/audit-logs?${sp.toString()}`)
}

// ---------------- 流式对话 ----------------

export interface StreamHandlers {
  onMeta?: (data: { message_id: number; conversation_id: number; model_id: string }) => void
  onDelta?: (text: string) => void
  onReasoning?: (text: string) => void
  onUsage?: (usage: { input_tokens: number; output_tokens: number }) => void
  onDone?: (data: { finish_reason: string }) => void
  onError?: (err: { code: string; message: string }) => void
}

/**
 * 用 fetch 读 SSE（EventSource 只支持 GET，带不了请求体）。
 * 后端事件：meta / delta / reasoning / usage / done / error
 */
export async function streamChat(params: {
  conversationId: number
  content: string
  modelId?: string
  signal: AbortSignal
  handlers: StreamHandlers
}): Promise<void> {
  const { conversationId, content, modelId, signal, handlers } = params
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({ conversation_id: conversationId, content, model_id: modelId }),
  })

  if (!res.ok) {
    const text = await res.text()
    let err: Record<string, unknown> = {}
    try {
      err = JSON.parse(text)?.error ?? {}
    } catch {
      /* 忽略 */
    }
    throw new ApiError(
      (err.message as string) ?? '对话失败',
      (err.code as string) ?? 'UNKNOWN',
      res.status,
      err.request_id as string | undefined,
    )
  }
  if (!res.body) throw new ApiError('连接异常', 'NO_BODY', 0)

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const dispatch = (event: string, data: any) => {
    switch (event) {
      case 'meta':
        handlers.onMeta?.(data)
        break
      case 'delta':
        handlers.onDelta?.(data.text ?? '')
        break
      case 'reasoning':
        handlers.onReasoning?.(data.text ?? '')
        break
      case 'usage':
        handlers.onUsage?.(data)
        break
      case 'done':
        handlers.onDone?.(data)
        break
      case 'error':
        handlers.onError?.(data)
        break
      default:
        break
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

    let idx = buffer.indexOf('\n\n')
    while (idx !== -1) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)

      let event = 'message'
      const dataLines: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (dataLines.length > 0) {
        try {
          dispatch(event, JSON.parse(dataLines.join('\n')))
        } catch {
          /* 半个包，忽略 */
        }
      }
      idx = buffer.indexOf('\n\n')
    }
  }
}
