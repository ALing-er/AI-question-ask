import { Link } from 'react-router-dom'
import type { Conversation } from '../types'

interface Props {
  conversations: Conversation[]
  activeId: number | null
  userLabel: string
  query: string
  onQueryChange: (v: string) => void
  isAdmin: boolean
  onSelect: (conv: Conversation) => void
  onNew: () => void
  onDelete: (conv: Conversation) => void
  onRename: (conv: Conversation) => void
  onLogout: () => void
}

export default function ConversationList({
  conversations,
  activeId,
  userLabel,
  query,
  onQueryChange,
  isAdmin,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onLogout,
}: Props) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-950/60">
      <div className="border-b border-slate-800 p-3">
        <button
          onClick={onNew}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
        >
          ＋ 新建会话
        </button>
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="搜索会话或消息…"
          className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-slate-600"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-slate-500">
            {query ? '没有匹配的会话' : '还没有会话'}
          </p>
        )}
        {conversations.map((conv) => {
          const active = conv.id === activeId
          return (
            <div
              key={conv.id}
              onClick={() => onSelect(conv)}
              className={[
                'group mb-1 flex cursor-pointer items-center gap-1 rounded-lg px-2 py-2 text-sm transition',
                active ? 'bg-slate-800 text-slate-100' : 'text-slate-300 hover:bg-slate-900',
              ].join(' ')}
            >
              <span className="min-w-0 flex-1 truncate">{conv.title}</span>
              <button
                title="重命名"
                onClick={(e) => {
                  e.stopPropagation()
                  onRename(conv)
                }}
                className="hidden rounded px-1 text-slate-500 hover:text-slate-200 group-hover:block"
              >
                ✎
              </button>
              <button
                title="删除"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(conv)
                }}
                className="hidden rounded px-1 text-slate-500 hover:text-red-400 group-hover:block"
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      <div className="border-t border-slate-800 p-3 text-xs text-slate-400">
        <div className="mb-2 truncate">
          已登录：<span className="text-slate-200">{userLabel}</span>
        </div>
        {isAdmin && (
          <Link
            to="/admin"
            className="mb-2 block rounded-lg border border-slate-800 py-1.5 text-center text-slate-300 transition hover:border-slate-600 hover:text-slate-100"
          >
            管理后台
          </Link>
        )}
        <button
          onClick={onLogout}
          className="w-full rounded-lg border border-slate-800 py-1.5 text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
        >
          退出登录
        </button>
      </div>
    </aside>
  )
}
