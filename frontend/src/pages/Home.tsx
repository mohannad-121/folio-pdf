/**
 * Home: a colourful, category-coded catalog. Every category owns a hue (see lib/theme HUES);
 * sections, cards, pills and the 3D icon tiles all pick it up through --accent and the c4..c7
 * shade variables. Motion: staggered reveals, 3D tiles that tilt with the pointer, floating hero
 * tiles; everything is skipped under prefers-reduced-motion.
 */
import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, ArrowUpRight, Check, Search, Star, WandSparkles, X } from 'lucide-react'
import clsx from 'clsx'
import { CATEGORY_LABELS, CATEGORY_ORDER, TOOLS, TOOLS_BY_ID, toolsInCategory, type ToolCategory, type ToolDef } from '../lib/tools'
import { CATEGORY_META, categoryAccent } from '../lib/theme'
import { ease, instant, spring, staggerContainer, staggerItem, tween } from '../lib/motion'
import Icon3D, { paletteVars, type Palette } from '../components/Icon3D'
import { useCommandPalette } from '../components/CommandPalette'
import { Badge, Kbd, modKey } from '../components/ui'
import TierBadge from '../components/TierBadge'
import { useAccountsEnabled, useLockedTier } from '../lib/auth'
import { toolTier, usePlans } from '../lib/plans'
import { searchTools } from '../lib/search'

type Filter = ToolCategory | 'all'

const POPULAR = ['merge', 'compress', 'pdf-to-word', 'edit', 'sign', 'ocr']

const pal = (cat: ToolCategory): Palette => `cat-${cat}`

/** Pointer-follow tilt: writes --rx/--ry on the element so its Icon3D leans toward the cursor. */
function useTilt() {
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    el.style.setProperty('--ry', `${(x * 36).toFixed(1)}deg`)
    el.style.setProperty('--rx', `${(-y * 28).toFixed(1)}deg`)
  }
  const onPointerLeave = (e: PointerEvent<HTMLElement>) => {
    e.currentTarget.style.removeProperty('--rx')
    e.currentTarget.style.removeProperty('--ry')
  }
  return { onPointerMove, onPointerLeave }
}

