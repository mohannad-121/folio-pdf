import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, ArrowUpRight, Check, Clock, Download, LayoutGrid, Layers, Lock, Search, SlidersHorizontal, Sparkles, Star, Upload, WandSparkles, X } from 'lucide-react'
import clsx from 'clsx'
import { CATEGORY_LABELS, CATEGORY_ORDER, TOOLS, TOOLS_BY_ID, toolsInCategory, type ToolCategory, type ToolDef } from '../lib/tools'
import { CATEGORY_META, categoryAccent } from '../lib/theme'
import { ease, instant, spring, staggerContainer, staggerItem, tween } from '../lib/motion'
import ToolIcon from '../components/ToolIcon'
import { fuzzyScore, useCommandPalette } from '../components/CommandPalette'
import { Badge, Kbd, modKey } from '../components/ui'
import TierBadge from '../components/TierBadge'
import { useAccountsEnabled, useLockedTier } from '../lib/auth'
import { toolTier, usePlans } from '../lib/plans'

type Filter = ToolCategory | 'all'

/** The everyday tools, shown as quick-start tiles in the hero. */
const QUICK_START = ['merge', 'compress', 'pdf-to-word', 'edit', 'sign', 'ocr']

export default function Home() {
  const [q, setQ] = useState('')
  const reduce = useReducedMotion()
  const openPalette = useCommandPalette((s) => s.setOpen)
  const [params, setParams] = useSearchParams()
  const catParam = params.get('cat')
  const filter: Filter = CATEGORY_ORDER.includes(catParam as ToolCategory) ? (catParam as ToolCategory) : 'all'
  const catalogRef = useRef<HTMLDivElement>(null)

  const setFilter = (f: Filter) => {
    setParams(f === 'all' ? {} : { cat: f }, { replace: true, preventScrollReset: true })
    // If the user has scrolled past the top of the catalog, bring its start back into view.
    const el = catalogRef.current
    if (el && el.getBoundingClientRect().top < 0) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: reduce ? 'auto' : 'smooth' })
  }

  const results = useMemo(() => {
    const s = q.trim()
    if (!s) return []
    return TOOLS.map((t) => ({ t, score: Math.max(fuzzyScore(s, t.name) * 2, fuzzyScore(s, t.id), fuzzyScore(s, t.description) * 0.6) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.t)
  }, [q])

  return (
    <div className="pb-24">
      <Hero q={q} setQ={setQ} onPalette={() => openPalette(true)} />

      <AnimatePresence mode="wait" initial={false}>
        {q.trim() ? (
          <motion.div key="results" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={tween} className="mx-auto max-w-7xl px-4 pt-12">
            <div className="mb-6 flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-title text-2xl">
                {results.length} result{results.length === 1 ? '' : 's'} for “{q.trim()}”
              </h2>
              <button type="button" onClick={() => setQ('')} className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">
                Clear search
              </button>
            </div>
            {results.length ? (
              <ToolGrid tools={results} animate={!reduce} />
            ) : (
              <div className="rounded-2xl border border-dashed border-border-strong p-10 text-center">
                <p className="text-muted">Nothing matches. Try “merge”, “word”, “ocr” or “sign”.</p>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="catalog" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tween}>
            <div ref={catalogRef} className="scroll-mt-16" />
            <CategoryTabs filter={filter} setFilter={setFilter} />
            <div className="mx-auto max-w-7xl px-4">
              <Catalog filter={filter} />
              <HowItWorks />
              <WhyFolio />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---- hero ------------------------------------------------------------------------------------

/** Decorative tool tiles floating around the hero on wide screens. */
const FLOATERS: { id: string; className: string; delay: number; rotate: number }[] = [
  { id: 'merge', className: 'left-[6%] top-[18%] size-14', delay: 0, rotate: -10 },
  { id: 'pdf-to-word', className: 'left-[13%] top-[46%] size-12', delay: 1.2, rotate: 8 },
  { id: 'sign', className: 'left-[4%] top-[70%] size-11', delay: 2.1, rotate: -4 },
  { id: 'stamp', className: 'left-[11%] top-[88%] size-10', delay: 0.6, rotate: 12 },
  { id: 'compress', className: 'right-[6%] top-[16%] size-14', delay: 0.9, rotate: 10 },
  { id: 'ocr', className: 'right-[14%] top-[44%] size-12', delay: 1.8, rotate: -8 },
  { id: 'protect', className: 'right-[4%] top-[68%] size-11', delay: 0.3, rotate: 6 },
  { id: 'images-to-pdf', className: 'right-[11%] top-[88%] size-10', delay: 2.4, rotate: -12 },
]

function Hero({ q, setQ, onPalette }: { q: string; setQ: (v: string) => void; onPalette: () => void }) {
  const ref = useRef<HTMLElement>(null)
  const reduce = useReducedMotion()
  const hosted = useAccountsEnabled()
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  const container = staggerContainer(0.07, 0.05)
  const item = reduce ? undefined : staggerItem

  return (
    <section ref={ref} onMouseMove={onMove} className="relative isolate overflow-hidden border-b border-border/60">
      {/* Background layers */}
      <div className="bg-grid absolute inset-0 -z-20 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" aria-hidden="true" />
      <div className="spotlight absolute inset-0 -z-10 transition-[background] duration-300" aria-hidden="true" />
      <div className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-brand-500)_26%,transparent),transparent)] blur-2xl motion-safe:animate-drift" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-40 top-10 -z-10 h-[420px] w-[520px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-cat-review-500)_20%,transparent),transparent)] blur-2xl motion-safe:animate-drift-slow" aria-hidden="true" />
      <div className="pointer-events-none absolute -left-32 top-24 -z-10 h-[360px] w-[460px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-cat-convert-from-500)_18%,transparent),transparent)] blur-2xl motion-safe:animate-drift" aria-hidden="true" />
      <div className="bg-noise pointer-events-none absolute inset-0 -z-10 dark:mix-blend-screen" aria-hidden="true" />

      {/* Floating tool tiles (wide screens only, purely decorative). */}
      <div className="pointer-events-none absolute inset-0 -z-10 hidden xl:block" aria-hidden="true">
        {FLOATERS.map((f, i) => {
          const t = TOOLS_BY_ID[f.id]
          if (!t) return null
          const acc = categoryAccent(t.category)
          return (
            <motion.span
              key={f.id}
              initial={reduce ? false : { opacity: 0, scale: 0.6, rotate: 0 }}
              animate={{ opacity: 0.9, scale: 1, rotate: f.rotate }}
              transition={reduce ? instant : { delay: 0.35 + i * 0.06, type: 'spring', stiffness: 180, damping: 16 }}
              className={clsx('absolute', f.className)}
            >
              <span className={clsx('grid size-full place-items-center rounded-2xl shadow-[0_14px_30px_-12px_var(--accent)] motion-safe:animate-float', acc.tile)} style={{ ...(acc.style as CSSProperties), animationDelay: `${f.delay}s`, animationDuration: `${5 + (i % 3)}s` }}>
                <ToolIcon name={t.icon} size={22} />
              </span>
            </motion.span>
          )
        })}
      </div>

      <motion.div variants={reduce ? undefined : container} initial="initial" animate="animate" className="mx-auto max-w-7xl px-4 pt-14 pb-12 text-center sm:pt-20 sm:pb-16">
        <motion.div variants={item} className="flex justify-center">
          <Badge tone="brand" size="md" dot className="shadow-soft">
            {TOOLS.length} PDF tools · {hosted ? 'Free to start' : 'Self-hosted, no limits'}
          </Badge>
        </motion.div>
        <motion.h1 variants={item} className="text-display mx-auto mt-6 max-w-4xl text-[2.6rem] sm:text-6xl lg:text-7xl">
          Every PDF tool.
          <br className="hidden sm:block" /> One place. <span className="text-gradient">Yours.</span>
        </motion.h1>
        <motion.p variants={item} className="mx-auto mt-5 max-w-[46ch] text-base leading-relaxed text-muted text-pretty sm:text-lg">
          Merge, split, convert, compress, edit, sign and protect PDFs in seconds. Pick a tool, drop your file, download the result.
        </motion.p>

        <motion.div variants={item} className="relative mx-auto mt-8 max-w-xl">
          <div className="group relative" style={{ '--accent': 'var(--color-brand-500)' } as CSSProperties}>
            <Search className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted-2 transition-colors group-focus-within:text-brand-500" size={18} aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQ('')
              }}
              placeholder="Find a tool, e.g. “compress”"
              aria-label="Search tools"
              className="field h-14 rounded-2xl pl-11 pr-28 text-base shadow-lift"
              autoFocus
            />
            <div className="absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-1.5">
              {q && (
                <button type="button" onClick={() => setQ('')} className="grid size-7 place-items-center rounded-md text-muted-2 transition hover:bg-surface-2 hover:text-fg" aria-label="Clear search">
                  <X size={14} />
                </button>
              )}
              <button type="button" onClick={onPalette} className="hidden items-center gap-0.5 rounded-md p-1 transition hover:bg-surface-2 sm:inline-flex" aria-label="Open command palette">
                <Kbd>{modKey()}</Kbd>
                <Kbd>K</Kbd>
              </button>
            </div>
          </div>
        </motion.div>

        <motion.ul variants={item} className="mx-auto mt-5 flex max-w-xl flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[13px] text-muted">
          {[hosted ? 'Free plan, no card needed' : 'Free and open source', 'Files deleted after 24 hours', 'Nothing to install'].map((t) => (
            <li key={t} className="inline-flex items-center gap-1.5">
              <Check size={14} className="text-emerald-500" aria-hidden="true" />
              {t}
            </li>
          ))}
        </motion.ul>

        <QuickStart />
      </motion.div>
    </section>
  )
}

