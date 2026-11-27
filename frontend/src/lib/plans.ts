/**
 * Plan catalog (Free / Plus / Pro / Max) + tier helpers.
 *
 * The live catalog comes from `GET /api/plans`; until it responds (or when the
 * backend does not implement it yet) the FALLBACK constants below are used.
 * They mirror the backend contract exactly so the UI never renders empty.
 */
import type { CSSProperties } from 'react'
import { create } from 'zustand'
import { getJson } from './api'

export type Tier = 'free' | 'plus' | 'pro' | 'max'
export type PaidTier = Exclude<Tier, 'free'>
export type BillingInterval = 'monthly' | 'yearly'

export const TIER_ORDER: Tier[] = ['free', 'plus', 'pro', 'max']
export const PAID_TIERS: PaidTier[] = ['plus', 'pro', 'max']

export interface PlanLimits {
  max_file_mb: number
  daily_tasks: number | null
  max_files_per_task: number | null
  batch: boolean
  api_access: boolean
  team_seats: number
  priority_processing: boolean
}

export interface PlanTier {
  id: Tier
  name: string
  tagline: string
  price_monthly: number
  price_yearly: number
  trial_days: number
  highlight: boolean
  limits: PlanLimits
  features: string[]
}

export interface PlansResponse {
  tiers: PlanTier[]
  tool_tiers: Record<string, Tier>
  op_tiers: Record<string, Tier>
}

export function isTier(x: unknown): x is Tier {
  return x === 'free' || x === 'plus' || x === 'pro' || x === 'max'
}

export function tierRank(t: Tier | null | undefined): number {
  return t ? TIER_ORDER.indexOf(t) : 0
}

/** True if `have` covers `need`. */
export function tierCovers(have: Tier, need: Tier): boolean {
  return tierRank(have) >= tierRank(need)
}

// ---------------------------------------------------------------------------
// Fallback catalog
// ---------------------------------------------------------------------------

export const FALLBACK_TIERS: PlanTier[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'The essentials, free forever.',
    price_monthly: 0,
    price_yearly: 0,
    trial_days: 0,
    highlight: false,
    limits: { max_file_mb: 10, daily_tasks: 5, max_files_per_task: 3, batch: false, api_access: false, team_seats: 1, priority_processing: false },
    features: ['View, annotate and print PDFs', 'Merge, split and organize up to 3 files', 'Text-only converters', 'Low compression', '10 MB files · 5 tasks a day'],
  },
  {
    id: 'plus',
    name: 'Plus',
    tagline: 'For everyday documents.',
    price_monthly: 5,
    price_yearly: 48,
    trial_days: 7,
    highlight: false,
    limits: { max_file_mb: 50, daily_tasks: null, max_files_per_task: 20, batch: false, api_access: false, team_seats: 1, priority_processing: false },
    features: ['All Office, image and HTML converters', 'Edit text and images in PDFs', 'Sign, watermark and page numbers', 'Protect and unlock PDFs', 'All compression levels', '50 MB files · unlimited tasks'],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Every power tool, for professionals.',
    price_monthly: 12,
    price_yearly: 108,
    trial_days: 7,
    highlight: true,
    limits: { max_file_mb: 200, daily_tasks: null, max_files_per_task: null, batch: true, api_access: false, team_seats: 1, priority_processing: false },
    features: ['Everything in Plus', 'OCR for scanned documents', 'Redaction and PDF compare', 'Form builder', 'Digital certificate signatures', 'PDF/A archiving', 'Batch processing · 200 MB files'],
  },
  {
    id: 'max',
    name: 'Max',
    tagline: 'No ceilings. Built for teams and automation.',
    price_monthly: 24,
    price_yearly: 216,
    trial_days: 7,
    highlight: false,
    limits: { max_file_mb: 1024, daily_tasks: null, max_files_per_task: null, batch: true, api_access: true, team_seats: 5, priority_processing: true },
    features: ['Everything in Pro', '1 GB files', 'REST API access', 'Priority processing', '5 team seats (coming soon)'],
  },
]

