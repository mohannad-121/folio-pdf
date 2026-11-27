import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {ArrowUpRight, Infinity as InfinityIcon, Search, Server, Sparkles, WandSparkles, X } from 'lucide-react'
import clsx from 'clsx'
import { CATEGORY_LABELS, CATEGORY_ORDER, TOOLS, type ToolCategory, type ToolDef } from '../lib/tools'
import { CATEGORY_META, categoryAccent } from '../lib/theme'
import { instant, spring, staggerContainer, staggerItem, tween } from '../lib/motion'
import ToolIcon from '../components/ToolIcon'
import { fuzzyScore, useCommandPalette } from '../components/CommandPalette'
import { Badge, Kbd, modKey } from '../components/ui'

const SECTION_IDS: Record<string, string> = { popular: 'popular', ...Object.fromEntries(CATEGORY_ORDER.map((c) => [c, `cat-${c}`])) }

export default function Home() {
  const [q, setQ] = useState('')
  const reduce = useReducedMotion()
  const openPalette = useCommandPalette((s) => s.setOpen)
  const filtered = useMemo(() => {
    const s = q.trim()
    if (!s) return TOOLS
    return TOOLS.map((t) => ({ t, score: Math.max(fuzzyScore(s, t.name) * 2, fuzzyScore(s, t.id), fuzzyScore(s, t.description) * 0.6) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.t)
  }, [q])

  return (
    <div className="pb-20">
      <Hero q={q} setQ={setQ} onPalette={() => openPalette(true)} />

      <AnimatePresence mode="wait" initial={false}>
        {q ? (
          <motion.div key="results" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={tween} className="mx-auto max-w-7xl px-4">
            <Section id="results" eyebrow="Search" title={`${filtered.length} result${filtered.length === 1 ? '' : 's'} for “${q.trim()}”`} tools={filtered} animateIn={false} />
            {filtered.length === 0 && (
              <div className="mt-12 text-center">
                <p className="text-muted">Nothing matches. Try “merge”, “word”, “ocr” or “sign”.</p>
                <button type="button" onClick={() => setQ('')} className="mt-3 text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">
                  Clear search
                </button>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="catalog" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tween}>
            <CategoryNav />
            <div className="mx-auto max-w-7xl px-4">
              <Popular />
              {CATEGORY_ORDER.map((cat) => (
                <Section key={cat} id={SECTION_IDS[cat]} category={cat} eyebrow={CATEGORY_META[cat].eyebrow} title={CATEGORY_LABELS[cat]} blurb={CATEGORY_META[cat].blurb} tools={TOOLS.filter((t) => t.category === cat)} />
              ))}
              <WhyFolio />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------

function Hero({ q, setQ, onPalette }: { q: string; setQ: (v: string) => void; onPalette: () => void }) {
  const ref = useRef<HTMLElement>(null)
  const reduce = useReducedMotion()
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  const container = staggerContainer(0.07, 0.05)

  return (
    <section ref={ref} onMouseMove={onMove} className="relative isolate overflow-hidden border-b border-border/60">
      {/* Background layers */}
      <div className="bg-grid absolute inset-0 -z-20 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" aria-hidden="true" />
      <div className="spotlight absolute inset-0 -z-10 transition-[background] duration-300" aria-hidden="true" />
      <div className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-brand-500)_26%,transparent),transparent)] blur-2xl motion-safe:animate-drift" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-40 top-10 -z-10 h-[420px] w-[520px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-cat-review-500)_20%,transparent),transparent)] blur-2xl motion-safe:animate-drift-slow" aria-hidden="true" />
      <div className="pointer-events-none absolute -left-32 top-24 -z-10 h-[360px] w-[460px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-cat-convert-from-500)_18%,transparent),transparent)] blur-2xl motion-safe:animate-drift" aria-hidden="true" />
      <div className="bg-noise pointer-events-none absolute inset-0 -z-10 dark:mix-blend-screen" aria-hidden="true" />

      <motion.div variants={reduce ? undefined : container} initial="initial" animate="animate" className="mx-auto max-w-7xl px-4 pt-14 pb-14 text-center sm:pt-24 sm:pb-20">
        <motion.div variants={reduce ? undefined : staggerItem} className="flex justify-center">
          <Badge tone="brand" size="md" dot className="shadow-soft">
            Self-hosted · {TOOLS.length} tools · No limits
          </Badge>
        </motion.div>
        <motion.h1 variants={reduce ? undefined : staggerItem} className="text-display mx-auto mt-6 max-w-4xl text-[2.75rem] sm:text-6xl lg:text-7xl">
          Every PDF tool.
          <br className="hidden sm:block" /> One place. <span className="text-gradient">Yours.</span>
        </motion.h1>
        <motion.p variants={reduce ? undefined : staggerItem} className="mx-auto mt-6 max-w-[42ch] text-base leading-relaxed text-muted text-pretty sm:text-lg">
          Merge, split, edit, convert, compress, OCR, sign, protect and compare PDFs — all running on your own machine. Nothing is uploaded anywhere else.
        </motion.p>

        <motion.div variants={reduce ? undefined : staggerItem} className="relative mx-auto mt-9 max-w-xl">
          <div className="group relative" style={{ '--accent': 'var(--color-brand-500)' } as CSSProperties}>
            <Search className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted-2 transition-colors group-focus-within:text-brand-500" size={18} aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQ('')
              }}
              placeholder="Search tools… e.g. “word”, “compress”, “sign”"
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

        <motion.div variants={reduce ? undefined : staggerItem} className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm">
          <span className="text-muted-2">Try:</span>
          {['merge', 'compress', 'pdf-to-word', 'sign', 'ocr'].map((id) => {
            const t = TOOLS.find((x) => x.id === id)
            if (!t) return null
            const acc = categoryAccent(t.category)
            return (
              <Link key={id} to={`/tools/${id}`} style={acc.style as CSSProperties} className={clsx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ring-[color-mix(in_oklab,var(--accent)_25%,transparent)] transition hover:-translate-y-px hover:shadow-glow', acc.chip)}>
                <ToolIcon name={t.icon} size={12} />
                {t.name}
              </Link>
            )
          })}
        </motion.div>
      </motion.div>
    </section>
  )
}

// ---------------------------------------------------------------------------

function CategoryNav() {
  const [active, setActive] = useState<string>(SECTION_IDS.popular)
  const reduce = useReducedMotion()
  const items = useMemo(() => [{ id: SECTION_IDS.popular, label: 'Popular', cat: null as ToolCategory | null }, ...CATEGORY_ORDER.map((c) => ({ id: SECTION_IDS[c], label: CATEGORY_LABELS[c], cat: c }))], [])

  useEffect(() => {
    const sections = items.map((i) => document.getElementById(i.id)).filter((x): x is HTMLElement => !!x)
    if (!sections.length) return
    const visible = new Map<string, number>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top)
          else visible.delete(e.target.id)
        }
        if (visible.size) {
          // Topmost visible section wins.
          const top = [...visible.entries()].sort((a, b) => a[1] - b[1])[0][0]
          setActive(top)
        }
      },
      { rootMargin: '-120px 0px -55% 0px', threshold: [0, 0.1, 0.5] },
    )
    sections.forEach((s) => io.observe(s))
    return () => io.disconnect()
  }, [items])

  // Keep the active pill scrolled into view on small screens.
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>(`[data-id="${active}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }, [active, reduce])

  return (
    <nav ref={navRef} aria-label="Categories" className="glass sticky top-14 z-30 border-b border-border/60">
      <ul className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((it) => {
          const isActive = it.id === active
          const acc = it.cat ? categoryAccent(it.cat) : null
          return (
            <li key={it.id} className="shrink-0">
              <a
                href={`#${it.id}`}
                data-id={it.id}
                aria-current={isActive ? 'true' : undefined}
                onClick={(e) => {
                  e.preventDefault()
                  const el = document.getElementById(it.id)
                  if (!el) return
                  const y = el.getBoundingClientRect().top + window.scrollY - 112
                  window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' })
                  setActive(it.id)
                }}
                style={acc?.style as CSSProperties | undefined}
                className={clsx('relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors', isActive ? 'text-fg' : 'text-muted hover:text-fg')}
              >
                {isActive && <motion.span layoutId="cat-pill" transition={reduce ? instant : spring} className="absolute inset-0 rounded-full bg-[color-mix(in_oklab,var(--accent,var(--color-brand-500))_14%,transparent)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--accent,var(--color-brand-500))_35%,transparent)]" aria-hidden="true" />}
                <span className={clsx('relative size-1.5 rounded-full', acc ? acc.bg : 'bg-brand-500')} aria-hidden="true" />
                <span className="relative">{it.label}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

// ---------------------------------------------------------------------------

function SectionHeader({ id, eyebrow, title, blurb, count, tile, accentText }: { id: string; eyebrow?: string; title: string; blurb?: string; count: number; tile?: React.ReactNode; accentText?: string }) {
  return (
    <div className="mb-6 flex items-start gap-4">
      {tile}
      <div className="min-w-0 flex-1">
        {eyebrow && <div className={clsx('text-eyebrow mb-1', accentText ?? 'text-brand-600 dark:text-brand-300')}>{eyebrow}</div>}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id={`${id}-h`} className="text-title text-2xl sm:text-[1.75rem]">
            {title}
          </h2>
          <span className="text-sm text-muted-2 tabular">
            {count} tool{count === 1 ? '' : 's'}
          </span>
        </div>
        {blurb && <p className="mt-1.5 max-w-[60ch] text-[15px] leading-relaxed text-muted text-pretty">{blurb}</p>}
      </div>
    </div>
  )
}

/** Bento-style featured grid: the first two tools are large, the rest regular. */
function Popular() {
  const reduce = useReducedMotion()
  const tools = TOOLS.filter((t) => t.featured)
  if (!tools.length) return null
  const [a, b, ...rest] = tools
  // The two large cards take 2 columns each; widen leading regular cards so every row is full.
  const popularSpans = fillSpans(rest.length, { sm: [2, 4], lg: [4, 4] })
  return (
    <section id={SECTION_IDS.popular} className="scroll-mt-28 pt-14" aria-labelledby="popular-h">
      <SectionHeader
        id="popular"
        eyebrow="Start here"
        title="Popular"
        blurb="The tools people reach for every day. Drop a file on any of them and you are two clicks from a download."
        count={tools.length}
        tile={
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br from-brand-500 to-cat-organize-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_8px_20px_-8px_var(--color-brand-500)]" aria-hidden="true">
            <Sparkles size={18} />
          </span>
        }
      />
      <motion.ul
        variants={reduce ? undefined : staggerContainer(0.035)}
        initial={reduce ? false : 'initial'}
        whileInView={reduce ? undefined : 'animate'}
        viewport={{ once: true, margin: '0px 0px -10% 0px' }}
        className="grid grid-flow-row-dense grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {a && <ToolCard tool={a} animate={!reduce} large />}
        {b && <ToolCard tool={b} animate={!reduce} large />}
        {rest.map((t, i) => (
          <ToolCard key={t.id} tool={t} animate={!reduce} spanClass={popularSpans[i]} />
        ))}
      </motion.ul>
    </section>
  )
}