function QuickStart() {
  const reduce = useReducedMotion()
  const tools = QUICK_START.map((id) => TOOLS_BY_ID[id]).filter(Boolean)
  return (
    <motion.div variants={reduce ? undefined : staggerItem} className="mx-auto mt-12 max-w-3xl">
      <div className="text-eyebrow mb-4 text-muted-2">Most used</div>
      <motion.ul variants={reduce ? undefined : staggerContainer(0.05, 0.2)} className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {tools.map((t) => {
          const acc = categoryAccent(t.category)
          return (
            <motion.li key={t.id} variants={reduce ? undefined : staggerItem}>
              <Link
                to={`/tools/${t.id}`}
                style={acc.style as CSSProperties}
                className="group flex h-full flex-col items-center gap-2.5 rounded-2xl border border-border/70 bg-surface/70 px-2 pt-4 pb-3 shadow-soft backdrop-blur transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-1 hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--color-border))] hover:shadow-glow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                <span className={clsx('grid size-11 place-items-center rounded-xl shadow-[0_10px_22px_-10px_var(--accent)] transition-transform duration-300 ease-[var(--ease-spring)] group-hover:-translate-y-0.5 group-hover:-rotate-6 group-hover:scale-110', acc.tile)}>
                  <ToolIcon name={t.icon} size={21} />
                </span>
                <span className="text-[13px] leading-tight font-semibold text-fg">{t.name}</span>
              </Link>
            </motion.li>
          )
        })}
      </motion.ul>
    </motion.div>
  )
}

