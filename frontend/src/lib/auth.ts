/**
 * Accounts on Supabase Auth + entitlements.
 *
 * supabase-js owns the session (stored in localStorage, refreshed automatically). Whenever it
 * changes we ask `/api/auth/me` (with the bearer token) for the plan and limits. `useAuth` is
 * loaded once from Layout via `useAuthBootstrap()`.
 *
 * Sign-in only "counts" once the assurance level is satisfied: if the account has a verified TOTP
 * factor and the session is still aal1, `mfaPending` is true, the API sees an anonymous visitor
 * and the auth flow asks for the authenticator code.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { AuthError, Factor, Session, SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js'
import { ApiError, getJson } from './api'
import { getSupabase, loadAuthConfig, requireSupabase, setMfaPending } from './supabase'
import { FALLBACK_TIERS, isTier, tierCovers, tierRank, toolTier, usePlans, type BillingInterval, type PlanLimits, type Tier } from './plans'

export { tierRank } from './plans'

export interface User {
  id: string
  email: string
  name: string | null
  created_at: string
}

export type PlanStatus = 'none' | 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled' | (string & {})
export type Aal = 'aal1' | 'aal2'

export interface Me {
  user: User | null
  plan: Tier
  plan_status: PlanStatus | null
  plan_interval: BillingInterval | null
  trial_ends_at: string | null
  current_period_end: string | null
  cancel_at: string | null
  billing_enabled: boolean
  accounts_enabled?: boolean
  aal?: Aal | null
  mfa_enabled?: boolean
  limits: PlanLimits
  usage: { today: number; daily_limit: number | null }
}

/**
 * Dev-only escape hatch so the billing UI can be previewed before the backend
 * implements /api/auth/me: open any page with `?billing=preview` (or `=off`).
 */
function devBillingPreview(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false
  try {
    const q = new URLSearchParams(window.location.search).get('billing')
    if (q === 'preview') sessionStorage.setItem('folio.billingPreview', '1')
    if (q === 'off') sessionStorage.removeItem('folio.billingPreview')
    return sessionStorage.getItem('folio.billingPreview') === '1'
  } catch {
    return false
  }
}

/** Anonymous identity used when /api/auth/me is missing (self-hosted / older backend). */
function anonymousMe(billing: boolean): Me {
  const free = FALLBACK_TIERS[0]
  return {
    user: null,
    plan: 'free',
    plan_status: null,
    plan_interval: null,
    trial_ends_at: null,
    current_period_end: null,
    cancel_at: null,
    billing_enabled: billing,
    limits: free.limits,
    usage: { today: 0, daily_limit: free.limits.daily_tasks },
  }
}

/** Preview on a self-hosted server: pretend billing is on and the user is on Free. */
function previewOverrides(me: Me): Partial<Me> {
  if (me.billing_enabled) return {}
  const free = FALLBACK_TIERS[0]
  return { billing_enabled: true, plan: 'free', limits: free.limits, usage: { today: me.usage?.today ?? 0, daily_limit: free.limits.daily_tasks } }
}

function normalise(me: Me): Me {
  return { ...me, plan: isTier(me.plan) ? me.plan : 'free', usage: me.usage ?? { today: 0, daily_limit: null } }
}

// ---------------------------------------------------------------------------
// Results returned by the auth actions (the UI decides which step comes next)
// ---------------------------------------------------------------------------

/** After credentials were accepted: done, or the TOTP step is still needed. */
export type SignInResult = 'done' | 'mfa'
/** After sign-up: a code was emailed, or (autoconfirm projects) the user is already signed in. */
export type SignUpResult = 'confirm' | 'done'

export interface TotpFactor {
  id: string
  friendly_name: string | null
  status: 'verified' | 'unverified'
  created_at: string
}

export interface TotpEnrollment {
  id: string
  /** `data:image/svg+xml` URI of the QR code. */
  qr: string
  /** Base32 secret for manual entry. */
  secret: string
  /** otpauth:// URI. */
  uri: string
}

function fail(error: AuthError | Error | null | undefined): void {
  if (error) throw error
}

