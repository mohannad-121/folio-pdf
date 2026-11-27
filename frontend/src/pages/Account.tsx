import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  ArrowRight,
  CalendarClock,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  KeyRound,
  Lock,
  PartyPopper,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TriangleExclamationPoint,
  User as UserIcon,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { ApiError, getJson, sendJson } from '../lib/api'
import { currentTier, daysUntil, useAccountsEnabled, useAuth, type Me } from '../lib/auth'
import { getSupabase } from '../lib/supabase'
import { formatMb, formatPrice, getPlanTier, tierCovers, TIER_META, usePlans, tierStyle } from '../lib/plans'
import { announceAuth, openBillingPortal, startCheckout, syncBilling, useCheckout } from '../lib/paddle'
import { instant, spring, tween } from '../lib/motion'
import { AuthFlow, type AuthMode } from '../components/AuthDialog'
import SecurityTab from '../components/auth/SecurityTab'
import { Avatar } from '../components/UserMenu'
import TierBadge, { TierIcon } from '../components/TierBadge'
import { Badge, Button, Dialog, EmptyState, ProgressBar, Skeleton, toast } from '../components/ui'

type Tab = 'profile' | 'security' | 'billing' | 'api'

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function Account() {
  const me = useAuth((s) => s.me)
  const loading = useAuth((s) => s.loading)
  const [params, setParams] = useSearchParams()
  const billing = !!me?.billing_enabled
  const tabs = useMemo(() => {
    const t: { id: Tab; label: string; Icon: typeof UserIcon }[] = [
      { id: 'profile', label: 'Profile', Icon: UserIcon },
      { id: 'security', label: 'Security', Icon: ShieldCheck },
    ]
    if (billing) t.push({ id: 'billing', label: 'Plan & billing', Icon: CreditCard })
    t.push({ id: 'api', label: 'API keys', Icon: KeyRound })
    return t
  }, [billing])
  const requested = params.get('tab') as Tab | null
  const checkoutSuccess = params.get('checkout') === 'success'
  const tab: Tab = requested && tabs.some((t) => t.id === requested) ? requested : checkoutSuccess && billing ? 'billing' : 'profile'
  const setTab = (t: Tab) => setParams(t === 'profile' ? {} : { tab: t }, { replace: true })

  // ?checkout=success → banner + sync (webhook may lag).
  const [celebrate, setCelebrate] = useState(false)
  const handled = useRef(false)
  useEffect(() => {
    if (!checkoutSuccess || handled.current) return
    handled.current = true
    setCelebrate(true)
    void syncBilling(true)
    setParams({ tab: 'billing' }, { replace: true })
  }, [checkoutSuccess, setParams])

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-10">
        <Skeleton className="h-24 rounded-3xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  if (!me?.user) return <SignedOut tab={tab} />

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
      <AccountHeader me={me} />

      <AnimatePresence>{celebrate && <SuccessBanner me={me} onClose={() => setCelebrate(false)} />}</AnimatePresence>

      <TabBar tabs={tabs} tab={tab} setTab={setTab} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={tween} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-6 space-y-6">
          {tab === 'profile' && <ProfileTab me={me} />}
          {tab === 'security' && <SecurityTab />}
          {tab === 'billing' && <BillingTab me={me} />}
          {tab === 'api' && <ApiKeysTab me={me} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function SignedOut({ tab }: { tab: Tab }) {
  const accounts = useAccountsEnabled()
  const [mode, setMode] = useState<AuthMode>('signin')
  if (!accounts) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <EmptyState icon={<UserIcon />} title="Accounts are not enabled on this server" description="This Folio server runs without sign-in. Every tool is available without an account." action={<Link to="/" className="font-medium text-brand-700 hover:underline dark:text-brand-300">Go to all tools</Link>} />
      </div>
    )
  }
  const security = tab === 'security'
  return (
    <div className="relative isolate">
      <div className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-[420px] w-[680px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-brand-500)_20%,transparent),transparent)] blur-2xl" aria-hidden="true" />
      <div className="mx-auto max-w-md px-4 py-14">
        <div className="mb-5 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3.5 py-1.5 text-xs font-medium text-muted shadow-[0_1px_2px_rgb(15_23_42/0.05)] backdrop-blur">
            {security ? <ShieldCheck size={14} className="shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" /> : <UserIcon size={14} className="shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />}
            {security ? 'Sign in to manage 2FA, your password and sessions' : 'Sign in to see your profile, plan and billing'}
          </span>
        </div>
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-lift sm:p-8">
          <AuthFlow mode={mode} onModeChange={setMode} onDone={(kind) => announceAuth(kind, null)} />
        </div>
      </div>
    </div>
  )
}