// ---- category filter -----------------------------------------------------------------------------

function CategoryTabs({ filter, setFilter }: { filter: Filter; setFilter: (f: Filter) => void }) {
  const reduce = useReducedMotion()
  const items: { id: Filter; label: string; icon: ReactNode; count: number }[] = [
    { id: 'all', label: 'All tools', icon: <LayoutGrid size={15} />, count: TOOLS.length },
    ...CATEGORY_ORDER.map((c) => ({ id: c as Filter, label: CATEGORY_LABELS[c], icon: <ToolIcon name={CATEGORY_META[c].icon} size={15} />, count: toolsInCategory(c).length })),
  ]
  return (
    <nav aria-label="Tool categories" className="glass sticky top-14 z-30 border-b border-border/60">
      <div role="tablist" aria-label="Filter tools by category" className="mx-auto flex max-w-7xl gap-0.5 overflow-x-auto px-4 py-2.5 [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-28px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((it) => {
          const active = it.id === filter
          const acc = it.id === 'all' ? null : categoryAccent(it.id)
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
              style={(acc?.style ?? { '--accent': 'var(--color-brand-500)' }) as CSSProperties}
              className={clsx('relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]', active ? 'text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg')}
            >
              {active && <motion.span layoutId="cat-tab" transition={reduce ? instant : spring} className="absolute inset-0 rounded-full bg-[color-mix(in_oklab,var(--accent)_13%,var(--color-surface))] shadow-soft ring-1 ring-inset ring-[color-mix(in_oklab,var(--accent)_38%,transparent)]" aria-hidden="true" />}
              <span className={clsx('relative transition-colors', active ? 'text-[var(--accent)]' : 'text-muted-2')} aria-hidden="true">
                {it.icon}
              </span>
              <span className="relative">{it.label}</span>
              <span className={clsx('relative rounded-full px-1.5 text-[11px] tabular transition-colors', active ? 'bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-[var(--accent)]' : 'bg-surface-2 text-muted-2')}>{it.count}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

// ---- catalog ---------------------------------------------------------------------------------------

function Catalog({ filter }: { filter: Filter }) {
  const reduce = useReducedMotion()
  const cats = filter === 'all' ? CATEGORY_ORDER : [filter]
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={filter} role="tabpanel" initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease } }} exit={{ opacity: 0, y: -8, transition: { duration: 0.12 } }}>
        {cats.map((c) => (
          <CategoryGroup key={c} cat={c} />
        ))}
      </motion.div>
    </AnimatePresence>
  )
}