const PLUS_TOOLS = [
  'word-to-pdf', 'excel-to-pdf', 'powerpoint-to-pdf', 'images-to-pdf', 'html-to-pdf', 'scan-to-pdf',
  'pdf-to-word', 'pdf-to-excel', 'pdf-to-powerpoint', 'pdf-to-jpg', 'pdf-to-png', 'pdf-to-html',
  'edit', 'watermark', 'page-numbers', 'header-footer', 'background', 'metadata', 'bookmarks',
  'repair', 'flatten', 'grayscale', 'protect', 'unlock', 'sanitize', 'sign', 'stamp', 'fill-form', 'form-data', 'accessibility',
]
const PRO_TOOLS = ['ocr', 'redact', 'compare', 'digital-sign', 'pdf-to-pdfa']

export const FALLBACK_TOOL_TIERS: Record<string, Tier> = {
  ...Object.fromEntries(PLUS_TOOLS.map((id) => [id, 'plus' as Tier])),
  ...Object.fromEntries(PRO_TOOLS.map((id) => [id, 'pro' as Tier])),
}

export const FALLBACK_OP_TIERS: Record<string, Tier> = {
  edit_text: 'plus',
  replace_text: 'plus',
  image: 'plus',
  signature: 'plus',
  stamp: 'plus',
  redact: 'pro',
  form_field: 'pro',
}

export const FALLBACK_PLANS: PlansResponse = { tiers: FALLBACK_TIERS, tool_tiers: FALLBACK_TOOL_TIERS, op_tiers: FALLBACK_OP_TIERS }

/**
 * Option values that need a higher tier (not part of the API contract, so this
 * is a client-side mirror; the server enforces it with a 402 regardless).
 */
export const OPTION_TIERS: Record<string, Record<string, Record<string, Tier>>> = {
  compress: { level: { medium: 'plus', high: 'plus', extreme: 'plus' } },
}

