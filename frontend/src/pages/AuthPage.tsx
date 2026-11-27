import { useEffect, type CSSProperties } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { Check, FileText, PenLine, ScanText, ShieldCheck } from 'lucide-react'
import clsx from 'clsx'
import { AuthForm, type AuthMode } from '../components/AuthDialog'
import BrandMark from '../components/BrandMark'
import { toast } from '../components/ui'
import { useAuth } from '../lib/auth'
import { isTier, type BillingInterval, type PaidTier } from '../lib/plans'
import { resumeCheckout, type CheckoutIntent } from '../lib/paddle'
import { staggerContainer, staggerItem } from '../lib/motion'

/** /login and /signup: the auth form centered next to an illustration. */
export default function AuthPage({ mode }: { mode: AuthMode }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const reduce = useReducedMotion()
  const user = useAuth((s) => s.me?.user)
  const next = params.get('next') || '/account'
  const planParam = params.get('plan')
  const intent: CheckoutIntent | null =
    isTier(planParam) && planParam !== 'free' ? { plan: planParam as PaidTier, interval: (params.get('interval') === 'yearly' ? 'yearly' : 'monthly') as BillingInterval } : null

  // Already signed in → go on.
  useEffect(() => {
    if (user && !intent) navigate(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on sign-in state changes
  }, [user])

  const setMode = (m: AuthMode) => navigate({ pathname: m === 'signin' ? '/login' : '/signup', search: params.toString() }, { replace: true })

  return (
    <div className="relative isolate min-h-[calc(100dvh-3.5rem)] overflow-hidden">
      <div className="bg-grid absolute inset-0 -z-20 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" aria-hidden="true" />
      <div className="pointer-events-none absolute -top-40 left-1/4 -z-10 h-[480px] w-[720px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-brand-500)_24%,transparent),transparent)] blur-2xl motion-safe:animate-drift" aria-hidden="true" />

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-12 lg:grid-cols-2 lg:py-20">
        <Illustration mode={mode} />

        <motion.div initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-md">
          <div className="rounded-3xl border border-border bg-surface p-6 shadow-lift sm:p-8">
            <div className="mb-6 flex flex-col items-center text-center">
              <BrandMark size="lg" />
              <h1 className="text-title mt-4 text-2xl">{mode === 'signin' ? 'Sign in to Folio' : 'Create your account'}</h1>
              <p className="mt-1 text-sm text-muted">{mode === 'signin' ? 'Welcome back. Your plan and history are waiting.' : 'Free forever. Every paid plan starts with a 7-day trial.'}</p>
            </div>
            <AuthForm
              mode={mode}
              onModeChange={setMode}
              intent={intent}
              onSuccess={(me, m) => {
                toast.success(m === 'signin' ? `Welcome back${me.user?.name ? `, ${me.user.name.split(' ')[0]}` : ''}` : 'Your account is ready')
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

function Illustration({ mode }: { mode: AuthMode }) {
  const reduce = useReducedMotion()
  const points = mode === 'signup' ? ['50+ PDF tools in one place', '7-day free trial on every paid plan', 'Files auto-delete within 24 hours'] : ['Pick up right where you left off', 'Your plan, usage and API keys', 'Billing and invoices in one place']
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
