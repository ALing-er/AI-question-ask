import { useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const copy = () => {
    const text = ref.current?.innerText ?? ''
    navigator.clipboard.writeText(text).catch(() => {})
  }
  return (
    <div className="group relative">
      <pre ref={ref}>{children}</pre>
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 rounded bg-slate-700/90 px-2 py-1 text-xs text-slate-200 opacity-0 transition group-hover:opacity-100"
      >
        复制
      </button>
    </div>
  )
}

const components: Components = {
  pre({ children }) {
    return <CodeBlock>{children}</CodeBlock>
  },
  a({ children, ...props }) {
    return (
      <a {...props} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  },
}

export default function MarkdownView({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
