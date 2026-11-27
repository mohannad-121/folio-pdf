/**
 * Multi-step auth flow on Supabase Auth, used by the global dialog and the /login, /signup and
 * /forgot pages.
 *
 *   Sign up:   name, email, password → 6-digit email code → success → optional authenticator setup
 *   Sign in:   email + password, or "email me a code" → (account has TOTP) authenticator code
 *   Forgot:    email → 6-digit code → new password
 */
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, ArrowRight, KeyRound, LogOut, Mail, MailCheck, PartyPopper, ShieldCheck, ShieldPlus, User as UserIcon } from 'lucide-react'
import clsx from 'clsx'
import { useAuth, type SignInResult } from '../lib/auth'
import { authError, EMAIL_RE } from '../lib/authErrors'
import { getPlanTier, tierStyle } from '../lib/plans'
import { announceAuth, resumeCheckout, useCheckout, type AuthDoneKind, type AuthMode, type CheckoutIntent } from '../lib/paddle'
import { instant, step as stepVariants } from '../lib/motion'
import { Button, Dialog, OtpInput, Segmented, toast } from './ui'
import { TierIcon } from './TierBadge'
import BrandMark from './BrandMark'
import { ErrorNote, PasswordField, ResendButton, StepIcon, TextField } from './auth/AuthBits'
import TotpSetup from './auth/TotpSetup'

export type { AuthDoneKind, AuthMode }

type Step = 'signin' | 'signin-code' | 'signup' | 'signup-code' | 'signup-success' | 'totp-setup' | 'mfa' | 'forgot' | 'forgot-code' | 'forgot-new'
type SignInMethod = 'password' | 'code'

const TOP_STEPS: Partial<Record<Step, AuthMode>> = { signin: 'signin', signup: 'signup', forgot: 'forgot' }

export interface AuthFlowProps {
  mode: AuthMode
  /** Called when the user switches between sign in / create account / forgot (pages sync the URL). */
  onModeChange?: (m: AuthMode) => void
  /** When opened from a pricing CTA: "continue to checkout" context. */
  intent?: CheckoutIntent | null
  onDone: (kind: AuthDoneKind) => void
  /** Larger headings on the full pages. */
  variant?: 'dialog' | 'page'
  className?: string
}

function Header({ icon, title, subtitle, variant }: { icon?: ReactNode; title: ReactNode; subtitle?: ReactNode; variant: 'dialog' | 'page' }) {
  return (
    <div className="mb-6 flex flex-col items-center text-center">
      {icon ?? <BrandMark size="lg" />}
      <h2 className={clsx('text-title mt-4', variant === 'page' ? 'text-2xl' : 'text-xl')}>{title}</h2>
      {subtitle && <p className="mt-1.5 max-w-sm text-sm text-muted">{subtitle}</p>}
    </div>
  )
}