function Section({ id, title, eyebrow, blurb, tools, category, animateIn = true }: { id: string; title: string; eyebrow?: string; blurb?: string; tools: ToolDef[]; category?: ToolCategory; animateIn?: boolean }) {
  const reduce = useReducedMotion()
  if (!tools.length) return null
  const acc = category ? categoryAccent(category) : null
  const container = staggerContainer(0.035)
  const spans = fillSpans(tools.length, { sm: [2, 0], lg: [3, 0], xl: [4, 0] })
  return (
    <section id={id} className="scroll-mt-24 pt-10" aria-labelledby={`${id}-h`} style={acc?.style as CSSProperties | undefined}>
      <div className={clsx('rounded-[1.75rem] p-5 sm:p-7', category && 'section-wash ring-1 ring-inset ring-[color-mix(in_oklab,var(--accent)_12%,transparent)]')}>
        <SectionHeader
          id={id}
          eyebrow={eyebrow}
          title={title}
          blurb={blurb}
          count={tools.length}
          accentText={acc?.text}
          tile={
            category ? (
              <span className={clsx('grid size-10 shrink-0 place-items-center rounded-xl shadow-[0_8px_20px_-8px_var(--accent)]', acc?.tile)} aria-hidden="true">
                <ToolIcon name={CATEGORY_META[category].icon} size={18} />
              </span>
            ) : undefined
          }
        />
        <motion.ul
          variants={reduce || !animateIn ? undefined : container}
          initial={animateIn && !reduce ? 'initial' : false}
          whileInView={animateIn && !reduce ? 'animate' : undefined}
          viewport={{ once: true, margin: '0px 0px -10% 0px' }}
          className="grid grid-flow-row-dense grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {tools.map((t, i) => (
            <ToolCard key={t.id} tool={t} animate={animateIn && !reduce} spanClass={spans[i]} />
          ))}
        </motion.ul>
      </div>
    </section>
  )
}