export default function Home() {
  const [q, setQ] = useState('')
  const reduce = useReducedMotion()
  const [params, setParams] = useSearchParams()
  const catParam = params.get('cat')
  const filter: Filter = CATEGORY_ORDER.includes(catParam as ToolCategory) ? (catParam as ToolCategory) : 'all'
  const catalogRef = useRef<HTMLDivElement>(null)
  const results = useMemo(() => searchTools(q), [q])

  const setFilter = (f: Filter, scroll = false) => {
    setParams(f === 'all' ? {} : { cat: f }, { replace: true, preventScrollReset: true })
    const el = catalogRef.current
    if (el && (scroll || el.getBoundingClientRect().top < 0)) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <div className="pb-24">
      <Hero q={q} setQ={setQ} onPick={(c) => setFilter(c, true)} />
      <div ref={catalogRef} className="scroll-mt-16" />
      <AnimatePresence mode="wait" initial={false}>
        {q.trim() ? (
          <motion.section key="results" aria-label="Search results" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={tween} className="mx-auto max-w-7xl px-4 pt-12">
            <div className="mb-6 flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-title text-2xl">{results.length ? `${results.length} tool${results.length === 1 ? '' : 's'} for “${q.trim()}”` : `No tools match “${q.trim()}”`}</h2>
              <button type="button" onClick={() => setQ('')} className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">
                Clear search
              </button>
            </div>
            {results.length ? <ToolGrid tools={results} animate={!reduce} /> : <p className="text-muted">Try “merge”, “word”, “compress” or “sign”.</p>}
          </motion.section>
        ) : (
          <motion.div key="catalog" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tween}>
            <FilterBar filter={filter} setFilter={setFilter} />
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

// ---- hero -------------------------------------------------------------------------------------------

function Hero({ q, setQ, onPick }: { q: string; setQ: (v: string) => void; onPick: (c: ToolCategory) => void }) {
  const reduce = useReducedMotion()
  const openPalette = useCommandPalette((s) => s.setOpen)
  const hosted = useAccountsEnabled()
  const item = reduce ? undefined : staggerItem

  return (
    <section className="relative isolate overflow-hidden border-b border-border/60">
      {/* Background: grid + one soft blob per category hue. */}
      <div className="bg-grid absolute inset-0 -z-20 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_78%)]" aria-hidden="true" />
      <div className="pointer-events-none absolute -top-48 left-1/2 -z-10 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-brand-500)_26%,transparent),transparent)] blur-2xl motion-safe:animate-drift" aria-hidden="true" />
      <div className="pointer-events-none absolute -left-40 top-10 -z-10 h-[420px] w-[520px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-cat-convert-to-500)_22%,transparent),transparent)] blur-2xl motion-safe:animate-drift-slow" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-40 top-0 -z-10 h-[460px] w-[560px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-cat-edit-500)_20%,transparent),transparent)] blur-2xl motion-safe:animate-drift" aria-hidden="true" />
      <div className="pointer-events-none absolute right-1/4 bottom-0 -z-10 h-[380px] w-[520px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-cat-convert-from-500)_18%,transparent),transparent)] blur-2xl motion-safe:animate-drift-slow" aria-hidden="true" />
      <div className="pointer-events-none absolute left-1/4 bottom-10 -z-10 h-[320px] w-[460px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-cat-review-500)_18%,transparent),transparent)] blur-2xl motion-safe:animate-drift" aria-hidden="true" />
      <div className="bg-noise pointer-events-none absolute inset-0 -z-10 dark:mix-blend-screen" aria-hidden="true" />

      <motion.div variants={reduce ? undefined : staggerContainer(0.07, 0.05)} initial="initial" animate="animate" className="mx-auto max-w-7xl px-4 pt-14 pb-12 text-center sm:pt-20 sm:pb-16">
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
          Merge, convert, edit, sign, compress and protect PDFs in seconds. Pick a tool, drop your file, download the result.
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
              placeholder={`Search ${TOOLS.length} tools, e.g. “compress”`}
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
              <button type="button" onClick={() => openPalette(true)} className="hidden items-center gap-0.5 rounded-md p-1 transition hover:bg-surface-2 sm:inline-flex" aria-label="Open command palette">
                <Kbd>{modKey()}</Kbd>
                <Kbd>K</Kbd>
              </button>
            </div>
          </div>
        </motion.div>

        <motion.div variants={item} className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm">
          <span className="text-muted-2">Popular:</span>
          {POPULAR.map((id) => {
            const t = TOOLS_BY_ID[id]
            if (!t) return null
            const acc = categoryAccent(t.category)
            return (
              <Link key={id} to={`/tools/${id}`} style={acc.style as CSSProperties} className={clsx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ring-[color-mix(in_oklab,var(--accent)_30%,transparent)] transition hover:-translate-y-px hover:shadow-glow', acc.chip)}>
                <Icon3D icon={t.icon} palette={pal(t.category)} size={18} />
                {t.name}
              </Link>
            )
          })}
        </motion.div>

        <motion.ul variants={item} className="mx-auto mt-5 flex max-w-xl flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[13px] text-muted">
          {[hosted ? 'Free plan, no card needed' : 'Free and open source', 'Files deleted after 24 hours', 'Nothing to install'].map((t) => (
            <li key={t} className="inline-flex items-center gap-1.5">
              <Check size={14} className="text-emerald-500" aria-hidden="true" />
              {t}
            </li>
          ))}
        </motion.ul>

        {/* Category tiles: the colour key for the whole page. */}
        <motion.div variants={item} className="mt-12">
          <div className="text-eyebrow mb-4 text-muted-2">Browse by category</div>
          <motion.ul variants={reduce ? undefined : staggerContainer(0.05, 0.15)} className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {CATEGORY_ORDER.map((c, i) => (
              <CategoryTile key={c} cat={c} index={i} onPick={() => onPick(c)} />
            ))}
          </motion.ul>
        </motion.div>
      </motion.div>
    </section>
  )
}

function CategoryTile({ cat, index, onPick }: { cat: ToolCategory; index: number; onPick: () => void }) {
  const reduce = useReducedMotion()
  const acc = categoryAccent(cat)
  const tilt = useTilt()
  const count = toolsInCategory(cat).length
  return (
    <motion.li variants={reduce ? undefined : staggerItem}>
      <button
        type="button"
        onClick={onPick}
        {...tilt}
        style={acc.style as CSSProperties}
        className={clsx(
          'group flex h-full w-full flex-col items-center gap-3 rounded-2xl border border-[color-mix(in_oklab,var(--accent)_28%,var(--color-border))] px-2 pt-5 pb-4 text-center shadow-soft transition-[transform,box-shadow,border-color] duration-200',
          'bg-[linear-gradient(180deg,color-mix(in_oklab,var(--accent)_16%,var(--color-surface)),var(--color-surface)_80%)] hover:-translate-y-1 hover:border-[color-mix(in_oklab,var(--accent)_55%,var(--color-border))] hover:shadow-glow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
        )}
      >
        <span style={{ animationDelay: `${(index % 4) * 0.45}s` }} className="motion-safe:animate-float">
          <Icon3D icon={CATEGORY_META[cat].icon} palette={pal(cat)} size={56} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] leading-tight font-semibold text-fg">{CATEGORY_LABELS[cat]}</span>
          <span className={clsx('mt-1 block text-[11px] font-medium', acc.text)}>{count} tools</span>
        </span>
      </button>
    </motion.li>
  )
}

