import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight, Check, Clock, X } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '../lib/auth'
import { formatMb, formatPrice, getPlanTier, TIER_META, TIER_VALUE, usePlans, type Tier, tierStyle } from '../lib/plans'
import { startCheckout, useCheckout } from '../lib/paddle'
import { useUpgrade, type UpgradeRequest } from '../lib/upgrade'
import { spring, staggerContainer, staggerItem } from '../lib/motion'
import { Button, Dialog } from './ui'
import { TierIcon } from './TierBadge'

function titleFor(req: UpgradeRequest, planName: string): string {
  switch (req.code) {
    case 'file_too_large':
      return 'This file is too big for your plan'
    case 'daily_limit':
      return 'You have used today’s free tasks'
    default:
      return req.feature ? `${req.feature} is part of ${planName}` : `This is a ${planName} feature`
  }
}

/** Live "3h 12m 08s" countdown to an ISO time. */
function useCountdown(iso: string | undefined): string | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!iso) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [iso])
  if (!iso) return null
  const target = Date.parse(iso)
  if (!Number.isFinite(target)) return null
  let s = Math.max(0, Math.round((target - now) / 1000))
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  return `${h ? `${h}h ` : ''}${String(m).padStart(h ? 2 : 1, '0')}m ${String(s).padStart(2, '0')}s`
}

/** The shared plan-limit dialog (mounted once in Layout; opened via openUpgrade()). */
export default function UpgradeDialog() {
  const open = useUpgrade((s) => s.open)
  const req = useUpgrade((s) => s.req)
  const close = useUpgrade((s) => s.close)
  return (
    <Dialog open={open && !!req} onClose={close} bare size="md" aria-label="Upgrade your plan">
      {req && <UpgradeBody req={req} close={close} />}
    </Dialog>
  )
}

function UpgradeBody({ req, close }: { req: UpgradeRequest; close: () => void }) {
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  usePlans((s) => s.plans) // re-render when the live catalog arrives
  const me = useAuth((s) => s.me)
  const busy = useCheckout((s) => s.busy)
  const tier: Tier = req.requiredPlan === 'free' ? 'plus' : req.requiredPlan
  const plan = getPlanTier(tier)
  const meta = TIER_META[tier]
  const countdown = useCountdown(req.code === 'daily_limit' ? req.resetAt : undefined)
  const onPaid = !!me && me.plan !== 'free'
  const values = [...TIER_VALUE[tier]]
  if (req.code === 'file_too_large') values[0] = `Files up to ${formatMb(plan.limits.max_file_mb)}`
  if (req.code === 'daily_limit') values[0] = plan.limits.daily_tasks == null ? 'Unlimited daily tasks' : `${plan.limits.daily_tasks} tasks a day`

  return (
    <div style={tierStyle(tier)}>
      {/* Tier-colored header */}
      <div className={clsx('relative overflow-hidden bg-linear-to-br px-6 pt-6 pb-7', meta.fill, meta.fgOnFill)}>
        <div className="pointer-events-none absolute -top-20 -right-16 size-64 rounded-full bg-white/15 blur-2xl" aria-hidden="true" />
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-30 [--grid-line:rgb(255_255_255/0.25)] [mask-image:linear-gradient(to_left,black,transparent)]" aria-hidden="true" />
        <button type="button" onClick={close} className="absolute top-3 right-3 rounded-md p-1.5 opacity-80 transition hover:bg-white/15 hover:opacity-100" aria-label="Close">
          <X size={16} />
        </button>
        <motion.span initial={reduce ? false : { scale: 0.6, rotate: -12, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={spring} className="relative grid size-12 place-items-center rounded-2xl bg-white/20 shadow-[inset_0_1px_0_rgb(255_255_255/0.35)] ring-1 ring-white/30 backdrop-blur">
          <TierIcon tier={tier} size={24} />
        </motion.span>
        <div className="relative mt-4 text-eyebrow opacity-85">Folio {plan.name}</div>
        <h2 className="text-title relative mt-1 text-xl sm:text-2xl">{titleFor(req, plan.name)}</h2>
        {req.reason && <p className="relative mt-2 text-sm leading-relaxed opacity-90">{req.reason}</p>}
      </div>

      <div className="space-y-5 px-6 py-5">
        {req.code === 'daily_limit' && (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm">
            <Clock size={18} className={meta.text} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {req.used != null && req.limit != null ? (
                  <span className="tabular">
                    {req.used} of {req.limit} tasks used today
                  </span>
                ) : (
                  'Daily limit reached'
                )}
              </div>
              {countdown && (
                <div className="text-muted">
                  Resets in <span className="font-medium text-fg tabular">{countdown}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <motion.ul variants={reduce ? undefined : staggerContainer(0.06, 0.1)} initial="initial" animate="animate" className="space-y-2.5">
          {values.map((v) => (
            <motion.li key={v} variants={reduce ? undefined : staggerItem} className="flex items-start gap-3 text-sm">
              <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-[var(--accent)]">
                <Check size={12} strokeWidth={3} aria-hidden="true" />
              </span>
              <span>{v}</span>
            </motion.li>
          ))}
        </motion.ul>

        <div className="flex flex-col gap-2 pt-1 sm:flex-row-reverse">
          <Button
            size="lg"
            variant="accent"
            className={clsx('flex-1', meta.fill, meta.fgOnFill)}
            loading={busy?.plan === tier}
            rightIcon={<ArrowRight />}
            onClick={() => {
              close()
              void startCheckout(tier, 'monthly')
            }}
          >
            {onPaid ? `Upgrade to ${plan.name}` : `Start ${plan.trial_days || 7}-day free trial`}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => {
              close()
              navigate('/pricing')
            }}
          >
            Compare plans
          </Button>
        </div>
        <p className="text-center text-xs text-muted">
          {onPaid ? 'Prorated automatically. Cancel anytime.' : `Then ${formatPrice(plan.price_monthly)}/month. Cancel anytime before the trial ends and pay nothing.`}
        </p>
      </div>
    </div>
  )
}
