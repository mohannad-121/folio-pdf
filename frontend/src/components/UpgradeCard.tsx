import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight, Check } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '../lib/auth'
import { formatPrice, getPlanTier, TIER_META, TIER_VALUE, usePlans, type Tier, tierStyle } from '../lib/plans'
import { startCheckout, useCheckout } from '../lib/paddle'
import { spring } from '../lib/motion'
import { Button } from './ui'
import TierBadge, { TierIcon } from './TierBadge'

/** Inline "this tool needs <tier>" card shown at the top of a locked tool page. */
export default function UpgradeCard({ tier, toolName, className }: { tier: Tier; toolName: string; className?: string }) {
  const reduce = useReducedMotion()
  usePlans((s) => s.plans)
  const me = useAuth((s) => s.me)
  const busy = useCheckout((s) => s.busy)
  const plan = getPlanTier(tier)
  const meta = TIER_META[tier]
  const onPaid = !!me && me.plan !== 'free'
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
      style={tierStyle(tier)}
      aria-labelledby="upgrade-card-h"
      className={clsx('card-wash-strong relative overflow-hidden rounded-2xl border border-[color-mix(in_oklab,var(--accent)_35%,var(--color-border))] bg-surface p-5 shadow-glow sm:p-6', className)}
    >
      <div className="pointer-events-none absolute -top-24 -right-20 size-72 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_30%,transparent),transparent)]" aria-hidden="true" />
      <div className="relative flex flex-col gap-5 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className={clsx('grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br shadow-[0_10px_24px_-10px_var(--accent)]', meta.fill, meta.fgOnFill)}>
            <TierIcon tier={tier} size={22} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <TierBadge tier={tier} locked />
              <span className="text-xs text-muted">7-day free trial · cancel anytime</span>
            </div>
            <h2 id="upgrade-card-h" className="text-title mt-2 text-lg sm:text-xl">
              Unlock {toolName} with {plan.name}
            </h2>
            <ul className="mt-3 grid gap-x-5 gap-y-1.5 text-sm text-muted sm:grid-cols-2 lg:grid-cols-3">
              {TIER_VALUE[tier].map((v) => (
                <li key={v} className="flex items-start gap-2">
                  <Check size={14} strokeWidth={3} className="mt-0.5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                  {v}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center md:flex-col md:items-stretch">
          <Button variant="accent" size="lg" className={clsx(meta.fill, meta.fgOnFill)} loading={busy?.plan === tier} rightIcon={<ArrowRight />} onClick={() => void startCheckout(tier, 'monthly')}>
            {onPaid ? `Upgrade to ${plan.name}` : 'Start 7-day free trial'}
          </Button>
          <Link to="/pricing" className="rounded-md px-2 py-1 text-center text-sm font-medium text-muted transition hover:text-fg">
            See all plans · from {formatPrice(plan.price_yearly / 12)}/mo
          </Link>
        </div>
      </div>
    </motion.section>
  )
}
