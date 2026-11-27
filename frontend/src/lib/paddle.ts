/**
 * Paddle Billing (Paddle.js v2, overlay checkout).
 *
 *   startCheckout('pro', 'monthly')
 *     → not signed in?  open the auth dialog, then resume automatically
 *     → POST /api/billing/checkout  (409 = already subscribed → change-plan dialog)
 *     → Paddle.Checkout.open({ items, customer, customData, settings })
 *     → checkout.completed → POST /api/billing/sync (retries) → refresh me → /account
 *
 * Paddle.js is loaded lazily (first checkout) from `/api/billing/config`.
 */
import type { Paddle, PaddleEventData } from '@paddle/paddle-js'
import { create } from 'zustand'
import { ApiError, getJson, sendJson } from './api'
import { useAuth, type Me } from './auth'
import { getPlanTier, type BillingInterval, type PaidTier, type Tier } from './plans'
import { useTheme } from './theme'
import { toast } from '../components/ui/Toaster'

export interface BillingConfig {
  enabled: boolean
  environment: 'sandbox' | 'production'
  client_token: string
  trial_days: number
  prices: Record<PaidTier, { monthly: string; yearly: string }>
}

interface CheckoutResponse {
  price_id: string
  customer: { email: string } | { id: string }
  custom_data: { user_id: string } & Record<string, unknown>
  success_url: string
}

export interface CheckoutIntent {
  plan: PaidTier
  interval: BillingInterval
}

// ---------------------------------------------------------------------------
// UI state shared with the dialogs mounted in Layout
// ---------------------------------------------------------------------------

type AuthMode = 'signin' | 'signup'

interface CheckoutState {
  /** Plan being prepared (spinner on that CTA). */
  busy: CheckoutIntent | null
  /** Auth dialog (opened by startCheckout or the header). */
  auth: { open: boolean; mode: AuthMode; intent: CheckoutIntent | null }
  /** Existing subscriber wants another plan → confirm proration. */
  change: CheckoutIntent | null
  openAuth: (mode?: AuthMode, intent?: CheckoutIntent | null) => void
  closeAuth: () => void
  setChange: (c: CheckoutIntent | null) => void
}

export const useCheckout = create<CheckoutState>()((set) => ({
  busy: null,
  auth: { open: false, mode: 'signin', intent: null },
  change: null,
  openAuth: (mode = 'signin', intent = null) => set({ auth: { open: true, mode, intent } }),
  closeAuth: () => set((s) => ({ auth: { ...s.auth, open: false } })),
  setChange: (change) => set({ change }),
}))

// ---------------------------------------------------------------------------
// Paddle instance
// ---------------------------------------------------------------------------

let config: BillingConfig | null = null
let paddlePromise: Promise<Paddle | undefined> | null = null
let navigateFn: ((to: string) => void) | null = null
let pendingPlan: CheckoutIntent | null = null

/** Layout registers react-router's navigate so checkout completion can route. */
export function registerNavigate(fn: (to: string) => void) {
  navigateFn = fn
}

export async function getBillingConfig(): Promise<BillingConfig> {
  if (config) return config
  config = await getJson<BillingConfig>('/api/billing/config')
  return config
}

async function getPaddle(): Promise<Paddle> {
  const cfg = await getBillingConfig()
  if (!cfg.enabled || !cfg.client_token) throw new Error('Billing is not configured on this server.')
  if (!paddlePromise) {
    paddlePromise = import('@paddle/paddle-js').then(({ initializePaddle }) => initializePaddle({ environment: cfg.environment, token: cfg.client_token, eventCallback: onPaddleEvent })).catch((e: unknown) => {
      paddlePromise = null
      throw e
    })
  }
  const p = await paddlePromise
  if (!p) {
    paddlePromise = null
    throw new Error('Could not load the secure checkout. Check your connection or ad blocker and try again.')
  }
  return p
}

function onPaddleEvent(ev: PaddleEventData) {
  if (ev.name === 'checkout.completed') {
    const plan = pendingPlan
    void afterCheckout(plan)
  } else if (ev.name === 'checkout.closed') {
    useCheckout.setState({ busy: null })
  } else if (ev.name === 'checkout.error' && ev.detail) {
    toast.error('Checkout error', ev.detail)
  }
}