export function AuthFlow({ mode, onModeChange, intent, onDone, variant = 'dialog', className }: AuthFlowProps) {
  const reduce = useReducedMotion()
  const a = useAuth.getState
  const [step, setStep] = useState<Step>(mode)
  const [method, setMethod] = useState<SignInMethod>('password')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null)
  const [shake, setShake] = useState(0)
  const [touched, setTouched] = useState(false)
  const [sentAt, setSentAt] = useState<number | null>(null)
  /** Where to go after the TOTP step, and what finished (for the toast). */
  const [afterMfa, setAfterMfa] = useState<'done' | 'forgot-new'>('done')
  const [doneKind, setDoneKind] = useState<AuthDoneKind>('signin')

  // Pages drive the mode through the URL (adjust state while rendering, not in an effect).
  const [prevMode, setPrevMode] = useState(mode)
  if (mode !== prevMode) {
    setPrevMode(mode)
    if (TOP_STEPS[step] || mode === 'mfa') setStep(mode)
  }

  const go = (s: Step) => {
    setError(null)
    setCode('')
    setTouched(false)
    setStep(s)
    const top = TOP_STEPS[s]
    if (top && top !== mode) onModeChange?.(top)
  }

  const fail = (e: unknown) => {
    const info = authError(e)
    setError(info)
    return info
  }

  const failCode = (e: unknown) => {
    fail(e)
    setCode('')
    setShake((n) => n + 1)
  }

  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  /** Make sure /me reflects the new session before handing control back (checkout reads it). */
  const finish = async (kind: AuthDoneKind) => {
    await a().refresh()
    if (!a().me?.user) await a().refresh()
    onDone(kind)
  }

  const afterSignIn = async (res: SignInResult, kind: AuthDoneKind, next: 'done' | 'forgot-new' = 'done') => {
    setDoneKind(kind)
    if (res === 'mfa') {
      setAfterMfa(next)
      go('mfa')
      return
    }
    if (next === 'forgot-new') go('forgot-new')
    else await finish(kind)
  }

  const emailOk = EMAIL_RE.test(email.trim())
  const emailErr = touched && !emailOk ? 'Enter a valid email address.' : null
  const cleanEmail = email.trim().toLowerCase()

  // ---- actions ----------------------------------------------------------------------------

  const submitSignIn = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!emailOk || (method === 'password' && !password)) return
    void run(async () => {
      try {
        if (method === 'code') {
          await a().sendSignInCode(cleanEmail)
          setSentAt(Date.now())
          go('signin-code')
          return
        }
        const res = await a().signInWithPassword(cleanEmail, password)
        await afterSignIn(res, 'signin')
      } catch (err) {
        const info = fail(err)
        if (info.code === 'email_not_confirmed') {
          // Unconfirmed sign-up: jump to the code step and send a fresh code.
          go('signup-code')
          try {
            await a().resendSignupCode(cleanEmail)
            setSentAt(Date.now())
          } catch (e2) {
            fail(e2)
          }
        }
      }
    })
  }

  const submitSignInCode = (value = code) => {
    if (value.length !== 6) return
    void run(async () => {
      try {
        await afterSignIn(await a().signInWithEmailCode(cleanEmail, value), 'signin')
      } catch (err) {
        failCode(err)
      }
    })
  }

  const submitSignUp = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!emailOk || password.length < 8) return
    void run(async () => {
      try {
        const res = await a().signUp(cleanEmail, password, name.trim() || undefined)
        setDoneKind('signup')
        if (res === 'done') go('signup-success')
        else {
          setSentAt(Date.now())
          go('signup-code')
        }
      } catch (err) {
        fail(err)
      }
    })
  }

  const submitSignupCode = (value = code) => {
    if (value.length !== 6) return
    void run(async () => {
      try {
        await a().verifySignupCode(cleanEmail, value)
        setDoneKind('signup')
        await a().refresh()
        go('signup-success')
      } catch (err) {
        failCode(err)
      }
    })
  }

  const submitMfa = (value = code) => {
    if (value.length !== 6) return
    void run(async () => {
      try {
        await a().challengeTotp(value)
        if (afterMfa === 'forgot-new') go('forgot-new')
        else await finish(doneKind)
      } catch (err) {
        failCode(err)
      }
    })
  }

  const submitForgot = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!emailOk) return
    void run(async () => {
      try {
        await a().sendPasswordReset(cleanEmail)
        setSentAt(Date.now())
        go('forgot-code')
      } catch (err) {
        fail(err)
      }
    })
  }

  const submitForgotCode = (value = code) => {
    if (value.length !== 6) return
    void run(async () => {
      try {
        await afterSignIn(await a().verifyRecoveryCode(cleanEmail, value), 'reset', 'forgot-new')
      } catch (err) {
        failCode(err)
      }
    })
  }

  const submitNewPassword = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (password.length < 8 || password !== confirm) return
    void run(async () => {
      try {
        await a().updatePassword(password)
        toast.success('Password updated', 'You are signed in with your new password.')
        await finish('reset')
      } catch (err) {
        fail(err)
      }
    })
  }

  const resend = (fn: () => Promise<void>) => async () => {
    setError(null)
    try {
      await fn()
      setSentAt(Date.now())
      toast.info('New code sent', `Check ${cleanEmail}.`)
    } catch (err) {
      fail(err)
    }
  }

  const switchAccount = async () => {
    await a().signOut()
    setPassword('')
    go('signin')
  }

  // ---- pieces -----------------------------------------------------------------------------

  const plan = intent ? getPlanTier(intent.plan) : null
  const intentCard =
    plan && intent && (step === 'signin' || step === 'signup') ? (
      <div style={tierStyle(plan.id)} className="card-wash flex items-center gap-3 rounded-xl border border-[color-mix(in_oklab,var(--accent)_30%,var(--color-border))] p-3 text-sm">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-linear-to-br from-[var(--accent)] to-[var(--accent-2)] text-white shadow-[0_6px_16px_-8px_var(--accent)]">
          <TierIcon tier={plan.id} size={18} />
        </span>
        <p className="min-w-0 text-muted">
          <span className="font-semibold text-fg">{step === 'signup' ? 'Create your account' : 'Sign in'} to continue to checkout</span> for {plan.name} ({intent.interval}). Your {plan.trial_days || 7}-day free trial starts right after.
        </p>
      </div>
    ) : null

  const tabs =
    step === 'signin' || step === 'signup' ? (
      <Segmented
        block
        aria-label="Account"
        value={step}
        onChange={(m) => go(m)}
        options={[
          { value: 'signin', label: 'Sign in' },
          { value: 'signup', label: 'Create account' },
        ]}
      />
    ) : null

  const cta = 'from-brand-600 to-cat-organize-600'

  const codeStep = (opts: { title: string; subtitle: ReactNode; onSubmit: (v?: string) => void; onResend?: () => Promise<void>; back: { label: string; to: Step }; submitLabel: string; icon?: ReactNode }) => (
    <>
      <Header variant={variant} icon={<StepIcon>{opts.icon ?? <MailCheck />}</StepIcon>} title={opts.title} subtitle={opts.subtitle} />
      <form
        noValidate
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          opts.onSubmit()
        }}
      >
        <OtpInput value={code} onChange={setCode} onComplete={(v) => opts.onSubmit(v)} disabled={busy} error={error ? shake : undefined} autoFocus />
        <ErrorNote error={error?.message ?? null}>
          {error?.code === 'otp_expired' && opts.onResend && (
            <>
              {' '}
              <button type="button" className="font-semibold underline underline-offset-2" onClick={() => void resend(opts.onResend!)()}>
                Send a new code
              </button>
            </>
          )}
        </ErrorNote>
        <Button type="submit" size="lg" block loading={busy} disabled={code.length !== 6} variant="accent" className={cta}>
          {opts.submitLabel}
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button type="button" onClick={() => go(opts.back.to)} className="inline-flex items-center gap-1 font-medium text-muted transition hover:text-fg">
            <ArrowLeft size={14} aria-hidden="true" /> {opts.back.label}
          </button>
          {opts.onResend && <ResendButton onResend={resend(opts.onResend)} startedAt={sentAt} />}
        </div>
      </form>
    </>
  )

  let body: ReactNode
  switch (step) {
    case 'signin':
      body = (
        <>
          <Header variant={variant} title={intent ? 'Sign in to continue' : 'Welcome back'} subtitle={intent ? undefined : 'Sign in to pick up where you left off.'} />
          <form onSubmit={submitSignIn} noValidate className="space-y-4">
            {tabs}
            {intentCard}
            <TextField label="Email" type="email" inputMode="email" autoComplete="email" data-autofocus icon={<Mail />} value={email} onChange={setEmail} error={emailErr} placeholder="you@company.com" />
            <Segmented
              block
              size="sm"
              aria-label="Sign-in method"
              value={method}
              onChange={(m) => {
                setMethod(m)
                setError(null)
              }}
              options={[
                { value: 'password', label: 'Password', icon: <KeyRound size={13} aria-hidden="true" /> },
                { value: 'code', label: 'Email me a code instead', icon: <MailCheck size={13} aria-hidden="true" /> },
              ]}
            />
            <AnimatePresence initial={false} mode="popLayout">
              {method === 'password' ? (
                <motion.div key="pw" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={reduce ? instant : { duration: 0.18 }}>
                  <PasswordField
                    value={password}
                    onChange={setPassword}
                    autoComplete="current-password"
                    error={touched && !password ? 'Enter your password.' : null}
                    aside={
                      <button type="button" onClick={() => go('forgot')} className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
                        Forgot password?
                      </button>
                    }
                  />
                </motion.div>
              ) : (
                <motion.p key="code" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-muted ring-1 ring-inset ring-border">
                  We’ll email you a 6-digit code. No password needed.
                </motion.p>
              )}
            </AnimatePresence>
            <ErrorNote error={error?.message ?? null}>
              {error?.code === 'otp_disabled' || error?.code === 'user_not_found' ? (
                <>
                  {' '}
                  <button type="button" onClick={() => go('signup')} className="font-semibold underline underline-offset-2">
                    Create an account
                  </button>
                </>
              ) : null}
            </ErrorNote>
            <Button type="submit" size="lg" block loading={busy} variant="accent" className={cta} rightIcon={<ArrowRight />}>
              {method === 'code' ? 'Email me a code' : intent ? 'Sign in and continue' : 'Sign in'}
            </Button>
          </form>
        </>
      )
      break

    case 'signin-code':
      body = codeStep({
        title: 'Check your email',
        subtitle: (
          <>
            Enter the 6-digit code we sent to <span className="font-medium text-fg">{cleanEmail}</span>.
          </>
        ),
        onSubmit: submitSignInCode,
        onResend: () => a().sendSignInCode(cleanEmail),
        back: { label: 'Use a password', to: 'signin' },
        submitLabel: 'Sign in',
      })
      break

    case 'signup':
      body = (
        <>
          <Header variant={variant} title={intent ? 'Create your account' : 'Create your Folio account'} subtitle={intent ? undefined : 'Free forever. Every paid plan starts with a 7-day trial.'} />
          <form onSubmit={submitSignUp} noValidate className="space-y-4">
            {tabs}
            {intentCard}
            <TextField label={<>Name <span className="font-normal text-muted">(optional)</span></>} autoComplete="name" icon={<UserIcon />} value={name} onChange={setName} placeholder="Ada Lovelace" maxLength={120} />
            <TextField label="Email" type="email" inputMode="email" autoComplete="email" data-autofocus icon={<Mail />} value={email} onChange={setEmail} error={emailErr} placeholder="you@company.com" />
            <PasswordField value={password} onChange={setPassword} meter autoComplete="new-password" error={touched && password.length < 8 ? 'Use at least 8 characters.' : null} hint="Mix upper and lower case, numbers and symbols for a stronger password." />
            <ErrorNote error={error?.message ?? null}>
              {error?.code === 'user_already_exists' || error?.code === 'email_exists' ? (
                <>
                  {' '}
                  <button type="button" onClick={() => go('signin')} className="font-semibold underline underline-offset-2">
                    Sign in instead
                  </button>
                </>
              ) : null}
            </ErrorNote>
            <Button type="submit" size="lg" block loading={busy} variant="accent" className={cta} rightIcon={<ArrowRight />}>
              {intent ? 'Create account and continue' : 'Create account'}
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted">
              <ShieldCheck size={13} aria-hidden="true" className="text-emerald-600 dark:text-emerald-400" />
              We’ll email you a 6-digit code to confirm it’s you.
            </p>
          </form>
        </>
      )
      break

    case 'signup-code':
      body = codeStep({
        title: 'Check your email',
        subtitle: (
          <>
            We sent a 6-digit code to <span className="font-medium text-fg">{cleanEmail}</span>. Enter it to confirm your account.{' '}
            <button type="button" onClick={() => go('signup')} className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">
              Wrong email?
            </button>
          </>
        ),
        onSubmit: submitSignupCode,
        onResend: () => a().resendSignupCode(cleanEmail),
        back: { label: 'Back', to: 'signup' },
        submitLabel: 'Confirm email',
      })
      break

    case 'signup-success':
      body = (
        <div className="flex flex-col items-center text-center">
          <motion.div initial={reduce ? false : { scale: 0.6, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 18 }}>
            <StepIcon tone="success">
              <PartyPopper />
            </StepIcon>
          </motion.div>
          <h2 className={clsx('text-title mt-4', variant === 'page' ? 'text-2xl' : 'text-xl')}>You’re in{name.trim() ? `, ${name.trim().split(' ')[0]}` : ''}!</h2>
          <p className="mt-1.5 text-sm text-muted">Your email is confirmed and your account is ready.</p>
          <div className="card-wash mt-6 w-full rounded-2xl border border-border bg-surface-2/60 p-4 text-left" style={{ '--accent': 'var(--color-emerald-500)' } as CSSProperties}>
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-700 ring-1 ring-inset ring-emerald-500/30 dark:text-emerald-300">
                <ShieldPlus size={20} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="font-semibold">Protect your account with an authenticator app</div>
                <p className="mt-0.5 text-sm text-muted">Add a 6-digit code from Google Authenticator, Authy or 1Password when you sign in. Takes about a minute.</p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button block variant="accent" className="from-emerald-500 to-emerald-700" leftIcon={<ShieldCheck />} onClick={() => go('totp-setup')}>
                Set up now
              </Button>
              <Button block variant="secondary" onClick={() => void finish('signup')}>
                {intent ? 'Later, continue to checkout' : 'Later'}
              </Button>
            </div>
          </div>
        </div>
      )
      break

    case 'totp-setup':
      body = (
        <>
          <Header variant={variant} icon={<StepIcon><ShieldPlus /></StepIcon>} title="Set up your authenticator app" subtitle="Scan the QR code, then enter the code your app shows." />
          <TotpSetup onCancel={() => void finish(doneKind)} onDone={() => void finish(doneKind)} doneLabel={intent ? 'Continue to checkout' : 'Done'} />
        </>
      )
      break

    case 'mfa':
      body = (
        <>
          <Header variant={variant} icon={<StepIcon><ShieldCheck /></StepIcon>} title="Two-factor authentication" subtitle="Open Google Authenticator or your authenticator app and enter the 6-digit code for Folio PDF." />
          <form
            noValidate
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              submitMfa()
            }}
          >
            <OtpInput value={code} onChange={setCode} onComplete={(v) => submitMfa(v)} disabled={busy} error={error ? shake : undefined} autoFocus aria-label="Authenticator code" />
            <ErrorNote error={error?.message ?? null} />
            <Button type="submit" size="lg" block loading={busy} disabled={code.length !== 6} variant="accent" className={cta}>
              Verify
            </Button>
            <div className="text-center text-sm">
              <button type="button" onClick={() => void switchAccount()} className="inline-flex items-center gap-1.5 font-medium text-muted transition hover:text-fg">
                <LogOut size={14} aria-hidden="true" /> Sign in with a different account
              </button>
            </div>
          </form>
        </>
      )
      break

    case 'forgot':
      body = (
        <>
          <Header variant={variant} icon={<StepIcon><KeyRound /></StepIcon>} title="Reset your password" subtitle="Enter your account’s email and we’ll send you a 6-digit code." />
          <form onSubmit={submitForgot} noValidate className="space-y-4">
            <TextField label="Email" type="email" inputMode="email" autoComplete="email" data-autofocus icon={<Mail />} value={email} onChange={setEmail} error={emailErr} placeholder="you@company.com" />
            <ErrorNote error={error?.message ?? null} />
            <Button type="submit" size="lg" block loading={busy} variant="accent" className={cta} rightIcon={<ArrowRight />}>
              Send reset code
            </Button>
            <div className="text-center text-sm">
              <button type="button" onClick={() => go('signin')} className="inline-flex items-center gap-1 font-medium text-muted transition hover:text-fg">
                <ArrowLeft size={14} aria-hidden="true" /> Back to sign in
              </button>
            </div>
          </form>
        </>
      )
      break

    case 'forgot-code':
      body = codeStep({
        title: 'Check your email',
        subtitle: (
          <>
            If an account exists for <span className="font-medium text-fg">{cleanEmail}</span>, we sent it a 6-digit reset code.
          </>
        ),
        onSubmit: submitForgotCode,
        onResend: () => a().sendPasswordReset(cleanEmail),
        back: { label: 'Different email', to: 'forgot' },
        submitLabel: 'Continue',
      })
      break

    case 'forgot-new':
      body = (
        <>
          <Header variant={variant} icon={<StepIcon><KeyRound /></StepIcon>} title="Choose a new password" subtitle="Use at least 8 characters. You’ll stay signed in on this device." />
          <form onSubmit={submitNewPassword} noValidate className="space-y-4">
            <PasswordField label="New password" value={password} onChange={setPassword} meter autoComplete="new-password" autoFocus error={touched && password.length < 8 ? 'Use at least 8 characters.' : null} />
            <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={confirm && confirm !== password ? 'The passwords don’t match.' : null} />
            <ErrorNote error={error?.message ?? null} />
            <Button type="submit" size="lg" block loading={busy} variant="accent" className={cta}>
              Save password and sign in
            </Button>
          </form>
        </>
      )
      break
  }

  return (
    <div className={clsx('relative', className)}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} variants={reduce ? undefined : stepVariants} initial="initial" animate="animate" exit="exit">
          {body}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** Global auth dialog (mounted in Layout, opened via useCheckout().openAuth). */
