import type { ReactNode } from 'react'
import { CircleCheck, CircleExclamationPoint, CircleX, Info } from 'lucide-react'
import clsx from 'clsx'

type Json = string | number | boolean | null | undefined | Json[] | { [k: string]: Json }

interface Props {
  data: unknown
  /** Nesting depth (internal). */
  depth?: number
  /** Keys to skip at the top level (already rendered by a special-case view). */
  omit?: string[]
}

const MAX_DEPTH = 4

/** Renders arbitrary JSON (tool `data`) as key/value lists and tables, with status badges for check-like rows. */
export default function DataView({ data, depth = 0, omit }: Props) {
  if (data === null || data === undefined) return <Muted>—</Muted>
  if (depth > MAX_DEPTH) return <Pre value={data} />
  if (Array.isArray(data)) return <ArrayView items={data as Json[]} depth={depth} />
  if (typeof data === 'object') return <ObjectView obj={data as Record<string, Json>} depth={depth} omit={omit} />
  return <Primitive value={data as Json} />
}

function ObjectView({ obj, depth, omit }: { obj: Record<string, Json>; depth: number; omit?: string[] }) {
  const entries = Object.entries(obj).filter(([k]) => !omit?.includes(k))
  if (!entries.length) return <Muted>Nothing to show</Muted>
  const scalar = entries.filter(([, v]) => !isComplex(v))
  const complex = entries.filter(([, v]) => isComplex(v))
  return (
    <div className="space-y-4">
      {scalar.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[max-content_1fr]">
          {scalar.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-neutral-500">{humanize(k)}</dt>
              <dd className="min-w-0 wrap-break-word font-medium">{k === 'score' && typeof v === 'number' ? <Score value={v} /> : <Primitive value={v} />}</dd>
            </div>
          ))}
        </dl>
      )}
      {complex.map(([k, v]) => (
        <section key={k}>
          <h4 className={clsx('mb-1.5 font-semibold', depth === 0 ? 'text-sm' : 'text-xs text-neutral-600 dark:text-neutral-300')}>
            {humanize(k)}
            {Array.isArray(v) && <span className="ml-1.5 font-normal text-neutral-400">({v.length})</span>}
          </h4>
          <DataView data={v} depth={depth + 1} />
        </section>
      ))}
    </div>
  )
}

function ArrayView({ items, depth }: { items: Json[]; depth: number }) {
  if (!items.length) return <Muted>None</Muted>
  if (items.every((x) => !isComplex(x))) {
    return (
      <ul className="flex flex-wrap gap-1.5">
        {items.map((x, i) => (
          <li key={i} className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
            <Primitive value={x} />
          </li>
        ))}
      </ul>
    )
  }
  const objects = items.filter((x): x is Record<string, Json> => !!x && typeof x === 'object' && !Array.isArray(x))
  if (objects.length === items.length) {
    const cols = unionKeys(objects)
    if (cols.length <= 10) return <Table rows={objects} cols={cols} depth={depth} />
  }
  return (
    <ol className="space-y-2">
      {items.map((x, i) => (
        <li key={i} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <DataView data={x} depth={depth + 1} />
        </li>
      ))}
    </ol>
  )
}

function Table({ rows, cols, depth }: { rows: Record<string, Json>[]; cols: string[]; depth: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-50 text-xs text-neutral-500 uppercase dark:bg-neutral-800/60">
          <tr>
            {cols.map((c) => (
              <th key={c} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                {humanize(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {cols.map((c) => (
                <td key={c} className="px-3 py-2">
                  {c === 'status' || c === 'result' || c === 'level' || c === 'severity' ? (
                    <StatusBadge value={r[c]} />
                  ) : isComplex(r[c]) ? (
                    <DataView data={r[c]} depth={depth + 1} />
                  ) : (
                    <Primitive value={r[c]} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Primitive({ value }: { value: Json }) {
  if (value === null || value === undefined || value === '') return <Muted>—</Muted>
  if (typeof value === 'boolean') return <span className={value ? 'text-emerald-700 dark:text-emerald-400' : 'text-neutral-500'}>{value ? 'Yes' : 'No'}</span>
  if (typeof value === 'number') return <span className="tabular-nums">{Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 3 })}</span>
  if (typeof value === 'string') {
    const s = value
    if (/^https?:\/\//.test(s)) {
      return (
        <a href={s} target="_blank" rel="noreferrer" className="text-brand-600 underline underline-offset-2 dark:text-brand-300">
          {s}
        </a>
      )
    }
    return <span className="whitespace-pre-wrap">{s}</span>
  }
  return <Pre value={value} />
}

function StatusBadge({ value }: { value: Json }) {
  const s = String(value ?? '').toLowerCase()
  const kind = ['pass', 'passed', 'ok', 'valid', 'success', 'true'].includes(s)
    ? 'pass'
    : ['fail', 'failed', 'error', 'invalid', 'critical', 'false'].includes(s)
      ? 'fail'
      : ['warn', 'warning', 'partial', 'unknown', 'medium'].includes(s)
        ? 'warn'
        : 'info'
  const cls = {
    pass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    fail: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    warn: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    info: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  }[kind]
  const Icon = { pass: CircleCheck, fail: CircleX, warn: CircleExclamationPoint, info: Info }[kind]
  if (value === null || value === undefined) return <Muted>—</Muted>
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium', cls)}>
      <Icon size={12} /> {String(value)}
    </span>
  )
}

function Score({ value }: { value: number }) {
  const pct = value <= 1 ? Math.round(value * 100) : Math.round(value)
  const tone = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular-nums">{pct}/100</span>
      <span className="h-2 w-28 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800" aria-hidden="true">
        <span className={clsx('block h-full rounded-full', tone)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </span>
    </span>
  )
}

function Pre({ value }: { value: unknown }) {
  return <pre className="overflow-x-auto rounded-lg bg-neutral-100 p-3 text-xs dark:bg-neutral-800">{JSON.stringify(value, null, 2)}</pre>
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-neutral-400">{children}</span>
}

function isComplex(v: Json): boolean {
  return v !== null && typeof v === 'object'
}

function unionKeys(rows: Record<string, Json>[]): string[] {
  const keys: string[] = []
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k)
  return keys
}

function humanize(key: string): string {
  return key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase())
}
