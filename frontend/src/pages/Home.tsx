/**
 * Home: a calm, editorial tool directory. One accent colour, monochrome icons, typographic
 * hierarchy and hairline rules; motion is limited to gentle fades and hover cues.
 */
import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, ArrowUpRight, Search, Star, X } from 'lucide-react'
import clsx from 'clsx'
import { CATEGORY_LABELS, CATEGORY_ORDER, TOOLS, TOOLS_BY_ID, toolsInCategory, type ToolCategory, type ToolDef } from '../lib/tools'
import { CATEGORY_META } from '../lib/theme'
import { ease, instant, spring } from '../lib/motion'
import ToolIcon from '../components/ToolIcon'
import { useCommandPalette } from '../components/CommandPalette'
import { Kbd, modKey } from '../components/ui'
import TierBadge from '../components/TierBadge'
import { useAccountsEnabled, useLockedTier } from '../lib/auth'
import { toolTier, usePlans } from '../lib/plans'
import { searchTools } from '../lib/search'

type Filter = ToolCategory | 'all'

const POPULAR = ['merge', 'compress', 'pdf-to-word', 'edit', 'sign', 'ocr']

/** Fade-up used for sections as they enter the viewport. */
function useReveal(delay = 0) {
  const reduce = useReducedMotion()
  return reduce
    ? {}
    : {
        initial: { opacity: 0, y: 14 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, margin: '0px 0px -8% 0px' },
        transition: { duration: 0.5, ease, delay },
      }
}

export default function Home() {
  const [q, setQ] = useState('')
  const reduce = useReducedMotion()
  const [params, setParams] = useSearchParams()
  const catParam = params.get('cat')
  const filter: Filter = CATEGORY_ORDER.includes(catParam as ToolCategory) ? (catParam as ToolCategory) : 'all'
  const directoryRef = useRef<HTMLDivElement>(null)
  const results = useMemo(() => searchTools(q), [q])

  const setFilter = (f: Filter) => {
    setParams(f === 'all' ? {} : { cat: f }, { replace: true, preventScrollReset: true })
    const el = directoryRef.current
    if (el && el.getBoundingClientRect().top < 0) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 56, behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <div className="pb-28">
      <Hero q={q} setQ={setQ} />
      <div ref={directoryRef} className="scroll-mt-14" />
      <AnimatePresence mode="wait" initial={false}>
        {q.trim() ? (
          <motion.section key="results" aria-label="Search results" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="mx-auto max-w-6xl px-5 pt-14 sm:px-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-4">
              <h2 className="text-title text-xl">
                {results.length ? `${results.length} tool${results.length === 1 ? '' : 's'} for “${q.trim()}”` : `No tools match “${q.trim()}”`}
              </h2>
              <button type="button" onClick={() => setQ('')} className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline">
                Clear search
              </button>
            </div>
            {results.length ? (
              <ul className="mt-2 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
                {results.map((t) => (
                  <ToolRow key={t.id} tool={t} showDescription />
                ))}
              </ul>
            ) : (
              <p className="mt-6 text-muted">Try “merge”, “word”, “compress” or “sign”.</p>
            )}
          </motion.section>
        ) : (
          <motion.div key="directory" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <FilterBar filter={filter} setFilter={setFilter} />
            <div className="mx-auto max-w-6xl px-5 sm:px-8">
              <Directory filter={filter} />
              <Steps />
              <Principles />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---- hero ---------------------------------------------------------------------------------------

function Hero({ q, setQ }: { q: string; setQ: (v: string) => void }) {
  const reduce = useReducedMotion()
  const openPalette = useCommandPalette((s) => s.setOpen)
  const hosted = useAccountsEnabled()
  const fade = (i: number) => (reduce ? {} : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.55, ease, delay: 0.05 + i * 0.07 } })
  const facts = [
    { value: String(TOOLS.length), label: 'tools in one place' },
    { value: '24 h', label: 'then your files are deleted' },
    { value: hosted ? '€0' : 'MIT', label: hosted ? 'to start, no card needed' : 'open source, self-hosted' },
  ]

  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 pt-16 pb-14 sm:px-8 sm:pt-24 sm:pb-20 lg:grid-cols-[1fr_15rem] lg:items-end lg:gap-20">
        <div>
          <motion.p {...fade(0)} className="text-sm font-medium text-muted">
            Folio PDF
          </motion.p>
          <motion.h1 {...fade(1)} className="mt-4 text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.035em] text-fg sm:text-6xl lg:text-[4.25rem]">
            The PDF toolkit.
            <span className="block text-muted-2">Everything you need, nothing you don’t.</span>
          </motion.h1>

          <motion.div {...fade(2)} className="mt-10 max-w-xl">
            <label className="group relative block">
              <span className="sr-only">Search tools</span>
              <Search className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted-2 transition-colors group-focus-within:text-fg" size={18} aria-hidden="true" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setQ('')
                }}
                placeholder={`Search ${TOOLS.length} tools`}
                aria-label="Search tools"
                autoFocus
                className="h-13 w-full rounded-xl border border-border-strong bg-surface pr-24 pl-11 text-base text-fg shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition outline-none placeholder:text-muted-2 focus:border-fg/40 focus:ring-4 focus:ring-fg/5"
              />
              <span className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1">
                {q ? (
                  <button type="button" onClick={() => setQ('')} className="grid size-7 place-items-center rounded-md text-muted-2 transition hover:bg-surface-2 hover:text-fg" aria-label="Clear search">
                    <X size={14} />
                  </button>
                ) : (
                  <button type="button" onClick={() => openPalette(true)} className="hidden items-center gap-0.5 rounded-md p-1 transition hover:bg-surface-2 sm:inline-flex" aria-label="Open command palette">
                    <Kbd>{modKey()}</Kbd>
                    <Kbd>K</Kbd>
                  </button>
                )}
              </span>
            </label>
          </motion.div>

          <motion.p {...fade(3)} className="mt-5 flex flex-wrap items-center gap-x-1 gap-y-2 text-sm text-muted">
            <span className="mr-2 text-muted-2">Popular</span>
            {POPULAR.map((id, i) => {
              const t = TOOLS_BY_ID[id]
              if (!t) return null
              return (
                <span key={id} className="inline-flex items-center">
                  <Link to={`/tools/${id}`} className="text-fg underline decoration-border-strong underline-offset-4 transition-colors hover:decoration-fg">
                    {t.name}
                  </Link>
                  {i < POPULAR.length - 1 && <span className="mx-2 text-border-strong" aria-hidden="true">·</span>}
                </span>
              )
            })}
          </motion.p>
        </div>

        <motion.dl {...fade(4)} className="grid grid-cols-3 gap-6 border-t border-border pt-6 lg:grid-cols-1 lg:gap-0 lg:divide-y lg:divide-border lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
          {facts.map((f) => (
            <div key={f.label} className="lg:py-4 lg:first:pt-0 lg:last:pb-0">
              <dt className="sr-only">{f.label}</dt>
              <dd className="text-2xl font-semibold tracking-tight text-fg tabular sm:text-3xl">{f.value}</dd>
              <dd className="mt-1 text-[13px] leading-snug text-muted">{f.label}</dd>
            </div>
          ))}
        </motion.dl>
      </div>
    </section>
  )
}

