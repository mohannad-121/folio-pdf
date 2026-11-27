/**
 * Global "enter your authenticator code" prompt. `requestMfa()` opens <MfaChallengeDialog />
 * (mounted in Layout) and resolves true once the session is aal2, false if the user cancels.
 * Used by api.ts when the server answers 403 `mfa_required`, and by the Security tab.
 */
import { create } from 'zustand'

interface MfaState {
  open: boolean
  /** Short explanation shown under the title. */
  reason: string | null
  resolve: ((ok: boolean) => void) | null
  finish: (ok: boolean) => void
}

let pending: Promise<boolean> | null = null

export const useMfaChallenge = create<MfaState>()((set, get) => ({
  open: false,
  reason: null,
  resolve: null,
  finish: (ok) => {
    const r = get().resolve
    set({ open: false, resolve: null })
    pending = null
    r?.(ok)
  },
}))

export function requestMfa(reason?: string): Promise<boolean> {
  if (pending) return pending
  pending = new Promise<boolean>((resolve) => {
    useMfaChallenge.setState({ open: true, reason: reason ?? null, resolve })
  })
  return pending
}
