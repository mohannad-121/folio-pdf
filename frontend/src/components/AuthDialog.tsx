import { useId, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, CircleExclamationPoint, Eye, EyeOff, Lock, Mail, ShieldCheck, User as UserIcon } from 'lucide-react'
import clsx from 'clsx'
import { ApiError } from '../lib/api'
import { passwordStrength, useAuth, type Me } from '../lib/auth'

import { getPlanTier, tierStyle } from '../lib/plans'
import { resumeCheckout, useCheckout, type CheckoutIntent } from '../lib/paddle'
import { instant, spring } from '../lib/motion'
import { Button, Dialog, Segmented, toast } from './ui'
import { TierIcon } from './TierBadge'
import BrandMark from './BrandMark'

export type AuthMode = 'signin' | 'signup'

const STRENGTH_COLORS = ['bg-red-500', 'bg-red-500', 'bg-amber-500', 'bg-lime-500', 'bg-emerald-500']
const STRENGTH_TEXT = ['text-red-600 dark:text-red-400', 'text-red-600 dark:text-red-400', 'text-amber-700 dark:text-amber-300', 'text-lime-700 dark:text-lime-300', 'text-emerald-700 dark:text-emerald-300']

function authErrorMessage(e: unknown, mode: AuthMode): string {
  if (e instanceof ApiError) {
    if (e.code === 'not_implemented') return 'Accounts are not available on this server yet.'
    if (mode === 'signin' && e.status === 401) return 'That email and password do not match. Check them and try again.'
    if (e.status === 409) return 'An account with this email already exists.'
    if (e.status === 429) return 'Too many attempts. Wait a minute, then try again.'
    if (e.status === 422) return e.message || 'Check the highlighted fields.'
    if (e.status === 0) return 'Could not reach the server. Check your connection.'
    return e.message
  }
  return e instanceof Error ? e.message : 'Something went wrong.'
}

export interface AuthFormProps {
  mode: AuthMode
  onModeChange: (m: AuthMode) => void
  /** When opened from a pricing CTA: "continue to checkout" context. */
  intent?: CheckoutIntent | null
  onSuccess: (me: Me, mode: AuthMode) => void
  className?: string
}

