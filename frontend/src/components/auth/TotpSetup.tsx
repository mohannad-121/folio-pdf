/** Inline TOTP enrolment: QR code + manual secret → 6-digit verify → success. */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, ArrowRight, Check, Copy, QrCode, ShieldCheck, Smartphone } from 'lucide-react'
import clsx from 'clsx'
import { useAuth, type TotpEnrollment } from '../../lib/auth'
import { authErrorMessage } from '../../lib/authErrors'
import { step as stepVariants, instant } from '../../lib/motion'
import { Button, OtpInput, Skeleton, toast } from '../ui'
import { ErrorNote, StepIcon } from './AuthBits'

const APPS = ['Google Authenticator', 'Microsoft Authenticator', 'Authy', '1Password']

type Phase = 'scan' | 'verify' | 'done'

export interface TotpSetupProps {
  onDone: () => void
  onCancel?: () => void
  /** Label of the final button. */
  doneLabel?: string
  className?: string
}

export default function TotpSetup({ onDone, onCancel, doneLabel = 'Done', className }: TotpSetupProps) {
  const reduce = useReducedMotion()
  const enrollTotp = useAuth((s) => s.enrollTotp)
  const verifyEnrollment = useAuth((s) => s.verifyEnrollment)
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('scan')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(0)
  const [copied, setCopied] = useState(false)
  const started = useRef(false)

  const start = () => {
    setLoadError(null)
    setEnrollment(null)
    enrollTotp()
      .then(setEnrollment)
      .catch((e: unknown) => setLoadError(authErrorMessage(e)))
  }

  useEffect(() => {
    // StrictMode mounts twice; enrol once.
    if (started.current) return
    started.current = true
    start()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once
  }, [])

  const copy = async () => {
    if (!enrollment) return
    try {
      await navigator.clipboard.writeText(enrollment.secret)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy. Select the key and copy it manually.')
    }
  }

  const verify = async (value = code) => {
    if (!enrollment || value.length !== 6 || busy) return
    setBusy(true)
    setError(null)
    try {
      await verifyEnrollment(enrollment.id, value)
      setPhase('done')
    } catch (e) {
      setError(authErrorMessage(e))
      setCode('')
      setShake((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  const secretGroups = enrollment?.secret.match(/.{1,4}/g)?.join(' ') ?? ''

  return (
    <div className={clsx('relative', className)}>
      <AnimatePresence mode="wait" initial={false}>
        {phase === 'scan' && (
          <motion.div key="scan" variants={reduce ? undefined : stepVariants} initial="initial" animate="animate" exit="exit" transition={reduce ? instant : undefined} className="space-y-5">
            <ol className="flex items-center gap-2 text-xs font-medium text-muted" aria-label="Steps">
              <li className="inline-flex items-center gap-1.5 text-fg">
                <span className="grid size-5 place-items-center rounded-full bg-brand-600 text-[11px] text-white">1</span> Scan
              </li>
              <span className="h-px w-6 bg-border" aria-hidden="true" />
              <li className="inline-flex items-center gap-1.5">
                <span className="grid size-5 place-items-center rounded-full bg-surface-3 text-[11px]">2</span> Verify
              </li>
            </ol>

            <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
              <div className="mx-auto grid size-44 place-items-center rounded-2xl border border-border bg-white p-2.5 shadow-card sm:mx-0">
                {enrollment ? (
                  <img src={enrollment.qr} alt="QR code to add Folio PDF to your authenticator app" className="size-full [image-rendering:pixelated]" />
                ) : loadError ? (
                  <QrCode size={40} className="text-neutral-300" aria-hidden="true" />
                ) : (
                  <Skeleton className="size-full rounded-lg" />
                )}
              </div>
              <div className="min-w-0 space-y-3">
                <p className="text-sm text-muted">
                  Open your authenticator app, tap <span className="font-medium text-fg">+</span> or <span className="font-medium text-fg">Add account</span>, and scan this QR code.
                </p>
                <div className="flex flex-wrap gap-1.5" aria-label="Works with">
                  {APPS.map((a) => (
                    <span key={a} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted ring-1 ring-inset ring-border">
                      <Smartphone size={12} aria-hidden="true" /> {a}
                    </span>
                  ))}
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted">Can’t scan? Enter this setup key instead</div>
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 p-1.5 pl-3">
                    {enrollment ? (
                      <code className="min-w-0 flex-1 font-mono text-[13px] leading-5 tracking-wide break-words select-all">{secretGroups}</code>
                    ) : (
                      <Skeleton className="h-4 flex-1" />
                    )}
                    <Button size="xs" variant={copied ? 'secondary' : 'ghost'} onClick={copy} disabled={!enrollment} leftIcon={copied ? <Check /> : <Copy />} aria-label="Copy setup key">
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-2">Time-based, 6 digits, 30 seconds. Account: Folio PDF.</p>
                </div>
              </div>
            </div>

            <ErrorNote error={loadError}>
              {' '}
              <button type="button" className="font-semibold underline underline-offset-2" onClick={start}>
                Try again
              </button>
            </ErrorNote>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {onCancel && (
                <Button variant="ghost" onClick={onCancel}>
                  Cancel
                </Button>
              )}
              <Button variant="accent" className="from-brand-600 to-cat-organize-600" disabled={!enrollment} onClick={() => setPhase('verify')} rightIcon={<ArrowRight />}>
                I’ve added it
              </Button>
            </div>
          </motion.div>
        )}

        {phase === 'verify' && (
          <motion.div key="verify" variants={reduce ? undefined : stepVariants} initial="initial" animate="animate" exit="exit" className="space-y-5">
            <div className="text-center">
              <p className="text-sm text-muted">Enter the 6-digit code your app shows for <span className="font-medium text-fg">Folio PDF</span> to finish.</p>
            </div>
            <OtpInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy} error={error ? shake : undefined} autoFocus aria-label="Authenticator code" />
            <ErrorNote error={error} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="ghost" leftIcon={<ArrowLeft />} onClick={() => setPhase('scan')} disabled={busy}>
                Back to QR code
              </Button>
              <Button variant="accent" className="from-brand-600 to-cat-organize-600" loading={busy} disabled={code.length !== 6} onClick={() => void verify()} leftIcon={<ShieldCheck />}>
                Verify and turn on
              </Button>
            </div>
          </motion.div>
        )}

        {phase === 'done' && (
          <motion.div key="done" variants={reduce ? undefined : stepVariants} initial="initial" animate="animate" exit="exit" className="flex flex-col items-center text-center">
            <motion.div initial={reduce ? false : { scale: 0.6, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 18 }}>
              <StepIcon tone="success">
                <ShieldCheck />
              </StepIcon>
            </motion.div>
            <h3 className="text-title mt-4 text-lg">Two-factor authentication is on</h3>
            <p className="mt-1 max-w-sm text-sm text-muted">From now on Folio asks for a code from your authenticator app when you sign in and before billing or account changes.</p>
            <Button className="mt-5" onClick={onDone} block>
              {doneLabel}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