interface AuthState {
  me: Me | null
  /** True until the first /me response (or failure). */
  loading: boolean
  /** True when /api/auth/me exists on this server. */
  available: boolean
  /** Supabase accounts are configured on this server (null = not known yet). */
  accountsEnabled: boolean | null
  session: Session | null
  user: SupabaseUser | null
  aal: Aal | null
  nextAal: Aal | null
  /** Signed in with a password/code, but the authenticator code is still needed. */
  mfaPending: boolean

  refresh: () => Promise<Me | null>
  setMe: (me: Me) => void
  /** Re-read the assurance level from supabase-js. */
  syncAal: () => Promise<SignInResult>

  signUp: (email: string, password: string, name?: string) => Promise<SignUpResult>
  verifySignupCode: (email: string, code: string) => Promise<SignInResult>
  resendSignupCode: (email: string) => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<SignInResult>
  sendSignInCode: (email: string) => Promise<void>
  signInWithEmailCode: (email: string, code: string) => Promise<SignInResult>
  sendPasswordReset: (email: string) => Promise<void>
  verifyRecoveryCode: (email: string, code: string) => Promise<SignInResult>
  updatePassword: (password: string, nonce?: string) => Promise<void>
  reauthenticate: () => Promise<void>
  signOut: (scope?: 'local' | 'global') => Promise<void>

  listFactors: () => Promise<TotpFactor[]>
  enrollTotp: (friendlyName?: string) => Promise<TotpEnrollment>
  verifyEnrollment: (factorId: string, code: string) => Promise<void>
  challengeTotp: (code: string, factorId?: string) => Promise<void>
  unenroll: (factorId: string) => Promise<void>
}

let inflight: Promise<Me | null> | null = null

async function sb(): Promise<SupabaseClient> {
  return requireSupabase()
}

