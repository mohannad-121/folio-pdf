import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { CATEGORY_LABELS, CATEGORY_ORDER, TOOLS, type ToolDef } from '../lib/tools'
import ToolIcon from '../components/ToolIcon'

export default function Home() {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return TOOLS
    return TOOLS.filter((t) => `${t.name} ${t.description} ${t.id}`.toLowerCase().includes(s))
  }, [q])

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <section className="text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Every PDF tool. One place. Yours.</h1>
        <p className="mx-auto mt-3 max-w-2xl text-neutral-500">
          Merge, split, edit, convert, compress, OCR, sign, protect and compare PDFs — all running on your own machine.
        </p>
        <div className="relative mx-auto mt-6 max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tools… e.g. “word”, “compress”, “sign”"
            className="w-full rounded-xl border border-neutral-300 bg-white py-3 pl-10 pr-4 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200 dark:border-neutral-700 dark:bg-neutral-900"
            autoFocus
          />
        </div>
      </section>

      {q ? (
        <Section title={`${filtered.length} result${filtered.length === 1 ? '' : 's'}`} tools={filtered} />
      ) : (
        <>
          <Section title="Popular" tools={TOOLS.filter((t) => t.featured)} />
          {CATEGORY_ORDER.map((cat) => (
            <Section key={cat} title={CATEGORY_LABELS[cat]} tools={TOOLS.filter((t) => t.category === cat)} />
          ))}
        </>
      )}
    </div>
  )
}

function Section({ title, tools }: { title: string; tools: ToolDef[] }) {
  if (!tools.length) return null
  return (
    <section className="mt-12">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {tools.map((t) => (
          <ToolCard key={t.id} tool={t} />
        ))}
      </div>
    </section>
  )
}

function ToolCard({ tool }: { tool: ToolDef }) {
  return (
    <Link
      to={`/tools/${tool.id}`}
      className="group flex gap-3 rounded-xl border border-neutral-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-brand-700"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 group-hover:bg-brand-600 group-hover:text-white dark:bg-brand-900/40 dark:text-brand-200">
        <ToolIcon name={tool.icon} size={20} />
      </span>
      <span>
        <span className="block font-medium">{tool.name}</span>
        <span className="mt-0.5 block text-sm text-neutral-500">{tool.description}</span>
      </span>
    </Link>
  )
}