// ---- filter --------------------------------------------------------------------------------------

function FilterBar({ filter, setFilter }: { filter: Filter; setFilter: (f: Filter) => void }) {
  const reduce = useReducedMotion()
  const items: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: TOOLS.length },
    ...CATEGORY_ORDER.map((c) => ({ id: c as Filter, label: CATEGORY_LABELS[c], count: toolsInCategory(c).length })),
  ]
  return (
    <nav aria-label="Tool categories" className="sticky top-14 z-30 border-b border-border bg-canvas/85 backdrop-blur-md">
      <div role="tablist" aria-label="Filter tools by category" className="mx-auto flex max-w-6xl gap-6 overflow-x-auto px-5 [scrollbar-width:none] sm:px-8 [&::-webkit-scrollbar]:hidden">
        {items.map((it) => {
          const active = it.id === filter
          return (
            <button
              key={it.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={(e) => {
                setFilter(it.id)
                e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduce ? 'auto' : 'smooth' })
              }}
              className={clsx('relative shrink-0 py-3.5 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg', active ? 'font-medium text-fg' : 'text-muted hover:text-fg')}
            >
              {it.label}
              <span className="ml-1.5 text-xs text-muted-2 tabular">{it.count}</span>
              {active && <motion.span layoutId="filter-underline" transition={reduce ? instant : spring} className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-fg" aria-hidden="true" />}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

// ---- directory ------------------------------------------------------------------------------------

function Directory({ filter }: { filter: Filter }) {
  const reduce = useReducedMotion()
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={filter} role="tabpanel" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease } }} exit={{ opacity: 0, transition: { duration: 0.1 } }} className="pt-12">
        {filter === 'all' ? (
          // A grid (not CSS columns) so categories read left to right in their sorted order.
          <div className="grid items-start gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {CATEGORY_ORDER.map((c) => (
              <CategoryBlock key={c} cat={c} />
            ))}
          </div>
        ) : (
          <CategoryDetail cat={filter} />
        )}
      </motion.div>
    </AnimatePresence>
  )
}

/** One category in the "All" index: heading, hairline, compact rows. */
function CategoryBlock({ cat }: { cat: ToolCategory }) {
  const reveal = useReveal()
  const tools = toolsInCategory(cat)
  return (
    <motion.section {...reveal} aria-labelledby={`cat-${cat}-h`}>
      <header className="flex items-baseline justify-between border-b border-border pb-3">
        <h2 id={`cat-${cat}-h`} className="text-[13px] font-semibold tracking-[0.08em] text-fg uppercase">
          {CATEGORY_LABELS[cat]}
        </h2>
        <span className="text-xs text-muted-2 tabular">{tools.length}</span>
      </header>
      <ul className="mt-1">
        {tools.map((t) => (
          <ToolRow key={t.id} tool={t} />
        ))}
      </ul>
    </motion.section>
  )
}