// ---- filter bar ----------------------------------------------------------------------------------------

function FilterBar({ filter, setFilter }: { filter: Filter; setFilter: (f: Filter) => void }) {
  const reduce = useReducedMotion()
  const items: { id: Filter; label: string; count: number; icon: string }[] = [
    { id: 'all', label: 'All tools', count: TOOLS.length, icon: 'LayoutGrid' },
    ...CATEGORY_ORDER.map((c) => ({ id: c as Filter, label: CATEGORY_LABELS[c], count: toolsInCategory(c).length, icon: CATEGORY_META[c].icon })),
  ]
  return (
    <nav aria-label="Tool categories" className="glass sticky top-14 z-30 border-b border-border/60">
      <div role="tablist" aria-label="Filter tools by category" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-2.5 [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-28px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((it) => {
          const active = it.id === filter
          const acc = it.id === 'all' ? null : categoryAccent(it.id)
          const palette: Palette = it.id === 'all' ? 'brand' : pal(it.id)
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
              className={clsx('group relative inline-flex shrink-0 items-center gap-2 rounded-full py-1.5 pr-3 pl-1.5 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]', active ? 'text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg')}
            >
              {active && <motion.span layoutId="cat-tab" transition={reduce ? instant : spring} className="absolute inset-0 rounded-full bg-[color-mix(in_oklab,var(--accent)_14%,var(--color-surface))] shadow-soft ring-1 ring-inset ring-[color-mix(in_oklab,var(--accent)_40%,transparent)]" aria-hidden="true" />}
              <Icon3D icon={it.icon} palette={palette} size={24} className="relative" />
              <span className="relative">{it.label}</span>
              <span className={clsx('relative rounded-full px-1.5 text-[11px] tabular transition-colors', active ? 'bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-[var(--accent)]' : 'bg-surface-2 text-muted-2')}>{it.count}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

// ---- catalog --------------------------------------------------------------------------------------------

function Catalog({ filter }: { filter: Filter }) {
  const reduce = useReducedMotion()
  const cats = filter === 'all' ? CATEGORY_ORDER : [filter]
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={filter} role="tabpanel" initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease } }} exit={{ opacity: 0, y: -8, transition: { duration: 0.12 } }}>
        {cats.map((c) => (
          <CategorySection key={c} cat={c} />
        ))}
      </motion.div>
    </AnimatePresence>
  )
}

function CategorySection({ cat }: { cat: ToolCategory }) {
  const reduce = useReducedMotion()
  const acc = categoryAccent(cat)
  const meta = CATEGORY_META[cat]
  const tools = toolsInCategory(cat)
  return (
    <section id={`cat-${cat}`} className="pt-8 first:pt-10" aria-labelledby={`cat-${cat}-h`} style={{ ...(acc.style as CSSProperties), ...paletteVars(pal(cat)) }}>
      <div className="section-wash rounded-[1.75rem] p-5 ring-1 ring-inset ring-[color-mix(in_oklab,var(--accent)_16%,transparent)] sm:p-7">
        <motion.header
          initial={reduce ? false : { opacity: 0, x: -12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '0px 0px -10% 0px' }}
          transition={{ duration: 0.35, ease }}
          className="group mb-6 flex items-center gap-4"
        >
          <Icon3D icon={meta.icon} palette={pal(cat)} size={60} />
          <div className="min-w-0 flex-1">
            <div className={clsx('text-eyebrow', acc.text)}>{meta.eyebrow}</div>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 id={`cat-${cat}-h`} className="text-title text-2xl sm:text-[1.75rem]">
                {CATEGORY_LABELS[cat]}
              </h2>
              <span className="text-sm text-muted-2 tabular">{tools.length} tools</span>
            </div>
            <p className="mt-1 hidden max-w-[70ch] text-[15px] text-muted text-pretty sm:block">{meta.blurb}</p>
          </div>
        </motion.header>
        <ToolGrid tools={tools} animate={!reduce} />
      </div>
    </section>
  )
}

function ToolGrid({ tools, animate }: { tools: ToolDef[]; animate: boolean }) {
  return (
    <motion.ul variants={animate ? staggerContainer(0.03) : undefined} initial={animate ? 'initial' : false} whileInView={animate ? 'animate' : undefined} viewport={{ once: true, margin: '0px 0px -8% 0px' }} className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
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
  const tilt = useTilt()
  return (
    <motion.li variants={animate ? staggerItem : undefined} className="min-w-0">
      <Link
        to={`/tools/${tool.id}`}
        {...tilt}
        style={acc.style as CSSProperties}
        className={clsx(
          'group card-wash relative flex h-full flex-col items-center gap-3 overflow-hidden rounded-2xl border border-[color-mix(in_oklab,var(--accent)_22%,var(--color-border))] bg-surface px-3 pt-5 pb-4 text-center shadow-card transition-[transform,box-shadow,border-color] duration-200 ease-out',
          'hover:-translate-y-1 hover:border-[color-mix(in_oklab,var(--accent)_55%,var(--color-border))] hover:shadow-glow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
          'sm:flex-row sm:items-start sm:gap-4 sm:p-4 sm:text-left',
        )}
      >
        <span className="pointer-events-none absolute -top-14 -right-14 size-36 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_30%,transparent),transparent)] opacity-50 transition-[opacity,transform] duration-300 group-hover:scale-125 group-hover:opacity-100" aria-hidden="true" />
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[color-mix(in_oklab,var(--accent)_65%,transparent)] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden="true" />

        <Icon3D icon={tool.icon} palette={pal(tool.category)} size={50} className="relative" />

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
                <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--accent)] uppercase">
                  <WandSparkles size={10} aria-hidden="true" /> Editor
                </span>
              )}
              {locked && <TierBadge tier={locked} locked size="xs" srLabel="plan required" />}
            </span>
          )}
        </span>
        <ArrowUpRight size={16} className="absolute top-4 right-3.5 hidden -translate-x-1 translate-y-1 text-[var(--accent)] opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100 sm:block" aria-hidden="true" />
      </Link>
    </motion.li>
  )
}