/*
 * Grid filling. For each breakpoint we know the column count and how many
 * columns are already taken by fixed-size cards before these ones. Any
 * leftover cells in the final row are absorbed by widening the leading cards
 * to span 2 columns; `grid-flow-row-dense` backfills so no holes remain.
 * Class strings are spelled out literally so Tailwind emits them.
 */
const SPAN_CLASSES: Record<'sm' | 'lg' | 'xl', [string, string]> = {
  sm: ['sm:col-span-1', 'sm:col-span-2'],
  lg: ['lg:col-span-1', 'lg:col-span-2'],
  xl: ['xl:col-span-1', 'xl:col-span-2'],
}

function fillSpans(n: number, bps: Partial<Record<'sm' | 'lg' | 'xl', [cols: number, taken: number]>>): string[] {
  const out: string[][] = Array.from({ length: n }, () => [])
  for (const bp of ['sm', 'lg', 'xl'] as const) {
    const cfg = bps[bp]
    if (!cfg) continue
    const [cols, taken] = cfg
    const used = taken + n
    const extra = Math.min(n, (cols - (used % cols)) % cols)
    for (let i = 0; i < n; i++) out[i].push(SPAN_CLASSES[bp][i < extra ? 1 : 0])
  }
  return out.map((c) => c.join(' '))
}