function AccountHeader({ me }: { me: Me }) {
  const user = me.user!
  return (
    <header className="card-wash-strong relative overflow-hidden rounded-3xl border border-border bg-surface p-6 shadow-card sm:p-8" style={tierStyle(me.billing_enabled ? me.plan : 'pro')}>
      <div className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_26%,transparent),transparent)]" aria-hidden="true" />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
        <Avatar name={user.name} email={user.email} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="text-eyebrow text-[var(--accent)]">Account</div>
          <h1 className="text-title truncate text-2xl sm:text-3xl">{user.name || user.email.split('@')[0]}</h1>
          <p className="mt-1 truncate text-sm text-muted">
            {user.email} · member since {fmtDate(user.created_at)}
          </p>
        </div>
        {me.billing_enabled && (
          <div className="flex items-center gap-2">
            <TierBadge tier={me.plan} size="md" />
            {me.plan_status === 'trialing' && <Badge tone="brand">Trial</Badge>}
          </div>
        )}
      </div>
    </header>
  )
}

function SuccessBanner({ me, onClose }: { me: Me; onClose: () => void }) {
  const reduce = useReducedMotion()
  const plan = getPlanTier(me.plan === 'free' ? 'pro' : me.plan)
  const syncing = me.plan === 'free'
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={reduce ? instant : spring}
      className="relative mt-6 overflow-hidden rounded-2xl bg-linear-to-r from-brand-600 via-cat-organize-600 to-cat-review-600 p-5 text-white shadow-glow sm:p-6"
      role="status"
    >
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_10%_20%,rgb(255_255_255/0.5)_0_2px,transparent_3px),radial-gradient(circle_at_70%_30%,rgb(253_230_138/0.8)_0_2px,transparent_3px),radial-gradient(circle_at_40%_80%,rgb(255_255_255/0.6)_0_1.5px,transparent_2.5px),radial-gradient(circle_at_90%_70%,rgb(125_211_252/0.8)_0_2px,transparent_3px)] [background-size:120px_90px]" aria-hidden="true" />
      <div className="relative flex items-start gap-4">
        <motion.span initial={reduce ? false : { rotate: -20, scale: 0.5 }} animate={{ rotate: 0, scale: 1 }} transition={{ ...spring, delay: 0.1 }} className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/20 ring-1 ring-white/30">
          <PartyPopper size={22} aria-hidden="true" />
        </motion.span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">{syncing ? 'Payment received. Activating your plan…' : `Welcome to ${plan.name}!`}</h2>
          <p className="mt-0.5 text-sm text-white/85">
            {syncing ? 'This usually takes a few seconds.' : me.plan_status === 'trialing' ? `Your 7-day free trial is running. You will not be charged until ${fmtDate(me.trial_ends_at)}.` : 'Everything in your plan is unlocked.'}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white" aria-label="Dismiss">
          <X size={16} />
        </button>
      </div>
    </motion.div>
  )
}

