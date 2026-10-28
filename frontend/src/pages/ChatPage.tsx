import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import Composer from '../components/Composer'
import ConversationList from '../components/ConversationList'
import MessageBubble from '../components/MessageBubble'
import ModelSelect from '../components/ModelSelect'
import SystemPromptDialog from '../components/SystemPromptDialog'
import { useAuth } from '../store/auth'
import type { ChatMessage, Conversation, ModelInfo } from '../types'

const errText = (e: unknown) => (e instanceof Error ? e.message : '操作失败')

export default function ChatPage() {
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)

  const [models, setModels] = useState<ModelInfo[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [modelId, setModelId] = useState('')
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [query, setQuery] = useState('')
  const [maxChars, setMaxChars] = useState(8000)
  const [promptOpen, setPromptOpen] = useState(false)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [exporting, setExporting] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const activeIdRef = useRef<number | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  // 首次加载：模型 + 会话 + 第一个会话的消息
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [m, cs, cfg] = await Promise.all([
          api.listModels(),
          api.listConversations(),
          api.getSystemConfig(),
        ])
        if (cancelled) return
        setModels(m.models)
        setConversations(cs)
        setMaxChars(cfg.max_message_chars || 8000)

        if (cs.length > 0) {
          setActiveId(cs[0].id)
          activeIdRef.current = cs[0].id
          setModelId(cs[0].model_id)
          setMessages(await api.listMessages(cs[0].id))
        } else {
          setModelId(m.models.find((x) => x.available)?.id ?? m.models[0]?.id ?? '')
        }
      } catch (e) {
        setError(errText(e))
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 会话搜索：输入停止 250ms 后再请求，避免每个字符都打一次接口
  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(async () => {
      try {
        setConversations(await api.listConversations(query))
      } catch (e) {
        setError(errText(e))
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [query, ready])

  async function openConversation(conv: Conversation) {
    if (streaming) return
    setActiveId(conv.id)
    activeIdRef.current = conv.id
    setModelId(conv.model_id)
    setError(null)
    try {
      setMessages(await api.listMessages(conv.id))
    } catch (e) {
      setError(errText(e))
    }
  }

  async function newConversation() {
    if (streaming) return
    setQuery('')
    try {
      const conv = await api.createConversation(modelId || undefined)
      setConversations((prev) => [conv, ...prev])
      setActiveId(conv.id)
      activeIdRef.current = conv.id
      setMessages([])
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }

  async function removeConversation(conv: Conversation) {
    if (streaming) return
    if (!window.confirm(`确定删除会话「${conv.title}」？`)) return
    try {
      await api.deleteConversation(conv.id)
      const rest = conversations.filter((c) => c.id !== conv.id)
      setConversations(rest)
      if (activeId === conv.id) {
        const next = rest[0] ?? null
        setActiveId(next?.id ?? null)
        activeIdRef.current = next?.id ?? null
        if (next) {
          setModelId(next.model_id)
          setMessages(await api.listMessages(next.id))
        } else {
          setMessages([])
        }
      }
    } catch (e) {
      setError(errText(e))
    }
  }

  async function renameConversation(conv: Conversation) {
    const title = window.prompt('重命名会话', conv.title)?.trim()
    if (!title || title === conv.title) return
    try {
      const updated = await api.updateConversation(conv.id, { title })
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    } catch (e) {
      setError(errText(e))
    }
  }

  async function changeModel(next: string) {
    setModelId(next)
    if (!activeId) return
    try {
      const updated = await api.updateConversation(activeId, { model_id: next })
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    } catch (e) {
      setError(errText(e))
    }
  }

  async function refresh(convId: number) {
    try {
      const [msgs, cs] = await Promise.all([
        api.listMessages(convId),
        api.listConversations(query),
      ])
      if (activeIdRef.current === convId) setMessages(msgs)
      setConversations(cs)
    } catch {
      /* 刷新失败不打断用户 */
    }
  }

  async function saveSystemPrompt(prompt: string) {
    if (!activeId) return
    setSavingPrompt(true)
    setError(null)
    try {
      const updated = await api.updateConversation(activeId, {
        system_prompt: prompt.trim() ? prompt.trim() : null,
      })
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setPromptOpen(false)
    } catch (e) {
      setError(errText(e))
    } finally {
      setSavingPrompt(false)
    }
  }

  async function exportCurrent() {
    if (!activeId || exporting) return
    setExporting(true)
    setError(null)
    try {
      const blob = await api.exportConversation(activeId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${activeConv?.title || 'conversation'}.md`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(errText(e))
    } finally {
      setExporting(false)
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

  async function send() {
    const text = input.trim()
    if (!text || streaming) return

    setError(null)
    setInput('')

    let convId = activeId
    if (!convId) {
      setQuery('')
      try {
        const conv = await api.createConversation(modelId || undefined)
        setConversations((prev) => [conv, ...prev])
        setActiveId(conv.id)
        activeIdRef.current = conv.id
        convId = conv.id
        if (!modelId) setModelId(conv.model_id)
      } catch (e) {
        setError(errText(e))
        setInput(text)
        return
      }
    }

    const now = new Date().toISOString()
    const tempUserId = -Date.now()
    const tempAssistantId = tempUserId - 1

    setMessages((prev) => [
      ...prev,
      {
        id: tempUserId,
        role: 'user',
        content: text,
        model_id: modelId || null,
        status: 'done',
        input_tokens: null,
        output_tokens: null,
        latency_ms: null,
        created_at: now,
      },
      {
        id: tempAssistantId,
        role: 'assistant',
        content: '',
        model_id: modelId || null,
        status: 'streaming',
        input_tokens: null,
        output_tokens: null,
        latency_ms: null,
        created_at: now,
        reasoning: '',
      },
    ])

    const controller = new AbortController()
    abortRef.current = controller
    setStreaming(true)

    try {
      await api.streamChat({
        conversationId: convId,
        content: text,
        modelId: modelId || undefined,
        signal: controller.signal,
        handlers: {
          onDelta: (t) =>
            setMessages((prev) =>
              prev.map((m) => (m.id === tempAssistantId ? { ...m, content: m.content + t } : m)),
            ),
          onReasoning: (t) =>
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAssistantId ? { ...m, reasoning: (m.reasoning ?? '') + t } : m,
              ),
            ),
          onDone: () =>
            setMessages((prev) =>
              prev.map((m) => (m.id === tempAssistantId ? { ...m, status: 'done' } : m)),
            ),
          onError: (err) => {
            setError(`${err.message}（${err.code}）`)
            setMessages((prev) =>
              prev.map((m) => (m.id === tempAssistantId ? { ...m, status: 'error' } : m)),
            )
          },
        },
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempAssistantId ? { ...m, status: 'aborted' } : m)),
        )
      } else {
        setError(errText(e))
        setMessages((prev) =>
          prev.map((m) => (m.id === tempAssistantId ? { ...m, status: 'error' } : m)),
        )
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
      await refresh(convId)
    }
  }

  const stop = () => abortRef.current?.abort()

  const activeConv = conversations.find((c) => c.id === activeId) ?? null
  const currentModel = models.find((m) => m.id === modelId)

  return (
    <div className="flex h-full">
      <ConversationList
        conversations={conversations}
        activeId={activeId}
        userLabel={user?.nickname || user?.username || '未知用户'}
        query={query}
        onQueryChange={setQuery}
        isAdmin={user?.role === 'admin'}
        onSelect={openConversation}
        onNew={newConversation}
        onDelete={removeConversation}
        onRename={renameConversation}
        onLogout={handleLogout}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-100">
              {activeConv?.title ?? '新会话'}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>
                当前模型：
                <span className="text-slate-200">
                  {(currentModel?.name ?? modelId) || '未选择'}
                </span>
              </span>
              {streaming && <span className="animate-pulse text-blue-400">正在生成…</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setPromptOpen(true)}
              disabled={!activeId || streaming}
              className="rounded-lg border border-slate-700 px-2 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 disabled:opacity-40"
            >
              人设
            </button>
            <button
              onClick={exportCurrent}
              disabled={!activeId || exporting}
              className="rounded-lg border border-slate-700 px-2 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 disabled:opacity-40"
            >
              {exporting ? '导出中…' : '导出'}
            </button>
            <ModelSelect
              models={models}
              value={modelId}
              onChange={changeModel}
              disabled={streaming}
            />
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
          {messages.length === 0 && (
            <div className="mt-16 text-center text-sm text-slate-500">
              <p className="mb-2 text-base text-slate-400">开始一段新的对话</p>
              <p>直接在下方输入问题，Enter 发送</p>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          <div ref={bottomRef} />
        </div>

        {error && (
          <div className="mx-4 mb-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <Composer
          value={input}
          onChange={setInput}
          onSend={send}
          onStop={stop}
          streaming={streaming}
          disabled={!ready}
          maxLength={maxChars}
        />
      </main>

      <SystemPromptDialog
        open={promptOpen}
        initial={activeConv?.system_prompt ?? null}
        saving={savingPrompt}
        onClose={() => setPromptOpen(false)}
        onSave={saveSystemPrompt}
      />
    </div>
  )
}