// ---- how it works ---------------------------------------------------------------------------------------

function HowItWorks() {
  const reduce = useReducedMotion()
  const steps: { icon: string; palette: Palette; title: string; text: string }[] = [
    { icon: 'Upload', palette: 'cat-convert-to', title: 'Drop your file', text: 'Pick a tool and drag in a PDF, Office document or image — or paste it.' },
    { icon: 'SlidersHorizontal', palette: 'cat-organize', title: 'Adjust if you like', text: 'Sensible defaults are already set. Tweak pages, quality or layout when you need to.' },
    { icon: 'Download', palette: 'cat-convert-from', title: 'Download the result', text: 'Get your file in seconds, or send it straight into another tool.' },
  ]
  return (
    <section className="mt-24" aria-labelledby="how-h">
      <div className="mb-10 text-center">
        <div className="text-eyebrow text-brand-600 dark:text-brand-300">How it works</div>
        <h2 id="how-h" className="text-title mt-2 text-3xl sm:text-4xl">
          Three steps. <span className="text-gradient">No learning curve.</span>
        </h2>
      </div>
      <motion.ol variants={reduce ? undefined : staggerContainer(0.15)} initial={reduce ? false : 'initial'} whileInView={reduce ? undefined : 'animate'} viewport={{ once: true, margin: '0px 0px -10% 0px' }} className="grid gap-6 sm:grid-cols-3">
        {steps.map((s, i) => (
          <motion.li key={s.title} variants={reduce ? undefined : staggerItem} style={{ '--accent': `var(--color-${s.palette}-500)` } as CSSProperties} className="group card-wash relative flex flex-col items-center overflow-hidden rounded-2xl border border-[color-mix(in_oklab,var(--accent)_22%,var(--color-border))] bg-surface p-6 text-center shadow-card">
            <span className="absolute top-4 left-4 grid size-7 place-items-center rounded-full bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-xs font-bold text-[var(--accent)]">{i + 1}</span>
            <Icon3D icon={s.icon} palette={s.palette} size={72} float />
            <h3 className="text-title mt-5 text-lg">{s.title}</h3>
            <p className="mt-1.5 max-w-[30ch] text-sm leading-relaxed text-muted text-pretty">{s.text}</p>
          </motion.li>
        ))}
      </motion.ol>
    </section>
  )
}

