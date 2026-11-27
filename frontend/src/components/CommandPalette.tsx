import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, CornerDownLeft, Search } from 'lucide-react'
import clsx from 'clsx'
import { create } from 'zustand'
import { CATEGORY_LABELS, CATEGORY_ORDER, TOOLS, TOOLS_BY_ID, toolsInCategory, type ToolDef } from '../lib/tools'
import { categoryAccent } from '../lib/theme'
import { searchTools } from '../lib/search'
import ToolIcon from './ToolIcon'
import { Dialog, Kbd } from './ui'
import { useRecentTools } from './recentTools'
import TierBadge from './TierBadge'
import { useTier } from '../lib/auth'
import { tierRank, toolTier, usePlans } from '../lib/plans'

interface PaletteState {
  open: boolean
  setOpen: (v: boolean) => void
  toggle: () => void
}

export const useCommandPalette = create<PaletteState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}))

interface Group {
  label: string
  tools: ToolDef[]
}

/** ⌘K / Ctrl+K command palette over the tool catalog with recent tools. */
export default function CommandPalette() {
  const open = useCommandPalette((s) => s.open)
  const setOpen = useCommandPalette((s) => s.setOpen)
  return (
    <Dialog open={open} onClose={() => setOpen(false)} bare align="top" size="lg" aria-label="Search tools" className="max-h-[70vh] flex flex-col">
      {/* Body is unmounted with the dialog, so query/selection reset on close. */}
      <PaletteBody close={() => setOpen(false)} />
    </Dialog>
  )
}

function PaletteBody({ close }: { close: () => void }) {
  const recentIds = useRecentTools((s) => s.ids)
  const navigate = useNavigate()
  const tier = useTier()
  const plans = usePlans((s) => s.plans)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const groups = useMemo<Group[]>(() => {
    if (q.trim()) {
      const res = searchTools(q)
      return res.length ? [{ label: `${res.length} result${res.length === 1 ? '' : 's'}`, tools: res }] : []
    }
    const out: Group[] = []
    const recent = recentIds.map((id) => TOOLS_BY_ID[id]).filter((t): t is ToolDef => !!t)
    if (recent.length) out.push({ label: 'Recent', tools: recent })
    out.push({ label: 'Popular', tools: TOOLS.filter((t) => t.featured) })
    for (const c of CATEGORY_ORDER) out.push({ label: CATEGORY_LABELS[c], tools: toolsInCategory(c) })
    return out
  }, [q, recentIds])

  const flat = useMemo(() => groups.flatMap((g) => g.tools), [groups])
  const clampedActive = Math.min(active, Math.max(0, flat.length - 1))

  // Keep the active row in view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${clampedActive}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [clampedActive, groups])

  const go = (t: ToolDef) => {
    close()
    navigate(`/tools/${t.id}`)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (flat.length ? (a + 1) % flat.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const t = flat[clampedActive]
      if (t) go(t)
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setActive(e.key === 'Home' ? 0 : flat.length - 1)
    }
  }

  let runningIndex = -1

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search size={18} className="shrink-0 text-muted-2" aria-hidden="true" />
        <input
          data-autofocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKey}
          placeholder="Search 50+ tools… try “word”, “compress”, “sign”"
          className="h-14 w-full bg-transparent text-base outline-none placeholder:text-muted-2"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={flat[clampedActive] ? `palette-${flat[clampedActive].id}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
        />
        <Kbd className="hidden sm:inline-flex">Esc</Kbd>
      </div>

      <div ref={listRef} id="palette-list" role="listbox" aria-label="Tools" className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.length === 0 ? (
          <div className="px-3 py-10 text-center text-sm text-muted">
            No tools match <span className="font-medium text-fg">“{q}”</span>.
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label} role="group" aria-label={g.label} className="mb-1">
              <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-2 uppercase">
                {g.label === 'Recent' && <Clock size={11} aria-hidden="true" />}
                {g.label}
              </div>
              {g.tools.map((t) => {
                runningIndex += 1
                const i = runningIndex
                const acc = categoryAccent(t.category)
                const isActive = i === clampedActive
                return (
                  <div
                    key={`${g.label}-${t.id}`}
                    id={isActive ? `palette-${t.id}` : undefined}
                    role="option"
                    aria-selected={isActive}
                    data-index={i}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(t)}
                    style={acc.style}
                    className={clsx('group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors', isActive ? 'bg-surface-2' : 'hover:bg-surface-2/60')}
                  >
                    <span className={clsx('grid size-8 shrink-0 place-items-center rounded-md', acc.tile)}>
                      <ToolIcon name={t.icon} size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{t.name}</span>
                        {tierRank(tier) < tierRank(toolTier(t.id, plans)) && <TierBadge tier={toolTier(t.id, plans)} locked size="xs" srLabel="plan required" />}
                      </span>
                      <span className="block truncate text-xs text-muted">{t.description}</span>
                    </span>
                    <span className={clsx('hidden shrink-0 text-[11px] font-medium sm:block', acc.text)}>{CATEGORY_LABELS[t.category]}</span>
                    <CornerDownLeft size={14} className={clsx('shrink-0 text-muted-2 transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-2">
        <span className="inline-flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navigate
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>↵</Kbd> open
        </span>
        <span className="ml-auto hidden sm:inline">{TOOLS.length} tools</span>
      </div>
    </>
  )
}