function CategoryGroup({ cat }: { cat: ToolCategory }) {
  const reduce = useReducedMotion()
  const acc = categoryAccent(cat)
  const meta = CATEGORY_META[cat]
  const tools = toolsInCategory(cat)
  return (
    <section className="pt-12 first:pt-10" aria-labelledby={`cat-${cat}-h`} style={acc.style as CSSProperties}>
      <motion.header
        initial={reduce ? false : { opacity: 0, x: -10 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, margin: '0px 0px -10% 0px' }}
        transition={{ duration: 0.35, ease }}
        className="mb-5 flex items-center gap-4"
      >
        <span className={clsx('grid size-12 shrink-0 place-items-center rounded-2xl shadow-[0_10px_24px_-10px_var(--accent)]', acc.tile)} aria-hidden="true">
          <ToolIcon name={meta.icon} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className={clsx('text-eyebrow', acc.text)}>{meta.eyebrow}</div>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 id={`cat-${cat}-h`} className="text-title text-2xl">
              {CATEGORY_LABELS[cat]}
            </h2>
            <span className="text-sm text-muted-2 tabular">{tools.length} tools</span>
          </div>
          <p className="mt-0.5 hidden max-w-[70ch] text-[15px] text-muted text-pretty sm:block">{meta.blurb}</p>
        </div>
        <span className="hidden h-px flex-1 bg-linear-to-r from-[color-mix(in_oklab,var(--accent)_35%,transparent)] to-transparent lg:block" aria-hidden="true" />
      </motion.header>
      <ToolGrid tools={tools} animate={!reduce} />
    </section>
  )
}

function ToolGrid({ tools, animate }: { tools: ToolDef[]; animate: boolean }) {
  return (
    <motion.ul
      variants={animate ? staggerContainer(0.03) : undefined}
      initial={animate ? 'initial' : false}
      whileInView={animate ? 'animate' : undefined}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4"
    >
      {tools.map((t) => (
        <ToolCard key={t.id} tool={t} animate={animate} />
      ))}
    </motion.ul>
  )
}

