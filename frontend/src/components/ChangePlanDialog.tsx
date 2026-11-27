import { useState } from 'react'
import { ArrowRight, ExternalLink } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '../lib/auth'
import { formatPrice, getPlanTier, tierRank, TIER_META, tierStyle } from '../lib/plans'
import { changePlan, openBillingPortal, useCheckout } from '../lib/paddle'
import { Button, Dialog, toast } from './ui'
import { TierIcon } from './TierBadge'

/** Existing subscriber picked another plan: explain proration and switch. */
export default function ChangePlanDialog() {
  const change = useCheckout((s) => s.change)
  const setChange = useCheckout((s) => s.setChange)
  const me = useAuth((s) => s.me)
  const [busy, setBusy] = useState(false)
  const close = () => !busy && setChange(null)
  const target = change ? getPlanTier(change.plan) : null
  const current = me ? getPlanTier(me.plan) : null
  const up = target && current ? tierRank(target.id) > tierRank(current.id) : true
  const trialing = me?.plan_status === 'trialing'
  const price = target && change ? (change.interval === 'yearly' ? `${formatPrice(target.price_yearly)}/year` : `${formatPrice(target.price_monthly)}/month`) : ''

  const confirm = async () => {
    if (!change) return
    setBusy(true)
    try {
      const m = await changePlan(change)
      toast.success(`You are now on ${getPlanTier(m.plan).name}`, up ? 'New features are unlocked right away.' : undefined)
      setChange(null)
    } catch (e) {
      toast.error('Could not change your plan', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!change} onClose={close} size="sm" title={target ? `Switch to ${target.name}?` : 'Change plan'} description={current ? `You are currently on ${current.name}${me?.plan_interval ? ` (${me.plan_interval})` : ''}.` : undefined}>
      {target && change && (
        <div className="space-y-4 p-5" style={tierStyle(target.id)}>
          <div className="card-wash flex items-center gap-3 rounded-xl border border-border p-3">
            <span className={clsx('grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br', TIER_META[target.id].fill, TIER_META[target.id].fgOnFill)}>
              <TierIcon tier={target.id} size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{target.name}</div>
              <div className="text-sm text-muted tabular">
                {price} · billed {change.interval}
              </div>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-muted">
            {trialing
              ? 'You are still in your free trial, so nothing is charged now. The new plan applies for the rest of your trial.'
              : up
                ? 'The change applies immediately. Paddle charges only the prorated difference for the rest of this billing period.'
                : 'The change applies immediately. The unused part of your current plan is credited to your next invoice.'}
          </p>
          <div className="flex flex-col gap-2">
            <Button variant="accent" size="lg" className={clsx(TIER_META[target.id].fill, TIER_META[target.id].fgOnFill)} loading={busy} onClick={confirm} rightIcon={<ArrowRight />}>
              Switch to {target.name}
            </Button>
            <Button variant="ghost" onClick={() => void openBillingPortal()} rightIcon={<ExternalLink />}>
              Manage in billing portal
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