export default function AuthDialog() {
  const auth = useCheckout((s) => s.auth)
  const close = useCheckout((s) => s.closeAuth)
  const openAuth = useCheckout((s) => s.openAuth)
  const mfaPending = useAuth((s) => s.mfaPending)
  const signOut = useAuth((s) => s.signOut)

  // A session restored at aal1 for an account with TOTP: finish signing in first.
  useEffect(() => {
    if (mfaPending && !auth.open) openAuth('mfa', auth.intent)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the pending state changes
  }, [mfaPending])

  const onClose = () => {
    close()
    // Closing the code prompt leaves no half-signed-in session behind.
    if (useAuth.getState().mfaPending) void signOut()
  }

  return (
    <Dialog open={auth.open} onClose={onClose} bare size="sm" aria-label={auth.mode === 'signup' ? 'Create account' : auth.mode === 'forgot' ? 'Reset password' : 'Sign in'} className="max-h-[calc(100dvh-4rem)] overflow-y-auto">
      <div className="relative" style={{ '--accent': 'var(--color-brand-500)' } as CSSProperties}>
        <div className="section-wash pointer-events-none absolute inset-x-0 top-0 h-40" aria-hidden="true" />
        <div className="relative px-6 pt-7 pb-6">
          <AuthFlow
            mode={auth.mode}
            onModeChange={(m) => openAuth(m, auth.intent)}
            intent={auth.intent}
            onDone={(kind) => {
              close()
              announceAuth(kind, auth.intent)
              resumeCheckout(auth.intent)
            }}
          />
        </div>
      </div>
    </Dialog>
  )
}