function ToolCard({ tool, animate }: { tool: ToolDef; animate: boolean }) {
  const acc = categoryAccent(tool.category)
  const required = usePlans((s) => toolTier(tool.id, s.plans))
  const locked = useLockedTier(required)
  return (
    <motion.li variants={animate ? staggerItem : undefined} className="min-w-0">
      <Link
        to={`/tools/${tool.id}`}
        style={acc.style as CSSProperties}
        className={clsx(
          // Phones: compact centred tile (icon + name). sm and up: icon beside name + description.
          'group card-wash relative flex h-full flex-col items-center gap-2.5 overflow-hidden rounded-2xl border border-border bg-surface px-3 py-4 text-center shadow-card transition-[transform,box-shadow,border-color] duration-200 ease-out sm:flex-row sm:items-start sm:gap-3.5 sm:p-4 sm:text-left',
          'hover:-translate-y-1 hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--color-border))] hover:shadow-glow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
        )}
      >
        {/* Accent glow + top hairline, both stronger on hover. */}
        <span className="pointer-events-none absolute -top-14 -right-14 size-36 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_26%,transparent),transparent)] opacity-40 transition-[opacity,transform] duration-300 group-hover:scale-125 group-hover:opacity-100" aria-hidden="true" />
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[color-mix(in_oklab,var(--accent)_60%,transparent)] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden="true" />

        <span className={clsx('relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl shadow-[0_8px_20px_-10px_var(--accent)] transition-transform duration-300 ease-[var(--ease-spring)] group-hover:-rotate-6 group-hover:scale-110', acc.tile)}>
          <ToolIcon name={tool.icon} size={21} className="relative" />
          {/* Light sweep across the icon on hover. */}
          <span className="pointer-events-none absolute inset-y-0 -left-full w-1/2 -skew-x-12 bg-linear-to-r from-transparent via-white/45 to-transparent transition-[left] duration-500 ease-out group-hover:left-[150%]" aria-hidden="true" />
        </span>

        <span className="relative w-full min-w-0 flex-1 sm:pr-5">
          <span className="flex min-w-0 items-center justify-center gap-1.5 sm:justify-start">
            <span className="text-title text-[14px] leading-snug sm:truncate sm:text-[15px]">{tool.name}</span>
            {tool.featured && (
              <span className="inline-flex shrink-0 items-center text-amber-500" title="Popular">
                <Star size={12} fill="currentColor" aria-hidden="true" />
                <span className="sr-only">Popular</span>
              </span>
            )}
          </span>
          <span className="mt-1 hidden text-[13px] leading-relaxed text-muted text-pretty sm:line-clamp-2">{tool.description}</span>
          {(tool.opensViewer || locked) && (
            <span className="mt-2 flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">
              {tool.opensViewer && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--accent)] uppercase">
                  <WandSparkles size={10} aria-hidden="true" /> Editor
                </span>
              )}
              {locked && <TierBadge tier={locked} locked size="xs" srLabel="plan required" />}
            </span>
          )}
        </span>

        <ArrowUpRight size={16} className="absolute top-4 right-3.5 hidden sm:block -translate-x-1 translate-y-1 text-[var(--accent)] opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100" aria-hidden="true" />
      </Link>
    </motion.li>
  )
}

// ---- how it works ------------------------------------------------------------------------------------