function ToolCard({ tool, animate, large, spanClass }: { tool: ToolDef; animate: boolean; large?: boolean; spanClass?: string }) {
  const acc = categoryAccent(tool.category)
  return (
    <motion.li variants={animate ? staggerItem : undefined} className={clsx('min-w-0', large ? 'sm:col-span-2' : spanClass)}>
      <Link
        to={`/tools/${tool.id}`}
        style={acc.style as CSSProperties}
        className={clsx(
          'group relative flex h-full overflow-hidden rounded-2xl border border-border bg-surface shadow-card transition-[transform,box-shadow,border-color] duration-200 ease-out',
          'hover:-translate-y-1 hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--color-border))] hover:shadow-glow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
          large ? 'card-wash-strong flex-col gap-5 p-6 sm:flex-row sm:items-center sm:gap-6 sm:p-7' : 'card-wash flex-col gap-4 p-5',
        )}
      >
        {/* Accent glow in the corner, stronger on hover. */}
        <span className={clsx('pointer-events-none absolute -top-16 -right-16 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_28%,transparent),transparent)] transition-[opacity,transform] duration-300 group-hover:scale-125 group-hover:opacity-100', large ? 'size-56 opacity-70' : 'size-40 opacity-40')} aria-hidden="true" />
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[color-mix(in_oklab,var(--accent)_55%,transparent)] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden="true" />

        {large ? (
          <span className="relative grid size-16 shrink-0 place-items-center rounded-2xl shadow-[0_12px_28px_-10px_var(--accent)] transition-transform duration-300 ease-[var(--ease-spring)] group-hover:-rotate-6 group-hover:scale-105">
            <span className={clsx('absolute inset-0 grid place-items-center rounded-2xl', acc.tile)}>
              <ToolIcon name={tool.icon} size={30} />
            </span>
          </span>
        ) : (
          <span className="relative flex items-start justify-between">
            <span className={clsx('grid size-11 shrink-0 place-items-center rounded-xl shadow-[0_8px_20px_-10px_var(--accent)] transition-transform duration-300 ease-[var(--ease-spring)] group-hover:-rotate-6 group-hover:scale-105', acc.tile)}>
              <ToolIcon name={tool.icon} size={22} />
            </span>
            <span className="grid size-8 place-items-center rounded-full border border-[color-mix(in_oklab,var(--accent)_30%,var(--color-border))] text-[var(--accent)] opacity-0 transition-[opacity,transform] duration-200 -translate-x-1 translate-y-1 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100" aria-hidden="true">
              <ArrowUpRight size={15} />
            </span>
          </span>
        )}

        <span className="relative min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={clsx('text-title truncate', large ? 'text-xl' : 'text-base')}>{tool.name}</span>
            {tool.opensViewer && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--accent)] uppercase">
                <WandSparkles size={10} aria-hidden="true" /> Editor
              </span>
            )}
          </span>
          <span className={clsx('mt-1.5 text-muted text-pretty', large ? 'block text-[15px] leading-relaxed' : 'line-clamp-2 text-sm leading-relaxed')}>{tool.description}</span>
          {large && (
            <span className={clsx('mt-4 inline-flex items-center gap-1.5 text-sm font-semibold', acc.text)}>
              Open tool <ArrowUpRight size={15} className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </span>
          )}
        </span>
      </Link>
    </motion.li>
  )
}

