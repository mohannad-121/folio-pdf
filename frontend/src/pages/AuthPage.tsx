import { useEffect, useRef, type CSSProperties } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { Check, FileText, PenLine, ScanText, ShieldCheck } from 'lucide-react'
import clsx from 'clsx'
import { AuthFlow, type AuthMode } from '../components/AuthDialog'
import { EmptyState } from '../components/ui'
import { useAccountsEnabled, useAuth } from '../lib/auth'
import { isTier, type BillingInterval, type PaidTier } from '../lib/plans'
import { announceAuth, resumeCheckout, type CheckoutIntent } from '../lib/paddle'
import { staggerContainer, staggerItem } from '../lib/motion'

type PageMode = Exclude<AuthMode, 'mfa'>
const PATHS: Record<PageMode, string> = { signin: '/login', signup: '/signup', forgot: '/forgot' }

/** /login, /signup and /forgot: the auth flow centered next to an illustration. */
export default function AuthPage({ mode }: { mode: PageMode }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const reduce = useReducedMotion()
  const user = useAuth((s) => s.me?.user)
  const accounts = useAccountsEnabled()
  const configKnown = useAuth((s) => s.accountsEnabled !== null)
  const finishing = useRef(false)
  const next = params.get('next') || '/account'
  const planParam = params.get('plan')
  const intent: CheckoutIntent | null =
    isTier(planParam) && planParam !== 'free' ? { plan: planParam as PaidTier, interval: (params.get('interval') === 'yearly' ? 'yearly' : 'monthly') as BillingInterval } : null

  // Already signed in → go on.
  useEffect(() => {
    if (user && !intent && !finishing.current && !useAuth.getState().mfaPending) navigate(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on sign-in state changes
  }, [user])

  const setMode = (m: AuthMode) => {
    if (m !== 'mfa') navigate({ pathname: PATHS[m], search: params.toString() }, { replace: true })
  }

  if (configKnown && !accounts) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <EmptyState icon={<ShieldCheck />} title="Accounts are not enabled on this server" description="This Folio server runs without sign-in. Every tool is available without an account." action={<Link to="/" className="font-medium text-brand-700 hover:underline dark:text-brand-300">Go to all tools</Link>} />
      </div>
    )
  }

  return (
    <div className="relative isolate min-h-[calc(100dvh-3.5rem)] overflow-hidden">
      <div className="bg-grid absolute inset-0 -z-20 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" aria-hidden="true" />
      <div className="pointer-events-none absolute -top-40 left-1/4 -z-10 h-[480px] w-[720px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-brand-500)_24%,transparent),transparent)] blur-2xl motion-safe:animate-drift" aria-hidden="true" />

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-12 lg:grid-cols-2 lg:py-20">
        <Illustration mode={mode} />

        <motion.div initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-md">
          <div className="rounded-3xl border border-border bg-surface p-6 shadow-lift sm:p-8">
            <h1 className="sr-only">{mode === 'signin' ? 'Sign in to Folio' : mode === 'signup' ? 'Create your Folio account' : 'Reset your password'}</h1>
            <AuthFlow
              mode={mode}
              variant="page"
              onModeChange={setMode}
              intent={intent}
              onDone={(kind) => {
                finishing.current = true
                announceAuth(kind, intent)
                if (intent) {
                  navigate('/pricing', { replace: true })
                  resumeCheckout(intent)
                } else navigate(next, { replace: true })
              }}
            />
          </div>
          <p className="mt-5 text-center text-xs text-muted">
            By continuing you agree to the terms of service. <Link to="/pricing" className="font-medium text-fg underline-offset-2 hover:underline">See plans and pricing</Link>
          </p>
        </motion.div>
      </div>
    </div>
  )
}

function Illustration({ mode }: { mode: PageMode }) {
  const reduce = useReducedMotion()
  const points =
    mode === 'signup'
      ? ['50+ PDF tools in one place', '7-day free trial on every paid plan', 'Files auto-delete within 24 hours']
      : mode === 'forgot'
        ? ['Reset with a 6-digit code from your inbox', 'Your plan and files stay exactly as they are', 'Two-factor authentication stays on']
        : ['Pick up right where you left off', 'Your plan, usage and API keys', 'Two-factor authentication with any authenticator app']
  const cards = [
    { Icon: FileText, label: 'Quarterly report.pdf', accent: 'var(--color-brand-500)', cls: 'top-4 left-0 -rotate-6' },
    { Icon: ScanText, label: 'OCR complete', accent: 'var(--color-cat-optimize-500)', cls: 'top-24 right-0 rotate-3' },
    { Icon: PenLine, label: 'Signed by 2 people', accent: 'var(--color-cat-forms-sign-500)', cls: 'bottom-2 left-10 rotate-2' },
  ]
  return (
    <motion.div variants={reduce ? undefined : staggerContainer(0.08)} initial="initial" animate="animate" className="hidden lg:block">
      <motion.h2 variants={reduce ? undefined : staggerItem} className="text-display text-5xl">
        Every PDF tool.
        <br />
        <span className="text-gradient">One account.</span>
      </motion.h2>
      <motion.ul variants={reduce ? undefined : staggerItem} className="mt-6 space-y-3">
        {points.map((p) => (
          <li key={p} className="flex items-center gap-3 text-muted">
            <span className="grid size-6 place-items-center rounded-full bg-brand-500/15 text-brand-600 dark:text-brand-300">
              <Check size={13} strokeWidth={3} aria-hidden="true" />
            </span>
            {p}
          </li>
        ))}
      </motion.ul>
      <motion.div variants={reduce ? undefined : staggerItem} className="relative mt-10 h-64 max-w-md" aria-hidden="true">
        <div className="absolute inset-6 rounded-3xl bg-linear-to-br from-brand-500/25 via-cat-organize-500/20 to-cat-review-500/20 blur-2xl" />
        {cards.map(({ Icon, label, accent, cls }, i) => (
          <div key={label} style={{ '--accent': accent, animationDelay: `${i * 0.8}s` } as CSSProperties} className={clsx('card-wash absolute flex w-64 items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-lift motion-safe:animate-float', cls)}>
            <span className="grid size-10 place-items-center rounded-xl bg-[var(--accent)] text-white shadow-[0_8px_18px_-8px_var(--accent)]">
              <Icon size={18} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{label}</div>
              <div className="mt-1.5 h-1.5 w-28 rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${60 + i * 15}%` }} />
              </div>
            </div>
          </div>
        ))}
        <div className="absolute right-6 bottom-10 inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white shadow-lift">
          <ShieldCheck size={13} /> Secure
        </div>
      </motion.div>
    </motion.div>
  )
}
