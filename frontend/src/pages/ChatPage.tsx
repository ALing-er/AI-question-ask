import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import Composer from '../components/Composer'
import ConversationList from '../components/ConversationList'
import MessageBubble from '../components/MessageBubble'
import ModelSelect from '../components/ModelSelect'
import PersonaDialog from '../components/PersonaDialog'
import { useAuth } from '../store/auth'
import type {
  ChatMessage,
  Conversation,
  ModelInfo,
  Persona,
  VoiceDesignResponse,
  VoiceOption,
} from '../types'
import { speakWithServer, stopSpeaking, unlockAudio } from '../utils/speech'

const errText = (e: unknown) => (e instanceof Error ? e.message : '操作失败')

const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

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
  const [personas, setPersonas] = useState<Persona[]>([])
  const [defaultVoice, setDefaultVoice] = useState<VoiceOption | null>(null)
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [personaOpen, setPersonaOpen] = useState(false)
  const [savingPersona, setSavingPersona] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [autoRead, setAutoRead] = useState(false)
  const [webSearch, setWebSearch] = useState(true)
  const [contextInfo, setContextInfo] = useState<{
    tokens: number
    summarized: number
  } | null>(null)

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
        const [m, cs, cfg, ps, vs] = await Promise.all([
          api.listModels(),
          api.listConversations(),
          api.getSystemConfig(),
          api.listPersonas().catch(() => [] as Persona[]),
          api.listVoices().catch(() => ({
            default_voice: null as unknown as VoiceOption,
            voices: [] as VoiceOption[],
          })),
        ])
        if (cancelled) return
        setModels(m.models)
        setConversations(cs)
        setMaxChars(cfg.max_message_chars || 8000)
        setPersonas(ps)
        setDefaultVoice(vs.default_voice ?? null)
        setVoices(vs.voices)

        if (cs.length > 0) {
          setActiveId(cs[0].id)
          activeIdRef.current = cs[0].id
          setModelId(cs[0].model_id)
          setMessages(await api.listMessages(cs[0].id))
        } else {
          // 优先用后端配置的默认模型（百炼带联网搜索），别退化到无搜索能力的模型
          const pick =
            m.models.find((x) => x.available && x.is_default) ??
            m.models.find((x) => x.available && x.supports_search) ??
            m.models.find((x) => x.available) ??
            m.models[0]
          setModelId(pick?.id ?? '')
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

  useEffect(() => {
    return () => stopSpeaking()
  }, [])

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
    stopSpeaking()
    setActiveId(conv.id)
    activeIdRef.current = conv.id
    setModelId(conv.model_id)
    setError(null)
    setContextInfo(null)
    try {
      setMessages(await api.listMessages(conv.id))
    } catch (e) {
      setError(errText(e))
    }
  }

  async function newConversation() {
    if (streaming) return
    stopSpeaking()
    setQuery('')
    try {
      const conv = await api.createConversation(modelId || undefined)
      setConversations((prev) => [conv, ...prev])
      setActiveId(conv.id)
      activeIdRef.current = conv.id
      setMessages([])
      setError(null)
      setContextInfo(null)
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
        setContextInfo(null)
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

  async function beautifyPrompt(prompt: string): Promise<string | null> {
    try {
      const res = await api.beautifyPersonaPrompt(prompt)
      return res.prompt
    } catch (e) {
      setError(errText(e))
      return null
    }
  }

  async function designVoice(
    name: string,
    prompt: string,
  ): Promise<VoiceDesignResponse | null> {
    try {
      const res = await api.designVoice({ name, prompt })
      setVoices((prev) => [
        res.voice,
        ...prev.filter((v) => v.value !== res.voice.value),
      ])
      return res
    } catch (e) {
      setError(errText(e))
      return null
    }
  }

  async function beautifyVoicePrompt(
    rolePrompt: string,
    currentPrompt: string,
  ): Promise<string | null> {
    try {
      const res = await api.beautifyVoicePrompt(rolePrompt, currentPrompt)
      return res.prompt
    } catch (e) {
      setError(errText(e))
      return null
    }
  }

  async function applyPersona(
    name: string,
    prompt: string,
    personaId: number | null,
    voiceType: string | null,
    voicePrompt: string | null,
  ) {
    setSavingPersona(true)
    setError(null)
    try {
      let convId = activeId
      if (!convId) {
        const conv = await api.createConversation(modelId || undefined)
        setConversations((prev) => [conv, ...prev])
        setActiveId(conv.id)
        activeIdRef.current = conv.id
        setMessages([])
        setQuery('')
        if (!modelId) setModelId(conv.model_id)
        convId = conv.id
      }

      const saved = personaId
        ? await api.updatePersona(personaId, {
            name,
            prompt,
            voice_type: voiceType,
            voice_prompt: voicePrompt,
          })
        : await api.createPersona({
            name,
            prompt,
            voice_type: voiceType,
            voice_prompt: voicePrompt,
          })
      const updated = await api.updateConversation(convId, {
        system_prompt: saved.prompt,
        voice_type: saved.voice_type,
        voice_prompt: saved.voice_prompt,
      })
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setPersonas((prev) => {
        const exists = prev.some((p) => p.id === saved.id)
        return exists
          ? prev.map((p) => (p.id === saved.id ? saved : p))
          : [saved, ...prev]
      })
      setPersonaOpen(false)
    } catch (e) {
      setError(errText(e))
    } finally {
      setSavingPersona(false)
    }
  }

  async function removePersona(persona: Persona) {
    if (!window.confirm(`确定删除角色「${persona.name}」？`)) return
    try {
      await api.deletePersona(persona.id)
      setPersonas((prev) => prev.filter((p) => p.id !== persona.id))
    } catch (e) {
      setError(errText(e))
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

    stopSpeaking()
    unlockAudio()
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

    let answerText = ''

    try {
      await api.streamChat({
        conversationId: convId,
        content: text,
        modelId: modelId || undefined,
        webSearch,
        signal: controller.signal,
        handlers: {
          onMeta: (meta) =>
            setContextInfo({
              tokens: meta.context_tokens ?? 0,
              summarized: meta.summarized_messages ?? 0,
            }),
          onDelta: (t) => {
            answerText += t
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAssistantId ? { ...m, content: m.content + t } : m,
              ),
            )
          },
          onReasoning: (t) =>
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAssistantId ? { ...m, reasoning: (m.reasoning ?? '') + t } : m,
              ),
            ),
          onDone: () => {
            setMessages((prev) =>
              prev.map((m) => (m.id === tempAssistantId ? { ...m, status: 'done' } : m)),
            )
            if (autoRead && answerText) {
              void speakWithServer(answerText, activeConv?.voice_type ?? null).then(
                (ok) => {
                  if (!ok) setError('自动朗读失败，请检查语音服务或浏览器音量')
                },
              )
            }
          },
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
    <div className="flex h-full bg-white">
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
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-900">
              {activeConv?.title ?? '新会话'}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span>
                当前模型：
                <span className="text-slate-700">
                  {(currentModel?.name ?? modelId) || '未选择'}
                </span>
              </span>
              {contextInfo && contextInfo.tokens > 0 && (
                <span className="text-slate-400">
                  上下文 ≈ {fmtTokens(contextInfo.tokens)} tokens
                  {contextInfo.summarized > 0
                    ? `（已压缩 ${contextInfo.summarized} 条）`
                    : ''}
                </span>
              )}
              {streaming && <span className="animate-pulse text-blue-600">正在生成…</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setPersonaOpen(true)}
              disabled={streaming}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 transition hover:border-blue-400 hover:text-blue-600 disabled:opacity-40"
            >
              角色
            </button>
            <button
              onClick={exportCurrent}
              disabled={!activeId || exporting}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 transition hover:border-blue-400 hover:text-blue-600 disabled:opacity-40"
            >
              {exporting ? '导出中…' : '导出'}
            </button>
            <button
              onClick={() => {
                unlockAudio()
                if (autoRead) stopSpeaking()
                setAutoRead((v) => !v)
              }}
              aria-pressed={autoRead}
              className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
                autoRead
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              自动朗读{autoRead ? '：开' : '：关'}
            </button>
            <button
              onClick={() => setWebSearch((v) => !v)}
              aria-pressed={webSearch}
              disabled={streaming}
              title={
                currentModel?.supports_search
                  ? '模型会自动判断是否需要联网查询实时信息'
                  : '当前模型不支持联网搜索'
              }
              className={`rounded-lg border px-2.5 py-1.5 text-xs transition disabled:opacity-40 ${
                webSearch && currentModel?.supports_search
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              联网{webSearch ? '：开' : '：关'}
            </button>
            <ModelSelect
              models={models}
              value={modelId}
              onChange={changeModel}
              disabled={streaming}
            />
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto bg-white px-4 py-5">
          {messages.length === 0 && (
            <div className="mt-16 text-center text-sm text-slate-500">
              <p className="mb-2 text-base text-slate-600">开始一段新的对话</p>
              <p>直接在下方输入问题，Enter 发送；也可以点「语音」输入</p>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              voiceType={activeConv?.voice_type ?? null}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        {error && (
          <div className="mx-4 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
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

      <PersonaDialog
        open={personaOpen}
        initialPrompt={activeConv?.system_prompt ?? null}
        initialVoiceType={activeConv?.voice_type ?? null}
        initialVoicePrompt={activeConv?.voice_prompt ?? null}
        personas={personas}
        defaultVoice={defaultVoice}
        voices={voices}
        saving={savingPersona}
        onClose={() => setPersonaOpen(false)}
        onBeautify={beautifyPrompt}
        onBeautifyVoice={beautifyVoicePrompt}
        onDesignVoice={designVoice}
        onApply={applyPersona}
        onDelete={removePersona}
      />
    </div>
  )
}