export const useAuth = create<AuthState>()((set, get) => ({
  me: null,
  loading: true,
  available: false,
  accountsEnabled: null,
  session: null,
  user: null,
  aal: null,
  nextAal: null,
  mfaPending: false,

  refresh: () => {
    if (inflight) return inflight
    inflight = getJson<Me>('/api/auth/me')
      .then((me) => {
        const m = normalise(me)
        if (devBillingPreview()) Object.assign(m, previewOverrides(m))
        set({ me: m, available: true, loading: false })
        return m
      })
      .catch((e: unknown) => {
        // Endpoint missing or server down: behave like the self-hosted edition.
        const missing = e instanceof ApiError && (e.status === 404 || e.code === 'not_implemented')
        const prev = get().me
        const me = prev && !missing ? prev : anonymousMe(devBillingPreview())
        set({ me, available: !missing && get().available, loading: false })
        return me
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  },
  setMe: (me) => set({ me: normalise(me), available: true, loading: false }),

  syncAal: async () => {
    const client = await getSupabase()
    if (!client) return 'done'
    const { data } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
    const current = (data?.currentLevel ?? null) as Aal | null
    const next = (data?.nextLevel ?? null) as Aal | null
    const { data: s } = await client.auth.getSession()
    const pending = !!s.session && current === 'aal1' && next === 'aal2'
    setMfaPending(pending)
    set({ aal: current, nextAal: next, mfaPending: pending, session: s.session, user: s.session?.user ?? null })
    return pending ? 'mfa' : 'done'
  },

  signUp: async (email, password, name) => {
    const client = await sb()
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: name ? { full_name: name } : {}, emailRedirectTo: window.location.origin },
    })
    fail(error)
    // Existing, confirmed address: Supabase hides it by returning a user without identities.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw Object.assign(new Error('An account with this email already exists.'), { code: 'user_already_exists' })
    }
    if (data.session) {
      await get().syncAal()
      return 'done'
    }
    return 'confirm'
  },
  verifySignupCode: async (email, code) => {
    const client = await sb()
    let { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' })
    if (error && error.code === 'otp_expired') {
      // Older projects issue signup confirmations under the "signup" type.
      const retry = await client.auth.verifyOtp({ email, token: code, type: 'signup' })
      if (!retry.error) error = null
    }
    fail(error)
    return get().syncAal()
  },
  resendSignupCode: async (email) => {
    const client = await sb()
    const { error } = await client.auth.resend({ type: 'signup', email })
    fail(error)
  },
  signInWithPassword: async (email, password) => {
    const client = await sb()
    const { error } = await client.auth.signInWithPassword({ email, password })
    fail(error)
    return get().syncAal()
  },
  sendSignInCode: async (email) => {
    const client = await sb()
    const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
    fail(error)
  },
  signInWithEmailCode: async (email, code) => {
    const client = await sb()
    const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' })
    fail(error)
    return get().syncAal()
  },
  sendPasswordReset: async (email) => {
    const client = await sb()
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/forgot` })
    fail(error)
  },
  verifyRecoveryCode: async (email, code) => {
    const client = await sb()
    const { error } = await client.auth.verifyOtp({ email, token: code, type: 'recovery' })
    fail(error)
    return get().syncAal()
  },
  updatePassword: async (password, nonce) => {
    const client = await sb()
    const { error } = await client.auth.updateUser(nonce ? { password, nonce } : { password })
    fail(error)
  },
  reauthenticate: async () => {
    const client = await sb()
    const { error } = await client.auth.reauthenticate()
    fail(error)
  },
  signOut: async (scope = 'local') => {
    const client = await getSupabase()
    try {
      if (client) await client.auth.signOut({ scope })
    } finally {
      setMfaPending(false)
      set({ session: null, user: null, aal: null, nextAal: null, mfaPending: false, me: anonymousMe(get().me?.billing_enabled ?? false) })
      void get().refresh()
    }
  },

  listFactors: async () => {
    const client = await sb()
    const { data, error } = await client.auth.mfa.listFactors()
    fail(error)
    return (data?.all ?? [])
      .filter((f: Factor) => f.factor_type === 'totp')
      .map((f: Factor) => ({ id: f.id, friendly_name: f.friendly_name ?? null, status: f.status as TotpFactor['status'], created_at: f.created_at }))
  },
  enrollTotp: async (friendlyName) => {
    const client = await sb()
    // Drop abandoned (unverified) enrolments first; they block re-enrolling with the same name.
    try {
      const { data } = await client.auth.mfa.listFactors()
      for (const f of data?.all ?? []) {
        if (f.factor_type === 'totp' && f.status === 'unverified') await client.auth.mfa.unenroll({ factorId: f.id })
      }
    } catch {
      /* best effort */
    }
    const name = friendlyName?.trim() || `Authenticator app (${new Date().toLocaleDateString()})`
    let res = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: name, issuer: 'Folio PDF' })
    if (res.error?.code === 'mfa_factor_name_conflict') {
      res = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: `${name} ${Math.random().toString(36).slice(2, 6)}`, issuer: 'Folio PDF' })
    }
    fail(res.error)
    const d = res.data!
    if (d.type !== 'totp') throw new Error('Unexpected factor type')
    const qr = d.totp.qr_code.startsWith('data:') ? d.totp.qr_code : `data:image/svg+xml;utf-8,${encodeURIComponent(d.totp.qr_code)}`
    return { id: d.id, qr, secret: d.totp.secret, uri: d.totp.uri }
  },
  verifyEnrollment: async (factorId, code) => {
    const client = await sb()
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code })
    fail(error)
    await get().syncAal()
    void get().refresh()
  },
  challengeTotp: async (code, factorId) => {
    const client = await sb()
    let id = factorId
    if (!id) {
      const { data, error } = await client.auth.mfa.listFactors()
      fail(error)
      id = data?.totp?.[0]?.id
      if (!id) throw new Error('No authenticator app is set up for this account.')
    }
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId: id, code })
    fail(error)
    await get().syncAal()
    void get().refresh()
  },
  unenroll: async (factorId) => {
    const client = await sb()
    const { error } = await client.auth.mfa.unenroll({ factorId })
    fail(error)
    // The session still says aal2 with the old factor; refresh so claims match.
    await client.auth.refreshSession().catch(() => undefined)
    await get().syncAal()
    void get().refresh()
  },
}))

/** Mount once (Layout): loads the session and the plan catalog. */
export function useAuthBootstrap() {
  useEffect(() => {
    let unsub: (() => void) | null = null
    let alive = true
    void usePlans.getState().load()
    void (async () => {
      const cfg = await loadAuthConfig()
      useAuth.setState({ accountsEnabled: cfg.enabled })
      const client = await getSupabase()
      if (client && alive) {
        await useAuth.getState().syncAal().catch(() => undefined)
        const { data } = client.auth.onAuthStateChange((event, session) => {
          useAuth.setState({ session, user: session?.user ?? null })
          // Don't call other supabase-js methods inside the callback (it holds the auth lock).
          window.setTimeout(() => {
            void (async () => {
              if (event === 'SIGNED_OUT') {
                setMfaPending(false)
                useAuth.setState({ aal: null, nextAal: null, mfaPending: false })
              } else {
                await useAuth.getState().syncAal().catch(() => undefined)
              }
              // Token refreshes don't change who the user is.
              if (event !== 'TOKEN_REFRESHED') void useAuth.getState().refresh()
            })()
          }, 0)
        })
        unsub = () => data.subscription.unsubscribe()
      }
      if (alive) void useAuth.getState().refresh()
    })()
    // Re-check the session when the tab regains focus (e.g. after the billing portal).
    const onFocus = () => {
      if (document.visibilityState === 'visible') void useAuth.getState().refresh()
    }
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      alive = false
      unsub?.()
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [])
}

/** Whether sign-in / account UI should show at all. */
export function useAccountsEnabled(): boolean {
  return useAuth((s) => !!s.accountsEnabled)
}

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

/** Whether pricing / upgrade UI should show at all. */
export function useBillingEnabled(): boolean {
  return useAuth((s) => !!s.me?.billing_enabled)
}

/** The user's effective tier. Billing off (or session unknown) → everything unlocked (max). */
export function currentTier(me: Me | null = useAuth.getState().me): Tier {
  // Unknown session (still loading): treat as unlocked so nothing flickers.
  if (!me) return 'max'
  if (!me.billing_enabled) return 'max'
  return me.plan
}

export function useTier(): Tier {
  return useAuth((s) => currentTier(s.me))
}

export function canUse(tier: Tier, me: Me | null = useAuth.getState().me): boolean {
  return tierCovers(currentTier(me), tier)
}

export interface Entitlement {
  allowed: boolean
  requiredPlan: Tier
  /** True while the session is still loading (treat as allowed to avoid flicker). */
  pending: boolean
}

export function useEntitlement(toolId: string): Entitlement {
  const tier = useTier()
  const loading = useAuth((s) => s.loading)
  const required = usePlans((s) => toolTier(toolId, s.plans))
  return { allowed: loading || tierCovers(tier, required), requiredPlan: required, pending: loading }
}

/** Required tier if the current user is below it, else null. Used for lock badges. */
export function useLockedTier(required: Tier): Tier | null {
  const tier = useTier()
  const loading = useAuth((s) => s.loading)
  if (loading || tierRank(tier) >= tierRank(required)) return null
  return required
}

/** "Ada Lovelace" → "AL"; falls back to the email. */
export function initials(u: Pick<User, 'name' | 'email'> | null | undefined): string {
  if (!u) return '?'
  const src = (u.name ?? '').trim() || u.email.split('@')[0]
  const parts = src.split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? ''))).toUpperCase() || '?'
}

/** Whole days until an ISO date (ceil, ≥ 0). */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.ceil((t - Date.now()) / 86_400_000))
}

/** 0..4 password strength with a label. */
export function passwordStrength(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: '' }
  if (pw.length < 8) return { score: 0, label: 'Too short' }
  let s = 1
  if (pw.length >= 12) s++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++
  else if (/\d|[^A-Za-z0-9]/.test(pw) && pw.length >= 14) s++
  s = Math.min(4, s)
  return { score: s, label: ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][s] }
}
