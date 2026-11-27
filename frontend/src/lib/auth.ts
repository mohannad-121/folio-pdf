/**
 * Session + entitlements. The session is an httpOnly cookie, so the client only
 * ever asks `/api/auth/me` who it is. `useAuth` is loaded once from Layout.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { ApiError, getJson, sendJson } from './api'
import { FALLBACK_TIERS, isTier, tierCovers, tierRank, toolTier, usePlans, type BillingInterval, type PlanLimits, type Tier } from './plans'

export { tierRank } from './plans'

export interface User {
  id: string
  email: string
  name: string | null
  created_at: string
}

export type PlanStatus = 'none' | 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled' | (string & {})

export interface Me {
  user: User | null
  plan: Tier
  plan_status: PlanStatus | null
  plan_interval: BillingInterval | null
  trial_ends_at: string | null
  current_period_end: string | null
  cancel_at: string | null
  billing_enabled: boolean
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

interface AuthState {
  me: Me | null
  /** True until the first /me response (or failure). */
  loading: boolean
  /** True when /api/auth/me exists on this server. */
  available: boolean
  refresh: () => Promise<Me | null>
  setMe: (me: Me) => void
  login: (email: string, password: string) => Promise<Me>
  signup: (email: string, password: string, name?: string) => Promise<Me>
  logout: () => Promise<void>
}

let inflight: Promise<Me | null> | null = null

export const useAuth = create<AuthState>()((set, get) => ({
  me: null,
  loading: true,
  available: false,
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
  login: async (email, password) => {
    const me = normalise(await sendJson<Me>('POST', '/api/auth/login', { email, password }))
    if (devBillingPreview()) Object.assign(me, previewOverrides(me))
    set({ me, available: true })
    return me
  },
  signup: async (email, password, name) => {
    const me = normalise(await sendJson<Me>('POST', '/api/auth/signup', { email, password, ...(name ? { name } : {}) }))
    if (devBillingPreview()) Object.assign(me, previewOverrides(me))
    set({ me, available: true })
    return me
  },
  logout: async () => {
    try {
      await sendJson<void>('POST', '/api/auth/logout')
    } finally {
      const prev = get().me
      set({ me: anonymousMe(prev?.billing_enabled ?? false) })
      void get().refresh()
    }
  },
}))

/** Mount once (Layout): loads the session and the plan catalog. */
export function useAuthBootstrap() {
  useEffect(() => {
    void useAuth.getState().refresh()
    void usePlans.getState().load()
    // Re-check the session when the tab regains focus (e.g. after the billing portal).
    const onFocus = () => {
      if (document.visibilityState === 'visible') void useAuth.getState().refresh()
    }
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
  }, [])
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