function HowItWorks() {
  const reduce = useReducedMotion()
  const steps = [
    { Icon: Upload, title: 'Drop your file', text: 'Pick a tool and drag in a PDF, Office document or image — or paste it.', accent: 'var(--color-brand-500)' },
    { Icon: SlidersHorizontal, title: 'Adjust if you like', text: 'Sensible defaults are already set. Tweak pages, quality or layout when you need to.', accent: 'var(--color-cat-organize-500)' },
    { Icon: Download, title: 'Download the result', text: 'Get your file in seconds, or send it straight into another tool.', accent: 'var(--color-cat-convert-from-500)' },
  ]
  return (
    <section className="mt-24" aria-labelledby="how-h">
      <div className="mb-10 text-center">
        <div className="text-eyebrow text-brand-600 dark:text-brand-300">How it works</div>
        <h2 id="how-h" className="text-title mt-2 text-3xl sm:text-4xl">
          Three steps. <span className="text-gradient">No learning curve.</span>
        </h2>
      </div>
      <div className="relative">
        {/* Connector drawn as the section scrolls into view (desktop). */}
        <svg className="pointer-events-none absolute top-9 right-[16%] left-[16%] hidden h-2 sm:block" viewBox="0 0 100 2" preserveAspectRatio="none" aria-hidden="true">
          <motion.line x1="0" y1="1" x2="100" y2="1" stroke="var(--color-border-strong)" strokeWidth="2" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" initial={reduce ? false : { pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.1, ease, delay: 0.2 }} />
        </svg>
        <motion.ol variants={reduce ? undefined : staggerContainer(0.15)} initial={reduce ? false : 'initial'} whileInView={reduce ? undefined : 'animate'} viewport={{ once: true, margin: '0px 0px -10% 0px' }} className="relative grid gap-6 sm:grid-cols-3">
          {steps.map((s, i) => (
            <motion.li key={s.title} variants={reduce ? undefined : staggerItem} style={{ '--accent': s.accent } as CSSProperties} className="flex flex-col items-center text-center">
              <span className="relative grid size-[4.5rem] place-items-center rounded-3xl border border-border bg-surface shadow-lift">
                <span className="grid size-12 place-items-center rounded-2xl bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-[var(--accent)]">
                  <s.Icon size={24} />
                </span>
                <span className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-[var(--accent)] text-xs font-bold text-white shadow-soft">{i + 1}</span>
              </span>
              <h3 className="text-title mt-5 text-lg">{s.title}</h3>
              <p className="mt-1.5 max-w-[30ch] text-sm leading-relaxed text-muted text-pretty">{s.text}</p>
            </motion.li>
          ))}
        </motion.ol>
      </div>
    </section>
  )
}

// ---- why folio -------------------------------------------------------------------------------------

function WhyFolio() {
  const reduce = useReducedMotion()
  const hosted = useAccountsEnabled()
  const facts = [
    { Icon: Lock, eyebrow: 'Privacy', title: 'Your files stay yours', text: 'Files are processed privately, never shared, and deleted automatically after 24 hours.', accent: 'var(--color-cat-convert-from-500)' },
    { Icon: Layers, eyebrow: 'Breadth', title: `${TOOLS.length} tools, one place`, text: 'Organize, convert, edit, sign, compress, protect and compare — and chain one tool into the next.', accent: 'var(--color-brand-500)' },
    hosted
      ? { Icon: Sparkles, eyebrow: 'Fair pricing', title: 'Free to start', text: 'The everyday tools are free. Upgrade only when you need more power, bigger files or the API.', accent: 'var(--color-cat-review-500)', link: { to: '/pricing', label: 'See plans' } }
      : { Icon: Clock, eyebrow: 'Freedom', title: 'No limits, no sign-up', text: 'Self-hosted and open source: no file-size caps, no daily quotas and no watermarks on your files.', accent: 'var(--color-cat-review-500)' },
  ]
  return (
    <section className="mt-24" aria-labelledby="why-h">
      <div className="mb-10 text-center">
        <div className="text-eyebrow text-brand-600 dark:text-brand-300">Why Folio</div>
        <h2 id="why-h" className="text-title mt-2 text-3xl sm:text-4xl">
          Acrobat-class tools, <span className="text-gradient">none of the hassle</span>.
        </h2>
      </div>
      <motion.ul variants={reduce ? undefined : staggerContainer(0.08)} initial={reduce ? false : 'initial'} whileInView={reduce ? undefined : 'animate'} viewport={{ once: true, margin: '0px 0px -10% 0px' }} className="grid gap-4 sm:grid-cols-3">
        {facts.map((f) => (
          <motion.li key={f.title} variants={reduce ? undefined : staggerItem} style={{ '--accent': f.accent } as CSSProperties} className="card-wash relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-card">
            <span className="pointer-events-none absolute -top-16 -right-16 size-44 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_22%,transparent),transparent)]" aria-hidden="true" />
            <span className="grid size-11 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-[var(--accent)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--accent)_30%,transparent)]">
              <f.Icon size={22} />
            </span>
            <div className="text-eyebrow mt-5 text-[var(--accent)]">{f.eyebrow}</div>
            <h3 className="text-title mt-1 text-lg">{f.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted text-pretty">{f.text}</p>
            {'link' in f && f.link && (
              <Link to={f.link.to} className="group mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent)]">
                {f.link.label} <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            )}
          </motion.li>
        ))}
      </motion.ul>
    </section>
  )
}