/** POST /billing/sync, retrying while the webhook catches up. */
export async function syncBilling(expectPaid = true, attempts = 5): Promise<Me | null> {
  let last: Me | null = null
  for (let i = 0; i < attempts; i++) {
    try {
      last = await sendJson<Me>('POST', '/api/billing/sync')
      useAuth.getState().setMe(last)
      if (!expectPaid || last.plan !== 'free') return last
    } catch {
      /* webhook may lag; retry */
    }
    await new Promise((r) => setTimeout(r, 1200 * (i + 1)))
  }
  await useAuth.getState().refresh()
  return last
}

let completing = false
async function afterCheckout(intent: CheckoutIntent | null) {
  if (completing) return
  completing = true
  try {
    const me = await syncBilling(true)
    const tier = (me?.plan && me.plan !== 'free' ? me.plan : intent?.plan) ?? 'pro'
    const name = getPlanTier(tier).name
    const trialing = !me || me.plan_status === 'trialing' || me.plan_status == null
    toast.success(trialing ? `Your 7-day ${name} trial has started 🎉` : `Welcome to ${name} 🎉`, 'Everything in your plan is unlocked.')
    try {
      const p = await paddlePromise
      p?.Checkout.close()
    } catch {
      /* ignore */
    }
    navigateFn?.('/account?checkout=success')
  } finally {
    completing = false
    pendingPlan = null
    useCheckout.setState({ busy: null })
  }
}

// ---------------------------------------------------------------------------
// Public actions
// ---------------------------------------------------------------------------

export async function startCheckout(plan: Tier, interval: BillingInterval = 'monthly'): Promise<void> {
  if (plan === 'free') {
    if (!useAuth.getState().me?.user) useCheckout.getState().openAuth('signup')
    return
  }
  const intent: CheckoutIntent = { plan, interval }
  const me = useAuth.getState().me
  if (!me?.user) {
    useCheckout.getState().openAuth('signup', intent)
    return
  }
  // Existing paid subscriber → change plan instead of a second subscription.
  if (me.plan !== 'free' && me.plan_status && me.plan_status !== 'canceled' && me.plan_status !== 'none') {
    useCheckout.getState().setChange(intent)
    return
  }

  useCheckout.setState({ busy: intent })
  try {
    const [paddle, co] = await Promise.all([getPaddle(), sendJson<CheckoutResponse>('POST', '/api/billing/checkout', intent)])
    pendingPlan = intent
    paddle.Checkout.open({
      items: [{ priceId: co.price_id, quantity: 1 }],
      ...(co.customer ? { customer: co.customer } : {}),
      customData: co.custom_data,
      settings: {
        displayMode: 'overlay',
        theme: useTheme.getState().resolved,
        successUrl: co.success_url,
        allowLogout: false,
      },
    })
  } catch (e) {
    useCheckout.setState({ busy: null })
    if (e instanceof ApiError && e.status === 401) {
      useCheckout.getState().openAuth('signin', intent)
      return
    }
    if (e instanceof ApiError && e.status === 409) {
      useCheckout.getState().setChange(intent)
      return
    }
    toast.error('Could not start checkout', e instanceof Error ? e.message : String(e))
  }
}

/** Called by the auth dialog after a successful sign-in / sign-up. */
export function resumeCheckout(intent: CheckoutIntent | null) {
  if (intent) void startCheckout(intent.plan, intent.interval)
}

export async function changePlan(intent: CheckoutIntent): Promise<Me> {
  const me = await sendJson<Me>('POST', '/api/billing/change-plan', intent)
  useAuth.getState().setMe(me)
  return me
}

/** Opens the Paddle customer portal in a new tab. */
export async function openBillingPortal(): Promise<void> {
  // Open the tab synchronously (popup blockers), then point it at the URL.
  const tab = window.open('about:blank', '_blank')
  try {
    const { url } = await sendJson<{ url: string }>('POST', '/api/billing/portal')
    if (tab) {
      tab.opener = null
      tab.location.href = url
    } else window.location.href = url
  } catch (e) {
    tab?.close()
    toast.error('Could not open billing', e instanceof Error ? e.message : String(e))
  }
}
