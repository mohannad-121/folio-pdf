/**
 * Shared "you hit a plan limit" flow. Any 402 / 413 / 429 gating ApiError is
 * routed to `openUpgrade`, which shows <UpgradeDialog /> (mounted in Layout).
 */
import { create } from 'zustand'
import { ApiError } from './api'
import { useAuth } from './auth'
import { isTier, type Tier } from './plans'

export type GatingCode = 'upgrade_required' | 'file_too_large' | 'daily_limit'

export interface UpgradeRequest {
  requiredPlan: Tier
  /** Server message (or our own copy). */
  reason?: string
  code?: GatingCode
  /** Feature name from the server, e.g. "OCR". */
  feature?: string
  /** For daily_limit: ISO time the quota resets. */
  resetAt?: string
  limit?: number
  used?: number
  maxMb?: number
}

interface UpgradeState {
  open: boolean
  req: UpgradeRequest | null
  openUpgrade: (req: UpgradeRequest) => void
  close: () => void
}

export const useUpgrade = create<UpgradeState>()((set) => ({
  open: false,
  req: null,
  openUpgrade: (req) => set({ open: true, req }),
  close: () => set({ open: false }),
}))

export function openUpgrade(req: UpgradeRequest) {
  useUpgrade.getState().openUpgrade(req)
}

const GATING: Record<number, GatingCode> = { 402: 'upgrade_required', 413: 'file_too_large', 429: 'daily_limit' }

/** Is this a plan-gating error (402/413/429 with a known code or a required_plan)? */
export function isGatingError(e: unknown): e is ApiError {
  if (!(e instanceof ApiError)) return false
  if (e.code === 'upgrade_required' || e.code === 'file_too_large' || e.code === 'daily_limit') return true
  return e.status in GATING && !!e.data && isTier(e.data.required_plan)
}

/**
 * If `e` is a gating error, open the upgrade dialog and return true.
 * Callers fall back to their normal error UI when this returns false.
 * When billing is disabled nothing is gated, so this always returns false.
 */
export function handleGatingError(e: unknown): boolean {
  if (!isGatingError(e)) return false
  if (!useAuth.getState().me?.billing_enabled) return false
  openUpgrade(gatingRequest(e))
  return true
}

export function gatingRequest(e: ApiError): UpgradeRequest {
  const d = e.data ?? {}
  const code = (e.code as GatingCode | undefined) ?? GATING[e.status]
  const req = isTier(d.required_plan) ? d.required_plan : code === 'daily_limit' ? 'plus' : 'pro'
  return {
    requiredPlan: req,
    reason: e.message,
    code,
    feature: typeof d.feature === 'string' ? d.feature : undefined,
    resetAt: typeof d.reset_at === 'string' ? d.reset_at : undefined,
    limit: typeof d.limit === 'number' ? d.limit : undefined,
    used: typeof d.used === 'number' ? d.used : undefined,
    maxMb: typeof d.max_mb === 'number' ? d.max_mb : undefined,
  }
}
