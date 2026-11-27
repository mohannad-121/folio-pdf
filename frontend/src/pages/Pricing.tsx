import { useId, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, CalendarX, Check, ChevronDown, Code2 as Github, Crown, Gift, Lock, Minus, Receipt, Server, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useAuth, type Me } from '../lib/auth'
import { formatMb, formatPrice, monthlyEquivalent, tierRank, TIER_META, TIER_ORDER, toolTier, usePlans, yearlySaving, type BillingInterval, type PlanTier, type PlansResponse, type Tier, tierStyle } from '../lib/plans'
import { openBillingPortal, startCheckout, useCheckout } from '../lib/paddle'
import { CATEGORY_LABELS, CATEGORY_ORDER, TOOLS, toolsInCategory, type ToolCategory } from '../lib/tools'
import { CATEGORY_META, categoryAccent } from '../lib/theme'
import { instant, spring, staggerContainer, staggerItem, tween } from '../lib/motion'
import ToolIcon from '../components/ToolIcon'
import { TierIcon } from '../components/TierBadge'
import { Badge, Button, Segmented } from '../components/ui'

const GITHUB_URL = 'https://github.com/mohannad-121/folio-pdf'

export default function Pricing() {
  const plans = usePlans((s) => s.plans)
  const me = useAuth((s) => s.me)
  const loading = useAuth((s) => s.loading)
  const billing = !!me?.billing_enabled
  const [interval, setInterval] = useState<BillingInterval>('yearly')
  const maxSaving = Math.round(Math.max(...plans.tiers.map(yearlySaving)) * 100)

  return (
    <div className="pb-24">
      <Hero interval={interval} setInterval={setInterval} maxSaving={maxSaving} />

      <div className="mx-auto max-w-7xl px-4">
        {!loading && !billing && <SelfHostedBanner />}

        <TierGrid tiers={plans.tiers} interval={interval} me={me} billing={billing} />

        <TrustStrip />

        <Comparison plans={plans} />

        <Faq />

        {billing && (!me || me.plan === 'free') && <FinalCta interval={interval} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function Hero({ interval, setInterval, maxSaving }: { interval: BillingInterval; setInterval: (v: BillingInterval) => void; maxSaving: number }) {
  const reduce = useReducedMotion()
  const container = staggerContainer(0.07, 0.05)
  return (
    <section className="relative isolate overflow-hidden">
      <div className="bg-grid absolute inset-0 -z-20 [mask-image:radial-gradient(ellipse_at_top,black_25%,transparent_70%)]" aria-hidden="true" />
      <div className="pointer-events-none absolute -top-48 left-1/2 -z-10 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-brand-500)_28%,transparent),transparent)] blur-2xl motion-safe:animate-drift" aria-hidden="true" />
      <div className="pointer-events-none absolute top-24 -right-40 -z-10 h-[420px] w-[520px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-cat-review-500)_20%,transparent),transparent)] blur-2xl motion-safe:animate-drift-slow" aria-hidden="true" />
      <div className="pointer-events-none absolute top-40 -left-40 -z-10 h-[380px] w-[480px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-tier-max-400)_16%,transparent),transparent)] blur-2xl motion-safe:animate-drift" aria-hidden="true" />
      <div className="bg-noise pointer-events-none absolute inset-0 -z-10 dark:mix-blend-screen" aria-hidden="true" />

      <motion.div variants={reduce ? undefined : container} initial="initial" animate="animate" className="mx-auto max-w-4xl px-4 pt-14 pb-10 text-center sm:pt-20 sm:pb-14">
        <motion.div variants={reduce ? undefined : staggerItem} className="flex justify-center">
          <Badge tone="brand" size="md" className="shadow-soft">
            <Gift size={13} aria-hidden="true" /> 7-day free trial on every paid plan
          </Badge>
        </motion.div>
        <motion.h1 variants={reduce ? undefined : staggerItem} className="text-display mx-auto mt-6 max-w-4xl text-[2.5rem] text-balance sm:text-6xl lg:text-[4.25rem]">
          Simple pricing.
          <br />
          <span className="text-gradient">Every plan starts free for&nbsp;7&nbsp;days.</span>
        </motion.h1>
        <motion.p variants={reduce ? undefined : staggerItem} className="mx-auto mt-6 max-w-[46ch] text-base leading-relaxed text-muted text-pretty sm:text-lg">
          Start with the essentials for free. Upgrade when you need converters, OCR, redaction or bigger files. Cancel anytime, in two clicks.
        </motion.p>
        <motion.div variants={reduce ? undefined : staggerItem} className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Segmented
            aria-label="Billing interval"
            value={interval}
            onChange={setInterval}
            className="shadow-soft"
            options={[
              { value: 'monthly', label: 'Monthly' },
              { value: 'yearly', label: 'Yearly' },
            ]}
          />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30">
            <Sparkles size={12} aria-hidden="true" /> Save up to {maxSaving}% yearly
          </span>
        </motion.div>
      </motion.div>
    </section>
  )
}

function SelfHostedBanner() {
  return (
    <div className="card-wash mb-10 flex items-start gap-4 rounded-2xl border border-emerald-200 bg-surface p-5 shadow-card dark:border-emerald-500/30" style={{ '--accent': 'var(--color-cat-convert-from-500)' } as CSSProperties} role="status">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
        <Server size={20} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 className="font-semibold">Self-hosted edition: everything is unlocked</h2>
        <p className="mt-1 text-sm text-muted">This server runs Folio without billing, so every tool and limit is available to everyone. The plans below are shown for reference only.</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tier cards
// ---------------------------------------------------------------------------

function TierGrid({ tiers, interval, me, billing }: { tiers: PlanTier[]; interval: BillingInterval; me: Me | null; billing: boolean }) {
  const reduce = useReducedMotion()
  return (
    <motion.ul variants={reduce ? undefined : staggerContainer(0.07)} initial={reduce ? false : 'initial'} animate="animate" className="grid items-stretch gap-6 pt-4 md:grid-cols-2 xl:grid-cols-4 xl:gap-5" aria-label="Plans">
      {tiers.map((t) => (
        <TierCard key={t.id} tier={t} interval={interval} me={me} billing={billing} />
      ))}
    </motion.ul>
  )
}

interface Cta {
  label: string
  onClick?: () => void
  disabled?: boolean
  current?: boolean
}

function useCta(t: PlanTier, interval: BillingInterval, me: Me | null, billing: boolean): Cta | null {
  const openAuth = useCheckout((s) => s.openAuth)
  const setChange = useCheckout((s) => s.setChange)
  if (!billing) return null
  const user = me?.user
  const subscribed = !!me && me.plan !== 'free' && !!me.plan_status && me.plan_status !== 'canceled' && me.plan_status !== 'none'
  if (t.id === 'free') {
    if (!user) return { label: 'Get started', onClick: () => openAuth('signup') }
    if (!subscribed) return { label: 'Current plan', disabled: true, current: true }
    return { label: 'Manage billing', onClick: () => void openBillingPortal() }
  }
  if (user && me?.plan === t.id && subscribed) {
    if (!me.plan_interval || me.plan_interval === interval) return { label: 'Current plan', disabled: true, current: true }
    return { label: `Switch to ${interval}`, onClick: () => setChange({ plan: t.id as Exclude<Tier, 'free'>, interval }) }
  }
  if (subscribed) return { label: `Switch to ${t.name}`, onClick: () => void startCheckout(t.id, interval) }
  return { label: 'Start free trial', onClick: () => void startCheckout(t.id, interval) }
}

function TierCard({ tier: t, interval, me, billing }: { tier: PlanTier; interval: BillingInterval; me: Me | null; billing: boolean }) {
  const reduce = useReducedMotion()
  const busy = useCheckout((s) => s.busy)
  const cta = useCta(t, interval, me, billing)
  const meta = TIER_META[t.id]
  const featured = t.highlight
  const isMax = t.id === 'max'
  const price = monthlyEquivalent(t, interval)
  const saving = Math.round(yearlySaving(t) * 100)
  const limits: [string, ReactNode][] = [
    ['File size', formatMb(t.limits.max_file_mb)],
    ['Daily tasks', t.limits.daily_tasks == null ? 'Unlimited' : t.limits.daily_tasks],
    ['Batch', t.limits.batch ? <Check key="b" size={16} strokeWidth={2.75} className="text-[var(--accent)]" aria-label="Included" /> : <Minus key="b" size={16} className="text-muted-2" aria-label="Not included" />],
  ]

  const inkStyle: CSSProperties | undefined = isMax
    ? {
        background:
          'radial-gradient(120% 60% at 100% 0%, rgb(251 191 36 / 0.16), transparent 60%) padding-box, linear-gradient(165deg, #191628, #0b0a14) padding-box, linear-gradient(150deg, #fde68a, #b45309 45%, #fcd34d 75%, #78350f) border-box',
      }
    : undefined

  return (
    <motion.li variants={reduce ? undefined : staggerItem} className={clsx('relative min-w-0', featured && 'xl:-translate-y-4')} style={tierStyle(t.id)}>
      {featured && <div className="pointer-events-none absolute -inset-3 -z-10 rounded-[2rem] bg-linear-to-br from-brand-500/40 via-cat-organize-500/30 to-cat-review-500/30 opacity-60 blur-2xl dark:opacity-50" aria-hidden="true" />}
      <article
        aria-labelledby={`tier-${t.id}`}
        style={inkStyle}
        className={clsx(
          'relative flex h-full flex-col rounded-3xl border p-6 sm:p-7',
          featured ? 'ring-tier card-wash-strong border-[1.5px] shadow-glow' : isMax ? 'border-[1.5px] border-transparent text-white shadow-lift [--color-border:rgb(255_255_255/0.12)] [--color-muted:rgb(255_255_255/0.72)] [--color-muted-2:rgb(255_255_255/0.5)] [--color-surface-2:rgb(255_255_255/0.07)]' : clsx('border-border bg-surface shadow-card', t.id === 'plus' && 'card-wash'),
        )}
      >
        {featured && (
          <span className="absolute -top-3.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-linear-to-r from-brand-600 via-cat-organize-600 to-cat-review-600 px-3 py-1 text-[11px] font-bold tracking-wider whitespace-nowrap text-white uppercase shadow-glow">
            <Sparkles size={12} aria-hidden="true" /> Most popular
          </span>
        )}

        <header>
          <div>
            <div className="flex items-center gap-2.5">
              <span className={clsx('grid size-9 place-items-center rounded-xl bg-linear-to-br shadow-[0_8px_18px_-8px_var(--accent)]', t.id === 'free' ? 'bg-surface-2 text-muted shadow-none ring-1 ring-inset ring-border' : [meta.fill, meta.fgOnFill])}>
                <TierIcon tier={t.id} size={18} />
              </span>
              <h2 id={`tier-${t.id}`} className="text-title text-xl">
                {t.name}
              </h2>
              {isMax && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-linear-to-r from-tier-max-200 to-tier-max-400 px-2 py-0.5 text-[10px] font-bold tracking-wider text-tier-max-950 uppercase">
                  <Crown size={11} aria-hidden="true" /> Everything
                </span>
              )}
            </div>
            <p className={clsx('mt-2 text-sm text-pretty', isMax ? 'text-white/75' : 'text-muted')}>{t.tagline}</p>
          </div>
        </header>

        {/* Price */}
        <div className="mt-6">
          <div className="flex items-end gap-1.5">
            {interval === 'yearly' && t.price_monthly > 0 && <span className={clsx('mb-1.5 text-lg font-semibold line-through decoration-2', isMax ? 'text-white/40' : 'text-muted-2')}>{formatPrice(t.price_monthly)}</span>}
            <AnimatedPrice value={price} className={clsx('text-5xl font-extrabold tracking-tight', isMax && 'text-transparent bg-linear-to-br from-tier-max-100 via-tier-max-300 to-tier-max-500 bg-clip-text', featured && 'text-gradient')} />
            <span className={clsx('mb-1.5 text-sm font-medium', isMax ? 'text-white/70' : 'text-muted')}>{t.price_monthly > 0 ? '/ month' : 'forever'}</span>
          </div>
          <div className={clsx('mt-1 h-5 text-sm', isMax ? 'text-white/70' : 'text-muted')}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={`${interval}-${t.id}`} initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={tween} className="block tabular">
                {t.price_monthly === 0 ? 'No credit card required' : interval === 'yearly' ? `Billed ${formatPrice(t.price_yearly)} yearly · save ${saving}%` : `Billed monthly · or ${formatPrice(t.price_yearly)}/year`}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>

        {/* Trial chip */}
        <div className="mt-4">
          {t.trial_days > 0 ? (
            <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', isMax ? 'bg-white/10 text-tier-max-200 ring-1 ring-inset ring-white/15' : 'bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] text-[color-mix(in_oklab,var(--accent)_70%,var(--color-fg))] ring-1 ring-inset ring-[color-mix(in_oklab,var(--accent)_28%,transparent)]')}>
              <Gift size={12} aria-hidden="true" /> {t.trial_days}-day free trial
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted ring-1 ring-inset ring-border">Free forever</span>
          )}
        </div>

        {/* CTA */}
        <div className="mt-6">
          {cta ? (
            <Button
              size="lg"
              block
              variant={t.id === 'free' || cta.current ? 'secondary' : 'accent'}
              disabled={cta.disabled}
              loading={busy?.plan === t.id && busy.interval === interval}
              onClick={cta.onClick}
              className={clsx(!(t.id === 'free' || cta.current) && [meta.fill, meta.fgOnFill, 'font-semibold'], cta.current && 'disabled:opacity-100', isMax && cta.current && 'border-white/20 bg-white/10 text-white')}
              rightIcon={cta.current ? undefined : <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />}
              leftIcon={cta.current ? <Check /> : undefined}
            >
              {cta.label}
            </Button>
          ) : (
            <div className={clsx('flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-medium', isMax ? 'bg-white/10 text-white/80' : 'bg-surface-2 text-muted')}>
              <Check size={16} aria-hidden="true" /> Unlocked on this server
            </div>
          )}
        </div>

        {/* Limits */}
        <dl className={clsx('mt-6 divide-y rounded-xl border text-sm', isMax ? 'divide-white/10 border-white/12 bg-white/5' : 'divide-border border-border bg-surface-2/50')}>
          {limits.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between px-3.5 py-2">
              <dt className={isMax ? 'text-white/70' : 'text-muted'}>{k}</dt>
              <dd className="font-semibold tabular">{v}</dd>
            </div>
          ))}
        </dl>

        {/* Features */}
        <ul className="mt-6 space-y-2.5 text-sm">
          {t.features.map((f, i) => {
            const everything = i === 0 && /^everything in/i.test(f)
            return (
              <li key={f} className={clsx('flex items-start gap-2.5', everything && 'font-semibold')}>
                <span className={clsx('mt-px grid size-5 shrink-0 place-items-center rounded-full', isMax ? 'bg-tier-max-400/20 text-tier-max-300' : t.id === 'free' ? 'bg-surface-3 text-muted' : 'bg-[color-mix(in_oklab,var(--accent)_15%,transparent)] text-[var(--accent)]')}>
                  {everything ? <Sparkles size={11} aria-hidden="true" /> : <Check size={12} strokeWidth={3} aria-hidden="true" />}
                </span>
                <span className="text-pretty">{f}</span>
              </li>
            )
          })}
        </ul>
      </article>
    </motion.li>
  )
}

/** Price that rolls vertically when it changes. */
function AnimatedPrice({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion()
  const text = formatPrice(value)
  return (
    <span className={clsx('relative inline-flex overflow-hidden leading-none tabular', className)} aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          className="inline-block py-1"
          initial={reduce ? false : { y: '70%', opacity: 0, filter: 'blur(6px)' }}
          animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          exit={reduce ? undefined : { y: '-70%', opacity: 0, filter: 'blur(6px)' }}
          transition={reduce ? instant : spring}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Trust strip
// ---------------------------------------------------------------------------

function TrustStrip() {
  const items = [
    { Icon: ShieldCheck, title: 'Secure checkout by Paddle', text: 'Card details never touch our servers.', color: 'text-emerald-600 dark:text-emerald-400' },
    { Icon: CalendarX, title: 'Cancel anytime', text: 'No contracts. Two clicks in the billing portal.', color: 'text-brand-600 dark:text-brand-300' },
    { Icon: Trash2, title: 'Files auto-delete in 24h', text: 'Processed files are never kept or shared.', color: 'text-cat-optimize-600 dark:text-cat-optimize-400' },
    { Icon: Receipt, title: 'Taxes handled for you', text: 'Paddle is our Merchant of Record.', color: 'text-tier-max-700 dark:text-tier-max-300' },
  ]
  return (
    <section aria-label="Why you can trust us" className="mt-16">
      <ul className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-card sm:grid-cols-2 lg:grid-cols-4">
        {items.map(({ Icon, title, text, color }) => (
          <li key={title} className="flex items-start gap-3 bg-surface p-5">
            <Icon size={20} className={clsx('mt-0.5 shrink-0', color)} aria-hidden="true" />
            <div>
              <div className="text-sm font-semibold">{title}</div>
              <div className="mt-0.5 text-xs text-muted">{text}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Comparison table
// ---------------------------------------------------------------------------

const mdQuery = '(min-width: 768px)'
function useIsMd(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(mdQuery)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia(mdQuery).matches,
    () => true,
  )
}

type Cell = boolean | string
interface Row {
  key: string
  label: ReactNode
  cells: Record<Tier, Cell>
  required?: Tier
}
interface Group {
  id: string
  label: string
  category?: ToolCategory
  rows: Row[]
}

function buildGroups(plans: PlansResponse): Group[] {
  const by = (fn: (t: PlanTier) => Cell): Record<Tier, Cell> => Object.fromEntries(TIER_ORDER.map((id) => [id, fn(plans.tiers.find((t) => t.id === id) ?? plans.tiers[0])])) as Record<Tier, Cell>
  const groups: Group[] = [
    {
      id: 'limits',
      label: 'Limits & extras',
      rows: [
        { key: 'size', label: 'Max file size', cells: by((t) => formatMb(t.limits.max_file_mb)) },
        { key: 'daily', label: 'Daily tasks', cells: by((t) => (t.limits.daily_tasks == null ? 'Unlimited' : String(t.limits.daily_tasks))) },
        { key: 'files', label: 'Files per task', cells: by((t) => (t.limits.max_files_per_task == null ? 'Unlimited' : String(t.limits.max_files_per_task))) },
        { key: 'batch', label: 'Batch processing', cells: by((t) => t.limits.batch) },
        { key: 'priority', label: 'Priority processing', cells: by((t) => t.limits.priority_processing) },
        { key: 'api', label: 'REST API access', cells: by((t) => t.limits.api_access) },
        { key: 'seats', label: 'Team seats (coming soon)', cells: by((t) => (t.limits.team_seats > 1 ? `${t.limits.team_seats} (soon)` : '1')) },
      ],
    },
  ]
  for (const cat of CATEGORY_ORDER) {
    const tools = toolsInCategory(cat)
    if (!tools.length) continue
    groups.push({
      id: cat,
      label: CATEGORY_LABELS[cat],
      category: cat,
      rows: tools.map((tool) => {
        const req = toolTier(tool.id, plans)
        return {
          key: tool.id,
          required: req,
          label: (
            <Link to={`/tools/${tool.id}`} className="inline-flex min-w-0 items-center gap-2 rounded hover:underline">
              <ToolIcon name={tool.icon} size={14} className={clsx('shrink-0', categoryAccent(cat).text)} aria-hidden="true" />
              <span className="truncate">{tool.name}</span>
            </Link>
          ),
          cells: Object.fromEntries(TIER_ORDER.map((id) => [id, tierRank(id) >= tierRank(req)])) as Record<Tier, Cell>,
        }
      }),
    })
  }
  return groups
}

function Comparison({ plans }: { plans: PlansResponse }) {
  const groups = useMemo(() => buildGroups(plans), [plans])
  const isMd = useIsMd()
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const isOpen = (id: string) => toggled[id] ?? (isMd || id === 'limits')
  const allOpen = groups.every((g) => isOpen(g.id))

  return (
    <section className="mt-24" aria-labelledby="compare-h">
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="text-eyebrow text-brand-600 dark:text-brand-300">Compare plans</div>
        <h2 id="compare-h" className="text-title mt-2 text-3xl sm:text-4xl">
          Every tool, <span className="text-gradient">side by side</span>
        </h2>
        <p className="mt-3 max-w-[52ch] text-muted text-pretty">{TOOLS.length} tools across eight categories. Here is exactly what each plan unlocks.</p>
        <button type="button" onClick={() => setToggled(Object.fromEntries(groups.map((g) => [g.id, !allOpen])))} className="mt-4 rounded-md px-2 py-1 text-sm font-medium text-brand-600 transition hover:underline dark:text-brand-300">
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-surface shadow-card">
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
          <caption className="sr-only">Feature comparison between the Free, Plus, Pro and Max plans</caption>
          <colgroup>
            <col />
            {TIER_ORDER.map((t) => (
              <col key={t} className="w-[3.25rem] sm:w-24 lg:w-36" />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="glass sticky top-14 z-20 rounded-tl-2xl border-b border-border px-3 py-3 text-left text-xs font-medium text-muted sm:px-5">
                <span className="hidden sm:inline">Features</span>
              </th>
              {TIER_ORDER.map((t, i) => {
                const plan = plans.tiers.find((x) => x.id === t)
                return (
                  <th key={t} scope="col" style={tierStyle(t)} className={clsx('glass sticky top-14 z-20 border-b border-border px-1 py-3 text-center sm:px-2', i === TIER_ORDER.length - 1 && 'rounded-tr-2xl', t === 'pro' && 'bg-[color-mix(in_oklab,var(--color-brand-500)_8%,var(--glass))]')}>
                    <span className="flex flex-col items-center gap-1">
                      <span className={clsx('hidden size-7 place-items-center rounded-lg bg-linear-to-br sm:grid', t === 'free' ? 'bg-surface-2 text-muted ring-1 ring-inset ring-border' : [TIER_META[t].fill, TIER_META[t].fgOnFill])}>
                        <TierIcon tier={t} size={14} />
                      </span>
                      <span className={clsx('text-xs font-bold sm:text-sm', TIER_META[t].text)}>{TIER_META[t].name}</span>
                      {plan && <span className="hidden text-[11px] font-normal text-muted tabular sm:block">{plan.price_monthly ? `${formatPrice(plan.price_monthly)}/mo` : 'Free'}</span>}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          {groups.map((g) => (
            <ComparisonGroup key={g.id} group={g} open={isOpen(g.id)} onToggle={() => setToggled((m) => ({ ...m, [g.id]: !isOpen(g.id) }))} />
          ))}
        </table>
      </div>
    </section>
  )
}

function ComparisonGroup({ group: g, open, onToggle }: { group: Group; open: boolean; onToggle: () => void }) {
  const acc = g.category ? categoryAccent(g.category) : null
  return (
    <tbody style={(acc?.style ?? { '--accent': 'var(--color-brand-500)' }) as CSSProperties}>
      <tr>
        <th colSpan={5} scope="colgroup" className="p-0 text-left">
          <button type="button" onClick={onToggle} aria-expanded={open} className="section-wash flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left transition hover:bg-surface-2/60 sm:px-5">
            {acc ? (
              <span className={clsx('grid size-7 shrink-0 place-items-center rounded-lg', acc.tile)}>
                <ToolIcon name={CATEGORY_META[g.category!].icon} size={14} />
              </span>
            ) : (
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-linear-to-br from-brand-500 to-cat-organize-600 text-white">
                <Sparkles size={14} />
              </span>
            )}
            <span className={clsx('text-sm font-semibold', acc ? acc.text : 'text-fg')}>{g.label}</span>
            <span className="text-xs text-muted-2 tabular">{g.rows.length}</span>
            <ChevronDown size={16} className={clsx('ml-auto shrink-0 text-muted transition-transform duration-200', open && 'rotate-180')} aria-hidden="true" />
          </button>
        </th>
      </tr>
      {open &&
        g.rows.map((r) => (
          <tr key={r.key} className="group/row">
            <th scope="row" className="truncate border-b border-border px-3 py-2.5 text-left font-normal text-fg group-hover/row:bg-surface-2/50 sm:px-5">
              {r.label}
            </th>
            {TIER_ORDER.map((t) => (
              <td key={t} style={tierStyle(t)} className={clsx('border-b border-border px-1 py-2.5 text-center group-hover/row:bg-surface-2/50', t === 'pro' && 'bg-[color-mix(in_oklab,var(--color-brand-500)_5%,transparent)]')}>
                <CellValue value={r.cells[t]} tier={t} required={r.required} />
              </td>
            ))}
          </tr>
        ))}
    </tbody>
  )
}

function CellValue({ value, tier, required }: { value: Cell; tier: Tier; required?: Tier }) {
  if (typeof value === 'string') {
    if (value === 'Unlimited')
      return (
        <span className="text-xs font-medium sm:text-sm">
          <span className="sm:hidden" aria-hidden="true">
            ∞
          </span>
          <span className="sr-only sm:not-sr-only">Unlimited</span>
        </span>
      )
    return <span className="text-[11px] font-medium whitespace-nowrap tabular sm:text-sm">{value.replace(' (soon)', '')}</span>
  }
  if (value)
    return (
      <span className="inline-grid size-6 place-items-center rounded-full bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-[color-mix(in_oklab,var(--accent)_80%,var(--color-fg))]">
        <Check size={14} strokeWidth={3} aria-label={`Included in ${TIER_META[tier].name}`} />
      </span>
    )
  return required ? <Lock size={14} className="inline text-muted-2" aria-label={`Requires ${TIER_META[required].name}`} /> : <Minus size={14} className="inline text-muted-2" aria-label="Not included" />
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: 'How does the 7-day free trial work?',
    a: 'Pick Plus, Pro or Max and add a payment method at checkout. You get the full plan right away and are not charged for 7 days. You can cancel at any time during the trial and pay nothing.',
  },
  {
    q: 'What happens when the trial ends?',
    a: 'If you keep the plan, your first payment is taken on day 8 and renews monthly or yearly. If you cancel, your account simply moves back to the Free plan. Nothing is deleted from your account.',
  },
  {
    q: 'Can I cancel or switch plans later?',
    a: 'Yes, anytime from Account → Plan & billing. Upgrades apply immediately and are prorated, so you only pay the difference. Cancelling keeps your plan until the end of the period you already paid for.',
  },
  {
    q: 'What happens to my files?',
    a: 'Files are processed on our servers only to run the tool you chose, are never shared or used for training, and are deleted automatically within 24 hours. You can delete them sooner from the Recent files list.',
  },
  {
    q: 'Is Folio really free to self-host?',
    a: (
      <>
        Yes. Folio is open source under the MIT license. Run it on your own machine or server with Docker and every tool is unlocked with no limits.{' '}
        <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-fg underline underline-offset-2">
          <Github size={13} aria-hidden="true" /> Get it on GitHub
        </a>
        . The paid plans fund development and cover our hosted servers.
      </>
    ),
  },
  {
    q: 'Which payment methods do you accept?',
    a: 'Checkout is run by Paddle and supports major credit and debit cards, PayPal, Apple Pay and Google Pay, plus local methods in many countries.',
  },
  {
    q: 'Do you offer refunds?',
    a: 'If something is not right, contact us within 14 days of a charge and we will refund it, no questions asked. Trials are free, so you are never charged before day 8.',
  },
  {
    q: 'How are taxes and invoices handled?',
    a: 'Paddle is our Merchant of Record. It calculates and collects VAT, GST or sales tax for your country, and emails you a proper invoice for every payment. Businesses can add a tax ID at checkout.',
  },
]

function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  const reduce = useReducedMotion()
  const baseId = useId()
  return (
    <section className="mx-auto mt-24 max-w-3xl" aria-labelledby="faq-h">
      <div className="mb-8 text-center">
        <div className="text-eyebrow text-brand-600 dark:text-brand-300">FAQ</div>
        <h2 id="faq-h" className="text-title mt-2 text-3xl sm:text-4xl">
          Questions, answered
        </h2>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        {FAQ.map((item, i) => {
          const isOpen = open === i
          return (
            <li key={item.q}>
              <h3>
                <button type="button" id={`${baseId}-q${i}`} aria-expanded={isOpen} aria-controls={`${baseId}-a${i}`} onClick={() => setOpen(isOpen ? null : i)} className="flex w-full items-center gap-4 px-5 py-4 text-left text-[15px] font-medium transition hover:bg-surface-2/60 sm:px-6">
                  <span className="flex-1">{item.q}</span>
                  <span className={clsx('grid size-7 shrink-0 place-items-center rounded-full border border-border text-muted transition-[transform,background-color,color] duration-200', isOpen && 'rotate-180 border-transparent bg-brand-600 text-white')}>
                    <ChevronDown size={15} aria-hidden="true" />
                  </span>
                </button>
              </h3>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    id={`${baseId}-a${i}`}
                    role="region"
                    aria-labelledby={`${baseId}-q${i}`}
                    initial={reduce ? false : { height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={reduce ? undefined : { height: 0, opacity: 0 }}
                    transition={tween}
                    className="overflow-hidden"
                  >
                    <p className="px-5 pb-5 text-sm leading-relaxed text-muted text-pretty sm:px-6">{item.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Final CTA
// ---------------------------------------------------------------------------

function FinalCta({ interval }: { interval: BillingInterval }) {
  const busy = useCheckout((s) => s.busy)
  return (
    <section className="relative mt-24 overflow-hidden rounded-3xl bg-[linear-gradient(140deg,#1a1f4d,#2a1a5e_45%,#0b0d1f)] px-6 py-14 text-center text-white shadow-lift sm:px-12" aria-labelledby="final-cta-h">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[640px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(109_135_255/0.45),transparent)] blur-2xl" aria-hidden="true" />
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-40 [--grid-line:rgb(255_255_255/0.08)] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" aria-hidden="true" />
      <div className="relative">
        <h2 id="final-cta-h" className="text-display text-3xl sm:text-5xl">
          Try Pro free for 7 days.
        </h2>
        <p className="mx-auto mt-4 max-w-[44ch] text-white/75">OCR, redaction, compare, digital signatures and batch processing. Cancel anytime before day 8 and pay nothing.</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" variant="accent" className="min-w-56 from-white to-brand-100 font-semibold text-brand-800! hover:shadow-[0_10px_30px_-10px_rgb(255_255_255/0.6)]" loading={busy?.plan === 'pro'} rightIcon={<ArrowRight />} onClick={() => void startCheckout('pro', interval)}>
            Start free trial
          </Button>
          <a href="#compare-h" className="rounded-lg px-4 py-3 text-sm font-medium text-white/80 transition hover:text-white">
            Compare every feature
          </a>
        </div>
      </div>
    </section>
  )
}