/** A single category: intro text and rows with descriptions in columns. */
function CategoryDetail({ cat }: { cat: ToolCategory }) {
  const tools = toolsInCategory(cat)
  const meta = CATEGORY_META[cat]
  return (
    <section aria-labelledby={`cat-${cat}-h`}>
      <header className="max-w-2xl">
        <p className="text-sm text-muted">{meta.eyebrow}</p>
        <h2 id={`cat-${cat}-h`} className="mt-2 text-3xl font-semibold tracking-[-0.025em] text-fg sm:text-4xl">
          {CATEGORY_LABELS[cat]}
        </h2>
        <p className="mt-3 text-[17px] leading-relaxed text-muted text-pretty">{meta.blurb}</p>
      </header>
      <ul className="mt-10 grid gap-x-10 border-t border-border pt-2 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => (
          <ToolRow key={t.id} tool={t} showDescription />
        ))}
      </ul>
    </section>
  )
}

function ToolRow({ tool, showDescription }: { tool: ToolDef; showDescription?: boolean }) {
  const required = usePlans((s) => toolTier(tool.id, s.plans))
  const locked = useLockedTier(required)
  return (
    <li>
      <Link
        to={`/tools/${tool.id}`}
        title={showDescription ? undefined : tool.description}
        className={clsx('group -mx-3 flex gap-3 rounded-lg px-3 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-fg', showDescription ? 'items-start py-2.5' : 'items-center py-2')}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-surface text-muted transition-colors group-hover:border-border-strong group-hover:text-brand-600 dark:group-hover:text-brand-300">
          <ToolIcon name={tool.icon} size={16} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={clsx('text-[15px] leading-snug font-medium text-fg', showDescription && 'truncate')}>{tool.name}</span>
            {tool.featured && (
              <span title="Popular" className="shrink-0 text-muted-2">
                <Star size={11} fill="currentColor" aria-hidden="true" />
                <span className="sr-only">Popular</span>
              </span>
            )}
            {locked && <TierBadge tier={locked} locked size="xs" srLabel="plan required" />}
          </span>
          {showDescription ? <span className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-muted">{tool.description}</span> : <span className="sr-only">: {tool.description}</span>}
        </span>
        <ArrowUpRight size={15} className="shrink-0 -translate-x-1 text-muted-2 opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100" aria-hidden="true" />
      </Link>
    </li>
  )
}

// ---- how it works -------------------------------------------------------------------------------------

function Steps() {
  const reveal = useReveal()
  const steps = [
    { title: 'Choose a tool', text: 'Search, or browse the index above. Every tool works on its own page.' },
    { title: 'Add your file', text: 'Drop in a PDF, Office document or image. Sensible defaults are already set.' },
    { title: 'Download', text: 'Get the result in seconds, or pass it straight to another tool.' },
  ]
  return (
    <motion.section {...reveal} aria-labelledby="steps-h" className="mt-16 border-t border-border pt-16">
      <h2 id="steps-h" className="max-w-md text-3xl font-semibold tracking-[-0.025em] text-fg">
        Three steps, no learning curve.
      </h2>
      <ol className="mt-10 grid gap-10 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="border-t border-fg pt-5">
            <span className="text-sm text-muted-2 tabular">0{i + 1}</span>
            <h3 className="mt-3 text-lg font-semibold text-fg">{s.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted text-pretty">{s.text}</p>
          </li>
        ))}
      </ol>
    </motion.section>
  )
}

// ---- principles -----------------------------------------------------------------------------------------

function Principles() {
  const reveal = useReveal()
  const hosted = useAccountsEnabled()
  const items = [
    { title: 'Private by default', text: 'Files are processed privately, never shared, and deleted automatically after 24 hours.' },
    { title: 'Everything in one place', text: `${TOOLS.length} tools for organizing, converting, editing, signing and protecting PDFs, with one consistent interface.` },
    hosted
      ? { title: 'Free to start', text: 'The everyday tools are free. Upgrade only when you need bigger files, advanced tools or the API.', link: { to: '/pricing', label: 'Compare plans' } }
      : { title: 'Yours to run', text: 'Self-hosted and open source: no file-size caps, no daily quotas and no watermarks.' },
  ]
  return (
    <motion.section {...reveal} aria-labelledby="principles-h" className="mt-24 rounded-2xl bg-surface-2/70 px-6 py-12 sm:px-10">
      <h2 id="principles-h" className="text-sm font-medium text-muted">
        Why Folio
      </h2>
      <ul className="mt-6 grid gap-10 sm:grid-cols-3">
        {items.map((it) => (
          <li key={it.title}>
            <h3 className="text-lg font-semibold text-fg">{it.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted text-pretty">{it.text}</p>
            {'link' in it && it.link && (
              <Link to={it.link.to} className="group mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg">
                {it.link.label}
                <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </motion.section>
  )
}