// ---- why folio ------------------------------------------------------------------------------------------

function WhyFolio() {
  const reduce = useReducedMotion()
  const hosted = useAccountsEnabled()
  const facts: { icon: string; palette: Palette; eyebrow: string; title: string; text: string; link?: { to: string; label: string } }[] = [
    { icon: 'Lock', palette: 'cat-security', eyebrow: 'Privacy', title: 'Your files stay yours', text: 'Files are processed privately, never shared, and deleted automatically after 24 hours.' },
    { icon: 'Layers', palette: 'brand', eyebrow: 'Breadth', title: `${TOOLS.length} tools, one place`, text: 'Organize, convert, edit, sign, compress, protect and compare — and chain one tool into the next.' },
    hosted
      ? { icon: 'Sparkles', palette: 'cat-review', eyebrow: 'Fair pricing', title: 'Free to start', text: 'The everyday tools are free. Upgrade only when you need more power, bigger files or the API.', link: { to: '/pricing', label: 'See plans' } }
      : { icon: 'Infinity', palette: 'cat-review', eyebrow: 'Freedom', title: 'No limits, no sign-up', text: 'Self-hosted and open source: no file-size caps, no daily quotas and no watermarks on your files.' },
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
          <motion.li key={f.title} variants={reduce ? undefined : staggerItem} style={{ '--accent': `var(--color-${f.palette}-500)` } as CSSProperties} className="group card-wash relative flex flex-col overflow-hidden rounded-2xl border border-[color-mix(in_oklab,var(--accent)_22%,var(--color-border))] bg-surface p-6 shadow-card">
            <span className="pointer-events-none absolute -top-16 -right-16 size-44 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_24%,transparent),transparent)]" aria-hidden="true" />
            <Icon3D icon={f.icon} palette={f.palette} size={56} />
            <div className="text-eyebrow mt-5 text-[var(--accent)]">{f.eyebrow}</div>
            <h3 className="text-title mt-1 text-lg">{f.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted text-pretty">{f.text}</p>
            {f.link && (
              <Link to={f.link.to} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent)]">
                {f.link.label} <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            )}
          </motion.li>
        ))}
      </motion.ul>
    </section>
  )
}