/** Email + password form with Sign in / Create account tabs. */
export function AuthForm({ mode, onModeChange, intent, onSuccess, className }: AuthFormProps) {
  const id = useId()
  const reduce = useReducedMotion()
  const login = useAuth((s) => s.login)
  const signup = useAuth((s) => s.signup)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const strength = useMemo(() => passwordStrength(password), [password])

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const pwOk = mode === 'signin' ? password.length > 0 : password.length >= 8
  const emailErr = touched && !emailOk ? 'Enter a valid email address.' : null
  const pwErr = touched && !pwOk ? (mode === 'signin' ? 'Enter your password.' : 'Use at least 8 characters.') : null
  const plan = intent ? getPlanTier(intent.plan) : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    setError(null)
    if (!emailOk || !pwOk) return
    setBusy(true)
    try {
      const me = mode === 'signin' ? await login(email.trim(), password) : await signup(email.trim(), password, name.trim() || undefined)
      onSuccess(me, mode)
    } catch (err) {
      setError(authErrorMessage(err, mode))
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (m: AuthMode) => {
    onModeChange(m)
    setError(null)
    setTouched(false)
  }

  return (
    <form onSubmit={submit} noValidate className={clsx('space-y-4', className)}>
      <Segmented
        block
        aria-label="Account"
        value={mode}
        onChange={switchMode}
        options={[
          { value: 'signin', label: 'Sign in' },
          { value: 'signup', label: 'Create account' },
        ]}
      />

      {plan && intent && (
        <div style={tierStyle(plan.id)} className="card-wash flex items-center gap-3 rounded-xl border border-[color-mix(in_oklab,var(--accent)_30%,var(--color-border))] p-3 text-sm">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-linear-to-br from-[var(--accent)] to-[var(--accent-2)] text-white shadow-[0_6px_16px_-8px_var(--accent)]">
            <TierIcon tier={plan.id} size={18} />
          </span>
          <p className="min-w-0 text-muted">
            <span className="font-semibold text-fg">{mode === 'signup' ? 'Create your account' : 'Sign in'} to continue to checkout</span> for {plan.name} ({intent.interval}). Your {plan.trial_days || 7}-day free trial starts right after.
          </p>
        </div>
      )}

      <AnimatePresence initial={false}>
        {mode === 'signup' && (
          <motion.div key="name" initial={reduce ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={reduce ? undefined : { opacity: 0, height: 0 }} transition={reduce ? instant : spring} className="overflow-hidden">
            <label htmlFor={`${id}-name`} className="mb-1.5 block text-sm font-medium">
              Name <span className="font-normal text-muted">(optional)</span>
            </label>
            <div className="relative">
              <UserIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-2" aria-hidden="true" />
              <input id={`${id}-name`} className="field h-11 pl-9" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div>
        <label htmlFor={`${id}-email`} className="mb-1.5 block text-sm font-medium">
          Email
        </label>
        <div className="relative">
          <Mail size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-2" aria-hidden="true" />
          <input
            id={`${id}-email`}
            type="email"
            inputMode="email"
            className="field h-11 pl-9"
            autoComplete="email"
            data-autofocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!emailErr}
            aria-describedby={emailErr ? `${id}-email-err` : undefined}
            placeholder="you@company.com"
          />
        </div>
        {emailErr && (
          <p id={`${id}-email-err`} className="mt-1.5 text-xs text-red-600 dark:text-red-400">
            {emailErr}
          </p>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label htmlFor={`${id}-pw`} className="block text-sm font-medium">
            Password
          </label>
          {mode === 'signup' && strength.label && <span className={clsx('text-xs font-medium', STRENGTH_TEXT[strength.score])}>{strength.label}</span>}
        </div>
        <div className="relative">
          <Lock size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-2" aria-hidden="true" />
          <input
            id={`${id}-pw`}
            type={show ? 'text' : 'password'}
            className="field h-11 pr-11 pl-9"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!pwErr}
            aria-describedby={`${id}-pw-help`}
            placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
          />
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-2 text-muted-2 transition hover:bg-surface-2 hover:text-fg" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {mode === 'signup' && (
          <div className="mt-2 grid grid-cols-4 gap-1" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className="h-1 overflow-hidden rounded-full bg-surface-3">
                <motion.span className={clsx('block h-full rounded-full', STRENGTH_COLORS[strength.score])} initial={false} animate={{ width: password && strength.score >= i ? '100%' : password && i === 1 ? '35%' : '0%' }} transition={reduce ? instant : spring} />
              </span>
            ))}
          </div>
        )}
        <p id={`${id}-pw-help`} className={clsx('mt-1.5 text-xs', pwErr ? 'text-red-600 dark:text-red-400' : 'text-muted')}>
          {pwErr ?? (mode === 'signup' ? 'Mix upper and lower case, numbers and symbols for a stronger password.' : ' ')}
        </p>
      </div>

      <AnimatePresence initial={false}>
        {error && (
          <motion.div key="err" role="alert" initial={reduce ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            <CircleExclamationPoint size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              {error}
              {error.startsWith('An account with this email') && (
                <>
                  {' '}
                  <button type="button" onClick={() => switchMode('signin')} className="font-semibold underline underline-offset-2">
                    Sign in instead
                  </button>
                </>
              )}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <Button type="submit" size="lg" block loading={busy} variant="accent" className="from-brand-600 to-cat-organize-600" rightIcon={<ArrowRight />}>
        {mode === 'signin' ? (intent ? 'Sign in and continue' : 'Sign in') : intent ? 'Create account and continue' : 'Create account'}
      </Button>

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted">
        <ShieldCheck size={13} aria-hidden="true" className="text-emerald-600 dark:text-emerald-400" />
        {mode === 'signup' ? 'Free forever plan. No credit card needed to sign up.' : 'Your session is kept in a secure, httpOnly cookie.'}
      </p>
    </form>
  )
}

/** Global auth dialog (mounted in Layout, opened via useCheckout().openAuth). */
export default function AuthDialog() {
  const auth = useCheckout((s) => s.auth)
  const close = useCheckout((s) => s.closeAuth)
  const openAuth = useCheckout((s) => s.openAuth)
  return (
    <Dialog open={auth.open} onClose={close} bare size="sm" aria-label={auth.mode === 'signin' ? 'Sign in' : 'Create account'} className="max-h-[calc(100dvh-4rem)] overflow-y-auto">
      <div className="relative" style={{ '--accent': 'var(--color-brand-500)' } as CSSProperties}>
        <div className="section-wash pointer-events-none absolute inset-x-0 top-0 h-40" aria-hidden="true" />
        <div className="relative px-6 pt-7 pb-6">
          <div className="mb-5 flex flex-col items-center text-center">
            <BrandMark size="lg" />
            <h2 className="text-title mt-4 text-xl">{auth.mode === 'signin' ? 'Welcome back' : 'Create your Folio account'}</h2>
            <p className="mt-1 text-sm text-muted">{auth.mode === 'signin' ? 'Sign in to pick up where you left off.' : 'Every paid plan starts with a 7-day free trial.'}</p>
          </div>
          <AuthForm
            mode={auth.mode}
            onModeChange={(m) => openAuth(m, auth.intent)}
            intent={auth.intent}
            onSuccess={(me, mode) => {
              close()
              const who = me.user?.name?.split(' ')[0] || me.user?.email
              toast.success(mode === 'signin' ? `Welcome back${who ? `, ${who}` : ''}` : 'Your account is ready', auth.intent ? 'Opening secure checkout…' : undefined)
              resumeCheckout(auth.intent)
            }}
          />
        </div>
      </div>
    </Dialog>
  )
}