function TabBar({ tabs, tab, setTab }: { tabs: { id: Tab; label: string; Icon: typeof UserIcon }[]; tab: Tab; setTab: (t: Tab) => void }) {
  const reduce = useReducedMotion()
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const i = tabs.findIndex((t) => t.id === tab)
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
    setTab(next.id)
    document.getElementById(`tab-${next.id}`)?.focus()
  }
  return (
    <div role="tablist" aria-label="Account sections" onKeyDown={onKey} className="mt-8 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]">
      {tabs.map(({ id, label, Icon }) => {
        const active = id === tab
        return (
          <button key={id} id={`tab-${id}`} type="button" role="tab" aria-selected={active} aria-controls={`panel-${id}`} tabIndex={active ? 0 : -1} onClick={() => setTab(id)} className={clsx('relative inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors sm:px-4', active ? 'text-fg' : 'text-muted hover:text-fg')}>
            <Icon size={16} aria-hidden="true" />
            {label}
            {active && <motion.span layoutId="account-tab" transition={reduce ? instant : spring} className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-linear-to-r from-brand-500 to-cat-organize-500" aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}

function Section({ title, description, children, tone, icon }: { title: ReactNode; description?: ReactNode; children: ReactNode; tone?: 'danger'; icon?: ReactNode }) {
  return (
    <section className={clsx('rounded-2xl border bg-surface shadow-card', tone === 'danger' ? 'border-red-200 dark:border-red-500/30' : 'border-border')}>
      <div className={clsx('flex items-start gap-3 border-b px-5 py-4 sm:px-6', tone === 'danger' ? 'border-red-200 dark:border-red-500/30' : 'border-border')}>
        {icon}
        <div>
          <h2 className={clsx('font-semibold', tone === 'danger' && 'text-red-700 dark:text-red-300')}>{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function ProfileTab({ me }: { me: Me }) {
  const id = useId()
  const refresh = useAuth((s) => s.refresh)
  const setMe = useAuth((s) => s.setMe)
  const navigate = useNavigate()
  const user = me.user!
  const [name, setName] = useState(user.name ?? '')
  const [savingName, setSavingName] = useState(false)

  const [delOpen, setDelOpen] = useState(false)

  const saveName = async (e: FormEvent) => {
    e.preventDefault()
    setSavingName(true)
    try {
      const res = await sendJson<Me | { user: Me['user'] } | undefined>('PATCH', '/api/account', { name: name.trim() })
      if (res && 'plan' in res) setMe(res as Me)
      else await refresh()
      // Keep the Supabase profile in sync (best effort; the backend copy is what Folio shows).
      void getSupabase().then((sb) => sb?.auth.updateUser({ data: { full_name: name.trim() } }))
      toast.success('Name updated')
    } catch (err) {
      toast.error('Could not update your name', err instanceof Error ? err.message : undefined)
    } finally {
      setSavingName(false)
    }
  }

  return (
    <>
      <Section title="Profile" description="How you appear in Folio.">
        <form onSubmit={saveName} className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-name`} className="mb-1.5 block text-sm font-medium">
              Name
            </label>
            <input id={`${id}-name`} className="field h-10" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} />
          </div>
          <div>
            <label htmlFor={`${id}-email`} className="mb-1.5 block text-sm font-medium">
              Email
            </label>
            <div className="relative">
              <input id={`${id}-email`} className="field h-10 pr-9" value={user.email} readOnly disabled aria-describedby={`${id}-email-help`} />
              <Lock size={14} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-2" aria-hidden="true" />
            </div>
            <p id={`${id}-email-help`} className="mt-1.5 text-xs text-muted">
              Your email cannot be changed here.
            </p>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" loading={savingName} disabled={name.trim() === (user.name ?? '')}>
              Save changes
            </Button>
          </div>
        </form>
      </Section>

      <Section tone="danger" title="Danger zone" description="Deleting your account removes your profile, API keys and history. This cannot be undone." icon={<ShieldAlert size={20} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">{me.plan !== 'free' && me.billing_enabled ? 'Your subscription is cancelled automatically when you delete your account.' : 'You will be signed out everywhere.'}</p>
          <Button variant="danger" leftIcon={<Trash2 />} onClick={() => setDelOpen(true)}>
            Delete account
          </Button>
        </div>
      </Section>

      <DeleteAccountDialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        email={user.email}
        onDeleted={async () => {
          setDelOpen(false)
          toast.info('Your account was deleted')
          await useAuth.getState().signOut()
          navigate('/')
        }}
      />
    </>
  )
}

function DeleteAccountDialog({ open, onClose, email, onDeleted }: { open: boolean; onClose: () => void; email: string; onDeleted: () => void }) {
  const id = useId()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = typed.trim().toLowerCase() === 'delete'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      await sendJson('DELETE', '/api/account')
      onDeleted()
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'mfa_required'
          ? 'Enter your authenticator code to delete your account.'
          : err instanceof ApiError && err.code === 'secret_key_required'
            ? 'Account deletion isn’t set up on this server yet. Please contact support.'
            : err instanceof Error
              ? err.message
              : 'Could not delete the account.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} size="sm" title="Delete your account?" description={`This permanently deletes ${email}.`}>
      <form onSubmit={submit} className="space-y-4 p-5">
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          <TriangleExclamationPoint size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          Your profile, API keys and any active subscription are removed. Files already processed are deleted within 24 hours.
        </div>
        <div>
          <label htmlFor={`${id}-typed`} className="mb-1.5 block text-sm font-medium">
            Type <span className="font-mono font-semibold">delete</span> to confirm
          </label>
          <input id={`${id}-typed`} className="field h-10" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={busy} disabled={!ok}>
            Delete forever
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Plan & billing
// ---------------------------------------------------------------------------

function statusBadge(me: Me) {
  if (me.cancel_at) return <Badge tone="warning" dot>Cancels {fmtDate(me.cancel_at)}</Badge>
  switch (me.plan_status) {
    case 'trialing':
      return <Badge tone="brand" dot>Trial</Badge>
    case 'active':
      return <Badge tone="success" dot>Active</Badge>
    case 'past_due':
      return <Badge tone="danger" dot>Payment due</Badge>
    case 'paused':
      return <Badge tone="warning" dot>Paused</Badge>
    case 'canceled':
      return <Badge tone="neutral" dot>Cancelled</Badge>
    default:
      return me.plan === 'free' ? <Badge tone="neutral">Free forever</Badge> : null
  }
}

function BillingTab({ me }: { me: Me }) {
  usePlans((s) => s.plans)
  const navigate = useNavigate()
  const busy = useCheckout((s) => s.busy)
  const [syncing, setSyncing] = useState(false)
  const plan = getPlanTier(me.plan)
  const meta = TIER_META[me.plan]
  const paid = me.plan !== 'free'
  const trialLeft = me.plan_status === 'trialing' ? daysUntil(me.trial_ends_at) : null
  const trialDays = plan.trial_days || 7
  const price = me.plan_interval === 'yearly' ? `${formatPrice(plan.price_yearly)} / year` : `${formatPrice(plan.price_monthly)} / month`
  const usage = me.usage
  const limit = usage?.daily_limit ?? me.limits?.daily_tasks ?? null

  const sync = async () => {
    setSyncing(true)
    try {
      await syncBilling(false, 1)
      toast.success('Billing status refreshed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <>
      {me.plan_status === 'past_due' && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 sm:flex-row sm:items-center dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100">
          <TriangleExclamationPoint size={18} className="shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          <div className="flex-1">
            <div className="font-semibold">Your last payment did not go through</div>
            <div className="text-red-800 dark:text-red-200">Update your payment method to keep {plan.name}. We will retry automatically.</div>
          </div>
          <Button variant="danger" size="sm" onClick={() => void openBillingPortal()} rightIcon={<ExternalLink />}>
            Update payment
          </Button>
        </div>
      )}

      <section style={tierStyle(me.plan)} className={clsx('relative overflow-hidden rounded-2xl border bg-surface p-5 shadow-card sm:p-6', paid ? 'card-wash-strong border-[color-mix(in_oklab,var(--accent)_30%,var(--color-border))]' : 'border-border')} aria-labelledby="plan-h">
        <div className="pointer-events-none absolute -top-24 -right-20 size-72 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_22%,transparent),transparent)]" aria-hidden="true" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-start">
          <span className={clsx('grid size-14 shrink-0 place-items-center rounded-2xl bg-linear-to-br shadow-[0_10px_24px_-10px_var(--accent)]', paid ? [meta.fill, meta.fgOnFill] : 'bg-surface-2 text-muted ring-1 ring-inset ring-border')}>
            <TierIcon tier={me.plan} size={26} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-eyebrow text-muted">Current plan</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 id="plan-h" className="text-title text-2xl">
                {plan.name}
              </h2>
              {statusBadge(me)}
            </div>
            <p className="mt-1 text-sm text-muted">{paid ? `${price}${me.plan_interval ? ` · billed ${me.plan_interval}` : ''}` : plan.tagline}</p>

            {trialLeft != null && (
              <div className="mt-5 max-w-md">
                <div className="mb-2 flex items-baseline justify-between text-sm">
                  <span className="font-semibold">
                    Trial ends in <span className="tabular">{trialLeft}</span> day{trialLeft === 1 ? '' : 's'}
                  </span>
                  <span className="text-xs text-muted">{fmtDate(me.trial_ends_at)}</span>
                </div>
                <ProgressBar value={Math.min(1, Math.max(0, (trialDays - trialLeft) / trialDays))} size="md" label="Trial progress" />
                <p className="mt-2 text-xs text-muted">Your first payment of {price.replace(' / ', '/')} is taken when the trial ends. Cancel before then and you pay nothing.</p>
              </div>
            )}
            {me.cancel_at ? (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30">
                <CalendarClock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                Your plan is scheduled to end on {fmtDate(me.cancel_at)}. You keep everything until then. Changed your mind? Resume it from the billing portal.
              </p>
            ) : (
              me.plan_status === 'active' &&
              me.current_period_end && (
                <p className="mt-4 flex items-center gap-2 text-sm text-muted">
                  <CalendarClock size={16} aria-hidden="true" /> Renews on {fmtDate(me.current_period_end)}
                </p>
              )
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col">
            {paid ? (
              <>
                <Button variant="secondary" onClick={() => void openBillingPortal()} rightIcon={<ExternalLink />}>
                  Manage billing
                </Button>
                <Button variant="ghost" onClick={() => navigate('/pricing')}>
                  Change plan
                </Button>
              </>
            ) : (
              <>
                <Button variant="accent" className={clsx(TIER_META.pro.fill, 'text-white')} loading={busy?.plan === 'pro'} onClick={() => void startCheckout('pro', 'monthly')} rightIcon={<ArrowRight />}>
                  Try Pro free for 7 days
                </Button>
                <Button variant="ghost" onClick={() => navigate('/pricing')}>
                  Compare plans
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Usage today" description="Tasks reset every day at midnight UTC.">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-extrabold tracking-tight tabular">{usage?.today ?? 0}</span>
            <span className="text-sm text-muted">{limit == null ? 'tasks · unlimited' : `of ${limit} tasks`}</span>
          </div>
          {limit != null ? (
            <>
              <ProgressBar className="mt-4" value={Math.min(1, (usage?.today ?? 0) / Math.max(1, limit))} size="md" label="Daily tasks used" barClassName={(usage?.today ?? 0) >= limit ? 'bg-red-500' : undefined} />
              {(usage?.today ?? 0) >= limit && <p className="mt-2 text-sm text-red-700 dark:text-red-300">You have reached today’s limit. Upgrade for unlimited tasks.</p>}
            </>
          ) : (
            <div className="mt-4 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
              <Check size={16} aria-hidden="true" /> No daily limit on {plan.name}
            </div>
          )}
        </Section>
        <Section title="Plan limits" description={`What ${plan.name} includes.`}>
          <dl className="divide-y divide-border text-sm">
            {[
              ['Max file size', formatMb(me.limits?.max_file_mb ?? plan.limits.max_file_mb)],
              ['Files per task', (me.limits?.max_files_per_task ?? plan.limits.max_files_per_task) == null ? 'Unlimited' : String(me.limits?.max_files_per_task ?? plan.limits.max_files_per_task)],
              ['Batch processing', (me.limits?.batch ?? plan.limits.batch) ? 'Included' : '—'],
              ['API access', (me.limits?.api_access ?? plan.limits.api_access) ? 'Included' : '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between py-2 first:pt-0 last:pb-0">
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium tabular">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        Payments and invoices are handled by Paddle, our Merchant of Record.
        <button type="button" onClick={sync} disabled={syncing} className="inline-flex items-center gap-1 font-medium text-fg hover:underline disabled:opacity-50">
          <RefreshCw size={12} className={clsx(syncing && 'animate-spin')} aria-hidden="true" /> Refresh status
        </button>
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

interface ApiKey {
  id: string
  name: string
  prefix?: string | null
  created_at: string
  last_used_at?: string | null
}

function ApiKeysTab({ me }: { me: Me }) {
  const allowed = tierCovers(currentTier(me), 'max')
  if (!allowed) return <ApiKeysTeaser />
  return <ApiKeysManager />
}

function ApiKeysTeaser() {
  const busy = useCheckout((s) => s.busy)
  const fake = ['Production server', 'Zapier automation', 'Nightly batch job']
  return (
    <section style={tierStyle('max')} className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-card" aria-labelledby="api-teaser-h">
      <div className="pointer-events-none select-none p-6 opacity-60 blur-[3px]" aria-hidden="true">
        {fake.map((n, i) => (
          <div key={n} className="flex items-center gap-3 border-b border-border py-3 last:border-0">
            <KeyRound size={16} className="text-muted" />
            <span className="font-medium">{n}</span>
            <span className="font-mono text-xs text-muted">fk_live_{'•'.repeat(6 + i)}</span>
            <span className="ml-auto text-xs text-muted">Used 2h ago</span>
          </div>
        ))}
      </div>
      <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(180deg,transparent,var(--color-surface)_55%)] p-6">
        <div className="max-w-md text-center">
          <span className={clsx('mx-auto grid size-12 place-items-center rounded-2xl bg-linear-to-br shadow-[0_10px_24px_-10px_var(--accent)]', TIER_META.max.fill, TIER_META.max.fgOnFill)}>
            <KeyRound size={22} aria-hidden="true" />
          </span>
          <h2 id="api-teaser-h" className="text-title mt-4 text-xl">
            Automate Folio with the REST API
          </h2>
          <p className="mt-1.5 text-sm text-muted">Call every tool from your own scripts and services. API keys are part of Max, together with 1 GB files and priority processing.</p>
          <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <Button variant="accent" className={clsx(TIER_META.max.fill, TIER_META.max.fgOnFill, 'font-semibold')} loading={busy?.plan === 'max'} onClick={() => void startCheckout('max', 'monthly')} rightIcon={<ArrowRight />}>
              Try Max free for 7 days
            </Button>
            <Link to="/pricing" className="rounded-md px-3 py-2 text-sm font-medium text-muted hover:text-fg">
              Compare plans
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

function ApiKeysManager() {
  const id = useId()
  const [keys, setKeys] = useState<ApiKey[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null)
  const [revoke, setRevoke] = useState<ApiKey | null>(null)
  const [revoking, setRevoking] = useState(false)

  const [tick, setTick] = useState(0)
  const load = () => setTick((t) => t + 1)
  useEffect(() => {
    let alive = true
    getJson<ApiKey[] | { keys: ApiKey[] }>('/api/account/api-keys')
      .then((res) => {
        if (!alive) return
        setKeys(Array.isArray(res) ? res : (res.keys ?? []))
        setError(null)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'Could not load API keys')
        setKeys([])
      })
    return () => {
      alive = false
    }
  }, [tick])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    try {
      const res = await sendJson<ApiKey & { key: string }>('POST', '/api/account/api-keys', { name: name.trim() })
      setCreated({ key: res.key, name: res.name ?? name.trim() })
      setName('')
      void load()
    } catch (err) {
      toast.error('Could not create the key', err instanceof Error ? err.message : undefined)
    } finally {
      setCreating(false)
    }
  }

  const doRevoke = async () => {
    if (!revoke) return
    setRevoking(true)
    try {
      await sendJson('DELETE', `/api/account/api-keys/${encodeURIComponent(revoke.id)}`)
      setKeys((k) => k?.filter((x) => x.id !== revoke.id) ?? null)
      toast.success('API key revoked', revoke.name)
      setRevoke(null)
    } catch (err) {
      toast.error('Could not revoke the key', err instanceof Error ? err.message : undefined)
    } finally {
      setRevoking(false)
    }
  }

  return (
    <>
      <Section title="API keys" description="Use a key in the Authorization header: Bearer <key>. Treat keys like passwords.">
        <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor={`${id}-name`} className="sr-only">
            Key name
          </label>
          <input id={`${id}-name`} className="field h-10 flex-1" placeholder="Key name, e.g. Production server" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <Button type="submit" loading={creating} disabled={!name.trim()} leftIcon={<Plus />}>
            Create key
          </Button>
        </form>

        <div className="mt-5">
          {keys === null ? (
            <div className="space-y-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : error ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : keys.length === 0 ? (
            <EmptyState compact icon={<KeyRound />} title="No API keys yet" description="Create a key to call Folio from your own code." />
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {keys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <KeyRound size={16} className="shrink-0 text-muted" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{k.name}</div>
                    <div className="text-xs text-muted">
                      {k.prefix && <span className="font-mono">{k.prefix}… · </span>}
                      Created {fmtDate(k.created_at)} · {k.last_used_at ? `last used ${fmtDate(k.last_used_at)}` : 'never used'}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-500/10 dark:text-red-400" onClick={() => setRevoke(k)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <ShowOnceDialog created={created} onClose={() => setCreated(null)} />

      <Dialog open={!!revoke} onClose={() => !revoking && setRevoke(null)} size="sm" title="Revoke this key?" description={revoke ? `“${revoke.name}” stops working immediately.` : undefined}>
        <div className="flex justify-end gap-2 p-5">
          <Button variant="ghost" onClick={() => setRevoke(null)} disabled={revoking}>
            Cancel
          </Button>
          <Button variant="danger" loading={revoking} onClick={doRevoke}>
            Revoke key
          </Button>
        </div>
      </Dialog>
    </>
  )
}

function ShowOnceDialog({ created, onClose }: { created: { key: string; name: string } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.key)
      setCopied(true)
      toast.success('API key copied')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy. Select the key and copy it manually.')
    }
  }
  return (
    <Dialog open={!!created} onClose={onClose} size="md" title="Your new API key" description={created ? `“${created.name}”. Copy it now: it will not be shown again.` : undefined}>
      {created && (
        <div className="space-y-4 p-5" style={{ '--accent': 'var(--color-tier-max-500)' } as CSSProperties}>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 p-2 pl-3">
            <code className="min-w-0 flex-1 overflow-x-auto font-mono text-sm whitespace-nowrap select-all" data-autofocus tabIndex={0}>
              {created.key}
            </code>
            <Button size="sm" variant={copied ? 'secondary' : 'primary'} onClick={copy} leftIcon={copied ? <Check /> : <Copy />}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="flex items-start gap-2 text-sm text-muted">
            <TriangleExclamationPoint size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            Store it somewhere safe, like a password manager or your secret store. If you lose it, revoke it and create a new one.
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose}>I have saved it</Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
