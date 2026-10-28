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
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <div className="border-b border-slate-200 p-3">
        <button
          onClick={onNew}
          className="w-full rounded-lg border border-slate-300 bg-white py-2 text-sm font-medium text-slate-700 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
        >
          ＋ 新建会话
        </button>
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="搜索会话或消息…"
          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-500"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-slate-400">
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
                active
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100',
              ].join(' ')}
            >
              <span className="min-w-0 flex-1 truncate">{conv.title}</span>
              <button
                title="重命名"
                onClick={(e) => {
                  e.stopPropagation()
                  onRename(conv)
                }}
                className="hidden rounded px-1 text-slate-400 hover:text-blue-600 group-hover:block"
              >
                ✎
              </button>
              <button
                title="删除"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(conv)
                }}
                className="hidden rounded px-1 text-slate-400 hover:text-red-600 group-hover:block"
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      <div className="border-t border-slate-200 p-3 text-xs text-slate-500">
        <div className="mb-2 truncate">
          已登录：<span className="text-slate-700">{userLabel}</span>
        </div>
        {isAdmin && (
          <Link
            to="/admin"
            className="mb-2 block rounded-lg border border-slate-300 bg-white py-1.5 text-center text-slate-600 transition hover:border-blue-400 hover:text-blue-600"
          >
            管理后台
          </Link>
        )}
        <button
          onClick={onLogout}
          className="w-full rounded-lg border border-slate-300 bg-white py-1.5 text-slate-500 transition hover:border-amber-300 hover:text-amber-600"
        >
          退出登录
        </button>
      </div>
    </aside>
  )
}
