/** Global "enter your authenticator code" dialog (opened through `requestMfa()` in lib/mfa.ts). */
import { useState, type CSSProperties } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { authErrorMessage } from '../../lib/authErrors'
import { useMfaChallenge } from '../../lib/mfa'
import { Button, Dialog, OtpInput } from '../ui'
import { ErrorNote, StepIcon } from './AuthBits'

export default function MfaChallengeDialog() {
  const open = useMfaChallenge((s) => s.open)
  const finish = useMfaChallenge((s) => s.finish)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onClose={() => !busy && finish(false)} bare size="sm" aria-label="Two-factor authentication">
      <Challenge busy={busy} setBusy={setBusy} />
    </Dialog>
  )
}

/** Mounted fresh every time the dialog opens, so no state carries over. */
function Challenge({ busy, setBusy }: { busy: boolean; setBusy: (b: boolean) => void }) {
  const reason = useMfaChallenge((s) => s.reason)
  const finish = useMfaChallenge((s) => s.finish)
  const challengeTotp = useAuth((s) => s.challengeTotp)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(0)

  const submit = async (value = code) => {
    if (value.length !== 6 || busy) return
    setBusy(true)
    setError(null)
    try {
      await challengeTotp(value)
      finish(true)
    } catch (e) {
      setError(authErrorMessage(e))
      setCode('')
      setShake((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative" style={{ '--accent': 'var(--color-brand-500)' } as CSSProperties}>
        <div className="section-wash pointer-events-none absolute inset-x-0 top-0 h-36" aria-hidden="true" />
        <form
          className="relative space-y-5 px-6 pt-7 pb-6"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="flex flex-col items-center text-center">
            <StepIcon>
              <ShieldCheck />
            </StepIcon>
            <h2 className="text-title mt-4 text-xl">Two-factor authentication</h2>
            <p className="mt-1 text-sm text-muted">{reason ?? 'This action needs an extra check.'} Open Google Authenticator or your authenticator app and enter the 6-digit code.</p>
          </div>
          <OtpInput value={code} onChange={setCode} onComplete={(v) => void submit(v)} disabled={busy} error={error ? shake : undefined} autoFocus aria-label="Authenticator code" />
          <ErrorNote error={error} />
          <div className="flex gap-2">
            <Button variant="ghost" block onClick={() => finish(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" block loading={busy} disabled={code.length !== 6}>
              Verify
            </Button>
          </div>
        </form>
      </div>
  )
}
