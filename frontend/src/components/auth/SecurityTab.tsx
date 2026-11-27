/** Account → Security: two-factor authentication, password and sessions (all on Supabase Auth). */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { KeyRound, LogOut, MailCheck, MonitorSmartphone, Plus, ShieldCheck, ShieldOff, ShieldPlus, Smartphone, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useAuth, type TotpFactor } from '../../lib/auth'
import { authError } from '../../lib/authErrors'
import { requestMfa } from '../../lib/mfa'
import { pop } from '../../lib/motion'
import { Badge, Button, Dialog, OtpInput, Skeleton, toast } from '../ui'
import { ErrorNote, PasswordField, ResendButton } from './AuthBits'
import TotpSetup from './TotpSetup'

/** Wall-clock ms (kept out of render bodies). */
const timestamp = () => Date.now()

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function Card({ icon, title, description, aside, children, tone }: { icon: ReactNode; title: ReactNode; description?: ReactNode; aside?: ReactNode; children: ReactNode; tone?: 'brand' | 'success' | 'neutral' }) {
  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
        <span
          className={clsx(
            'grid size-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset [&_svg]:size-5',
            tone === 'success' ? 'bg-emerald-500/12 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300' : tone === 'neutral' ? 'bg-surface-2 text-muted ring-border' : 'bg-brand-500/10 text-brand-700 ring-brand-500/25 dark:text-brand-300',
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {aside && <div className="shrink-0 pt-0.5">{aside}</div>}
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  )
}

export default function SecurityTab() {
  return (
    <>
      <TwoFactorCard />
      <div className="grid gap-6 lg:grid-cols-2">
        <ChangePasswordCard />
        <SessionsCard />
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Two-factor authentication
// ---------------------------------------------------------------------------

function TwoFactorCard() {
  const reduce = useReducedMotion()
  const listFactors = useAuth((s) => s.listFactors)
  const unenroll = useAuth((s) => s.unenroll)
  const aal = useAuth((s) => s.aal)
  const [factors, setFactors] = useState<TotpFactor[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [removing, setRemoving] = useState<TotpFactor | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    listFactors()
      .then((f) => {
        setFactors(f)
        setLoadError(null)
      })
      .catch((e: unknown) => {
        setFactors([])
        setLoadError(authError(e).message)
      })
  }, [listFactors])

  useEffect(load, [load])

  const verified = (factors ?? []).filter((f) => f.status === 'verified')
  const on = verified.length > 0

  const remove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      // Removing a factor needs a fresh second factor (aal2).
      if (useAuth.getState().aal !== 'aal2') {
        const ok = await requestMfa('Confirm it’s you before removing an authenticator.')
        if (!ok) return
      }
      await unenroll(removing.id)
      toast.success('Authenticator removed', verified.length > 1 ? undefined : 'Two-factor authentication is now off.')
      setRemoving(null)
      load()
    } catch (e) {
      toast.error('Could not remove the authenticator', authError(e).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      icon={on ? <ShieldCheck /> : <ShieldOff />}
      tone={on ? 'success' : 'brand'}
      title="Two-factor authentication"
      description="Ask for a 6-digit code from an authenticator app when you sign in and before billing or account changes."
      aside={factors === null ? <Skeleton className="h-5 w-12 rounded-full" /> : on ? <Badge tone="success" dot size="md">On</Badge> : <Badge tone="neutral" size="md">Off</Badge>}
    >
      {factors === null ? (
        <div className="space-y-2">
          <Skeleton className="h-14 rounded-xl" />
        </div>
      ) : on ? (
        <div className="space-y-4">
          <ul className="divide-y divide-border rounded-xl border border-border">
            <AnimatePresence initial={false}>
              {verified.map((f) => (
                <motion.li key={f.id} layout={!reduce} variants={reduce ? undefined : pop} initial="initial" animate="animate" exit="exit" className="flex items-center gap-3 px-4 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted ring-1 ring-inset ring-border">
                    <Smartphone size={16} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{f.friendly_name || 'Authenticator app'}</div>
                    <div className="text-xs text-muted">Added {fmtDate(f.created_at)} · TOTP</div>
                  </div>
                  <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-500/10 dark:text-red-400" leftIcon={<Trash2 />} onClick={() => setRemoving(f)}>
                    Remove
                  </Button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">{aal === 'aal2' ? 'This session is verified with your authenticator.' : 'This session hasn’t been verified with your authenticator yet.'}</p>
            <Button variant="secondary" size="sm" leftIcon={<Plus />} onClick={() => setSetupOpen(true)}>
              Add another app
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">
              Even if someone learns your password, they can’t get in without your phone. Works with <span className="font-medium text-fg">Google Authenticator</span>, <span className="font-medium text-fg">Microsoft Authenticator</span>, <span className="font-medium text-fg">Authy</span> and <span className="font-medium text-fg">1Password</span>.
            </p>
            {loadError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{loadError}</p>}
          </div>
          <Button variant="accent" className="shrink-0 from-brand-600 to-cat-organize-600" leftIcon={<ShieldPlus />} onClick={() => setSetupOpen(true)}>
            Set up authenticator app
          </Button>
        </div>
      )}

      <Dialog open={setupOpen} onClose={() => setSetupOpen(false)} size="md" title="Set up an authenticator app" description="Scan the QR code, then enter the code your app shows.">
        <div className="p-5">
          <TotpSetup
            onCancel={() => setSetupOpen(false)}
            onDone={() => {
              setSetupOpen(false)
              load()
            }}
          />
        </div>
      </Dialog>

      <Dialog open={!!removing} onClose={() => !busy && setRemoving(null)} size="sm" title="Remove this authenticator?" description={verified.length > 1 ? 'You can still sign in with your other authenticator apps.' : 'Two-factor authentication turns off: only your password will protect your account.'}>
        <div className="flex justify-end gap-2 p-5">
          <Button variant="ghost" onClick={() => setRemoving(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void remove()}>
            Remove
          </Button>
        </div>
      </Dialog>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

function ChangePasswordCard() {
  const updatePassword = useAuth((s) => s.updatePassword)
  const reauthenticate = useAuth((s) => s.reauthenticate)
  const email = useAuth((s) => s.user?.email ?? s.me?.user?.email ?? '')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  /** Supabase "secure password change": an emailed nonce is needed. */
  const [nonceSentAt, setNonceSentAt] = useState<number | null>(null)
  const [nonce, setNonce] = useState('')
  const [shake, setShake] = useState(0)
  const mismatch = confirm.length > 0 && confirm !== next

  const reset = () => {
    setNext('')
    setConfirm('')
    setNonce('')
    setNonceSentAt(null)
    setTouched(false)
    setError(null)
  }

  const attempt = async (withNonce?: string): Promise<void> => {
    try {
      await updatePassword(next, withNonce)
      toast.success('Password changed', 'Use your new password next time you sign in.')
      reset()
    } catch (e) {
      const info = authError(e)
      if (info.code === 'insufficient_aal') {
        if (await requestMfa('Confirm it’s you before changing your password.')) return attempt(withNonce)
        setError('Enter your authenticator code to change your password.')
      } else if ((info.code === 'reauthentication_needed' || info.code === 'reauth_nonce_missing') && !withNonce) {
        await reauthenticate()
        setNonceSentAt(timestamp())
      } else if (withNonce) {
        setError(info.message)
        setNonce('')
        setShake((n) => n + 1)
      } else setError(info.message)
    }
  }

  async function resendNonce() {
    try {
      await reauthenticate()
      setNonceSentAt(timestamp())
    } catch (e) {
      setError(authError(e).message)
    }
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    setTouched(true)
    setError(null)
    if (next.length < 8 || next !== confirm) return
    setBusy(true)
    try {
      await attempt(nonceSentAt ? nonce : undefined)
    } catch (err) {
      setError(authError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card icon={<KeyRound />} title="Password" description="Use a long, unique password you don’t use anywhere else.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <PasswordField label="New password" value={next} onChange={setNext} meter autoComplete="new-password" error={touched && next.length < 8 ? 'Use at least 8 characters.' : null} />
        <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={mismatch ? 'The passwords don’t match.' : null} />
        <AnimatePresence initial={false}>
          {nonceSentAt && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="space-y-3 rounded-xl border border-border bg-surface-2/60 p-4">
                <p className="flex items-start gap-2 text-sm text-muted">
                  <MailCheck size={16} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
                  <span>
                    For your security, enter the 6-digit code we just emailed to <span className="font-medium text-fg">{email}</span>.
                  </span>
                </p>
                <OtpInput value={nonce} onChange={setNonce} onComplete={() => void submit()} disabled={busy} error={error ? shake : undefined} autoFocus aria-label="Confirmation code" />
                <div className="text-center">
                  <ResendButton onResend={resendNonce} startedAt={nonceSentAt} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <ErrorNote error={error} />
        <Button type="submit" variant="secondary" loading={busy} disabled={!next || !confirm || (!!nonceSentAt && nonce.length !== 6)}>
          {nonceSentAt ? 'Confirm and update password' : 'Update password'}
        </Button>
      </form>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function deviceLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${browser} on ${os}` : browser
}

function SessionsCard() {
  const navigate = useNavigate()
  const signOut = useAuth((s) => s.signOut)
  const aal = useAuth((s) => s.aal)
  const lastSignIn = useAuth((s) => s.user?.last_sign_in_at ?? null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const signOutEverywhere = async () => {
    setBusy(true)
    try {
      await signOut('global')
      toast.info('Signed out everywhere', 'Every device, including this one, needs to sign in again.')
      setConfirmOpen(false)
      navigate('/login')
    } catch (e) {
      toast.error('Could not sign out everywhere', authError(e).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card icon={<MonitorSmartphone />} tone="neutral" title="Sessions" description="Where you’re signed in to Folio.">
      <div className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
        <span className="relative grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted ring-1 ring-inset ring-border">
          <MonitorSmartphone size={16} aria-hidden="true" />
          <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-surface" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {deviceLabel()} <Badge tone="brand">This device</Badge>
          </div>
          <div className="text-xs text-muted">
            {lastSignIn ? `Signed in ${fmtDate(lastSignIn)}` : 'Signed in'} · {aal === 'aal2' ? 'verified with authenticator' : 'password or email code'}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">Lost a device or signed in somewhere public? Sign out of every session at once.</p>
        <Button variant="secondary" className="shrink-0" leftIcon={<LogOut />} onClick={() => setConfirmOpen(true)}>
          Sign out of all devices
        </Button>
      </div>

      <Dialog open={confirmOpen} onClose={() => !busy && setConfirmOpen(false)} size="sm" title="Sign out of all devices?" description="Every browser and app signed in to your account is signed out, including this one.">
        <div className="flex justify-end gap-2 p-5">
          <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void signOutEverywhere()} leftIcon={<LogOut />}>
            Sign out everywhere
          </Button>
        </div>
      </Dialog>
    </Card>
  )
}