export function optionTier(toolId: string, key: string, value: unknown): Tier | null {
  if (typeof value !== 'string') return null
  return OPTION_TIERS[toolId]?.[key]?.[value] ?? null
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface PlansState {
  plans: PlansResponse
  /** True once the live catalog responded. */
  live: boolean
  loading: boolean
  load: (force?: boolean) => Promise<void>
}

let inflight: Promise<void> | null = null

export const usePlans = create<PlansState>()((set, get) => ({
  plans: FALLBACK_PLANS,
  live: false,
  loading: false,
  load: (force) => {
    if (inflight) return inflight
    if (get().live && !force) return Promise.resolve()
    set({ loading: true })
    inflight = getJson<PlansResponse>('/api/plans')
      .then((p) => {
        if (p && Array.isArray(p.tiers) && p.tiers.length) {
          const tiers = TIER_ORDER.map((id) => p.tiers.find((t) => t.id === id)).filter((t): t is PlanTier => !!t)
          set({ plans: { tiers, tool_tiers: p.tool_tiers ?? {}, op_tiers: p.op_tiers ?? {} }, live: true })
        }
      })
      .catch(() => {
        /* keep the fallback */
      })
      .finally(() => {
        inflight = null
        set({ loading: false })
      })
    return inflight
  },
}))

export function getPlanTier(id: Tier): PlanTier {
  const { tiers } = usePlans.getState().plans
  return tiers.find((t) => t.id === id) ?? FALLBACK_TIERS.find((t) => t.id === id)!
}

/** Required tier for a tool id ("free" when not listed). */
export function toolTier(toolId: string, plans: PlansResponse = usePlans.getState().plans): Tier {
  const t = plans.tool_tiers[toolId]
  return isTier(t) ? t : 'free'
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export interface TierMeta {
  id: Tier
  name: string
  /** CSS color for --accent. */
  accent: string
  /** Second gradient stop (CSS color). */
  accent2: string
  /** Text color classes (AA on surface in both themes). */
  text: string
  /** Gradient classes for solid fills (from/to). Pair with `fgOnFill`. */
  fill: string
  /** Foreground color on `fill`. */
  fgOnFill: string
  /** Small pill (badge) classes. */
  chip: string
  /** Lucide icon name. */
  icon: string
}

export const TIER_META: Record<Tier, TierMeta> = {
  free: {
    id: 'free',
    name: 'Free',
    accent: 'var(--color-tier-free-500)',
    accent2: 'var(--color-tier-free-400)',
    text: 'text-tier-free-600 dark:text-tier-free-300',
    fill: 'from-tier-free-600 to-tier-free-700',
    fgOnFill: 'text-white',
    chip: 'bg-surface-2 text-muted ring-1 ring-inset ring-border',
    icon: 'Feather',
  },
  plus: {
    id: 'plus',
    name: 'Plus',
    accent: 'var(--color-tier-plus-500)',
    accent2: 'var(--color-tier-plus-400)',
    text: 'text-tier-plus-700 dark:text-tier-plus-300',
    fill: 'from-tier-plus-600 to-tier-plus-800',
    fgOnFill: 'text-white',
    chip: 'bg-tier-plus-100 text-tier-plus-800 ring-1 ring-inset ring-tier-plus-300/60 dark:bg-tier-plus-500/15 dark:text-tier-plus-300 dark:ring-tier-plus-500/30',
    icon: 'Zap',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    accent: 'var(--color-brand-500)',
    accent2: 'var(--color-cat-organize-500)',
    text: 'text-brand-600 dark:text-brand-300',
    fill: 'from-brand-600 to-cat-organize-600',
    fgOnFill: 'text-white',
    chip: 'bg-linear-to-r from-brand-600 to-cat-organize-600 text-white ring-1 ring-inset ring-white/15',
    icon: 'Sparkles',
  },
  max: {
    id: 'max',
    name: 'Max',
    accent: 'var(--color-tier-max-500)',
    accent2: 'var(--color-tier-max-300)',
    text: 'text-tier-max-700 dark:text-tier-max-300',
    fill: 'from-tier-max-300 via-tier-max-400 to-tier-max-500',
    fgOnFill: 'text-tier-max-950!',
    chip: 'bg-linear-to-r from-tier-max-200 to-tier-max-300 text-tier-max-900 ring-1 ring-inset ring-tier-max-400/60 dark:from-tier-max-400/20 dark:to-tier-max-500/20 dark:text-tier-max-200 dark:ring-tier-max-400/30',
    icon: 'Crown',
  },
}

/** "$9" / "$4.50" */
export function formatPrice(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`
}

/** Per-month price for an interval (yearly → yearly / 12). */
export function monthlyEquivalent(t: PlanTier, interval: BillingInterval): number {
  return interval === 'yearly' ? Math.round((t.price_yearly / 12) * 100) / 100 : t.price_monthly
}

/** Yearly saving vs. paying monthly, 0..1. */
export function yearlySaving(t: PlanTier): number {
  if (!t.price_monthly) return 0
  return 1 - t.price_yearly / (t.price_monthly * 12)
}

export function formatMb(mb: number): string {
  return mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10} GB` : `${mb} MB`
}

/** Three headline benefits per tier (upgrade dialog / upgrade card). */
export const TIER_VALUE: Record<Tier, string[]> = {
  free: ['View, annotate and print PDFs', 'Merge, split and organize', 'Text-only converters'],
  plus: ['Every Office, image and HTML converter', 'Edit text and images, sign and watermark', '50 MB files and unlimited daily tasks'],
  pro: ['OCR, redaction and PDF compare', 'Digital signatures, PDF/A and the form builder', 'Batch processing and 200 MB files'],
  max: ['1 GB files and priority processing', 'REST API access for automation', '5 team seats (coming soon)'],
}

/** Inline style that sets --accent / --accent-2 to a tier's colors. */
export function tierStyle(tier: Tier): CSSProperties {
  const m = TIER_META[tier]
  return { '--accent': m.accent, '--accent-2': m.accent2 } as CSSProperties
}