// ---------------------------------------------------------------------------

function WhyFolio() {
  const reduce = useReducedMotion()
  const facts = [
    { Icon: Server, eyebrow: 'Privacy', title: 'Private by design', text: 'Runs on your machine or server. Files stay in your Docker volume and expire after 24 hours.', accent: 'var(--color-cat-convert-from-500)' },
    { Icon: WandSparkles, eyebrow: 'Breadth', title: `${TOOLS.length} tools, one UI`, text: 'Organize, edit, convert, compress, OCR, sign, protect and compare — chained together in a click.', accent: 'var(--color-brand-500)' },
    { Icon: InfinityIcon, eyebrow: 'Freedom', title: 'No limits, no accounts', text: 'No file-size caps, no daily quotas, no watermarks, no sign-up. Open source under MIT.', accent: 'var(--color-cat-review-500)' },
  ]
  return (
    <section className="mt-24" aria-labelledby="why-h">
      <div className="mb-8 text-center">
        <div className="text-eyebrow text-brand-600 dark:text-brand-300">Why Folio</div>
        <h2 id="why-h" className="text-title mt-2 text-3xl sm:text-4xl">
          Acrobat-class tools, <span className="text-gradient">zero cloud</span>.
        </h2>
      </div>
      <motion.ul variants={reduce ? undefined : staggerContainer(0.08)} initial={reduce ? false : 'initial'} whileInView={reduce ? undefined : 'animate'} viewport={{ once: true, margin: '0px 0px -10% 0px' }} className="grid gap-4 sm:grid-cols-3">
        {facts.map((f) => (
          <motion.li key={f.title} variants={reduce ? undefined : staggerItem} style={{ '--accent': f.accent } as CSSProperties} className="card-wash relative overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-card">
            <span className="pointer-events-none absolute -top-16 -right-16 size-44 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_22%,transparent),transparent)]" aria-hidden="true" />
            <span className="grid size-11 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-[var(--accent)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--accent)_30%,transparent)]">
              <f.Icon size={22} />
            </span>
            <div className="text-eyebrow mt-5 text-[var(--accent)]">{f.eyebrow}</div>
            <h3 className="text-title mt-1 text-lg">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted text-pretty">{f.text}</p>
          </motion.li>
        ))}
      </motion.ul>
    </section>
  )
}
