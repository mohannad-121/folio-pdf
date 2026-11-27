import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, Check, Eye, EyeOff, Lock, X } from 'lucide-react'
import clsx from 'clsx'
import type { OptionField, ToolDef } from '../lib/tools'
import { ApiError, formatBytes, uploadFiles, type FileOut } from '../lib/api'
import { fade } from '../lib/motion'
import UploadDropzone from '../components/UploadDropzone'
import ToolFileThumb from '../components/ToolFileThumb'
import { Badge, ProgressBar, Segmented, Switch } from '../components/ui'
import { parsePageSpec } from './pages'
import { isVisible } from './visibility'
import type { OptionValues } from './types'
import { useTier } from '../lib/auth'
import { optionTier, TIER_META, tierCovers, type Tier, tierStyle } from '../lib/plans'
import { startCheckout } from '../lib/paddle'
import { handleGatingError } from '../lib/upgrade'


interface Props {
  tool: ToolDef
  values: OptionValues
  onChange: (key: string, value: OptionValues[string]) => void
  /** Page count of the first input PDF (for validating `pages` fields). */
  pageCount: number | null
  /** Called when a field's validity changes (used to disable the run button). */
  onValidity: (key: string, ok: boolean) => void
  /** Called when an option-level upload has produced a file (for the recent list). */
  onExtraUpload?: (f: FileOut) => void
}

/** Generic renderer for `tool.options`: inputs in a grid, toggles grouped below. */
export default function OptionsForm({ tool, values, onChange, pageCount, onValidity, onExtraUpload }: Props) {
  const reduce = useReducedMotion()
  const fields = tool.options ?? []
  const visible = fields.filter((f) => isVisible(tool.id, f.key, values))
  if (!visible.length) return null
  const inputs = visible.filter((f) => f.type !== 'checkbox')
  const toggles = visible.filter((f) => f.type === 'checkbox')

  const render = (field: OptionField) => (
    <motion.div key={field.key} layout={!reduce} variants={reduce ? undefined : fade} initial="initial" animate="animate" exit="exit" className={clsx('min-w-0', (field.type === 'textarea' || field.type === 'pages') && 'sm:col-span-2')}>
      <FieldRenderer toolId={tool.id} field={field} value={values[field.key]} onChange={(v) => onChange(field.key, v)} pageCount={pageCount} onValidity={(ok) => onValidity(field.key, ok)} onExtraUpload={onExtraUpload} />
    </motion.div>
  )

  return (
    <div className="space-y-5">
      {inputs.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2">
          <AnimatePresence initial={false} mode="popLayout">
            {inputs.map(render)}
          </AnimatePresence>
        </div>
      )}
      {toggles.length > 0 && (
        <div className={clsx('grid gap-3 rounded-xl bg-surface-2/60 p-4 ring-1 ring-inset ring-border', toggles.length > 2 && 'sm:grid-cols-2')}>
          <AnimatePresence initial={false} mode="popLayout">
            {toggles.map(render)}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

interface FieldProps {
  toolId: string
  field: OptionField
  value: OptionValues[string]
  onChange: (v: OptionValues[string]) => void
  pageCount: number | null
  onValidity: (ok: boolean) => void
  onExtraUpload?: (f: FileOut) => void
}

function FieldRenderer(props: FieldProps) {
  const { field } = props
  switch (field.type) {
    case 'text':
      return <TextField {...props} />
    case 'textarea':
      return <TextareaField {...props} />
    case 'number':
      return <NumberField {...props} />
    case 'select':
      return <SelectField {...props} />
    case 'checkbox':
      return <CheckboxField {...props} />
    case 'pages':
      return <PagesField {...props} />
    case 'color':
      return <ColorField {...props} />
    case 'password':
      return <PasswordField {...props} />
    case 'file':
      return <FileField {...props} />
  }
}

function Field({ id, label, help, children, error, labelAs = 'label' }: { id: string; label: string; help?: string; children: ReactNode; error?: string; labelAs?: 'label' | 'div' }) {
  const LabelTag = labelAs
  return (
    <div>
      <LabelTag id={labelAs === 'div' ? `${id}-label` : undefined} htmlFor={labelAs === 'label' ? id : undefined} className="mb-1.5 block text-sm font-medium">
        {label}
      </LabelTag>
      {children}
      <AnimatePresence initial={false} mode="wait">
        {error ? (
          <motion.p key="err" initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
            {error}
          </motion.p>
        ) : help ? (
          <motion.p key="help" initial={false} animate={{ opacity: 1 }} className="mt-1.5 text-xs text-muted">
            {help}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function TextField({ field, value, onChange }: FieldProps) {
  const id = useId()
  if (field.type !== 'text') return null
  return (
    <Field id={id} label={field.label} help={field.help}>
      <input id={id} type="text" className="field" placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}

function TextareaField({ field, value, onChange }: FieldProps) {
  const id = useId()
  if (field.type !== 'textarea') return null
  return (
    <Field id={id} label={field.label} help={field.help}>
      <textarea id={id} rows={5} className="field font-mono text-xs leading-relaxed" placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}

function NumberField({ field, value, onChange }: FieldProps) {
  const id = useId()
  if (field.type !== 'number') return null
  const isUnit = field.max !== undefined && field.max <= 1 && (field.step ?? 1) < 1
  return (
    <Field id={id} label={field.label} help={field.help}>
      <div className="relative">
        <input
          id={id}
          type="number"
          className={clsx('field tabular', isUnit && 'pr-12')}
          min={field.min}
          max={field.max}
          step={field.step ?? 'any'}
          defaultValue={typeof value === 'number' ? value : ''}
          onChange={(e) => {
            if (e.target.value === '') onChange(undefined)
            else if (Number.isFinite(e.target.valueAsNumber)) onChange(e.target.valueAsNumber)
          }}
        />
        {isUnit && typeof value === 'number' && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-2 tabular">{Math.round(value * 100)}%</span>}
      </div>
    </Field>
  )
}

/** Inline upsell under an option whose chosen value needs a higher tier. */
function OptionUpsell({ tier, label }: { tier: Tier; label: string }) {
  const meta = TIER_META[tier]
  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} style={tierStyle(tier)} className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-[color-mix(in_oklab,var(--accent)_9%,var(--color-surface))] px-3 py-2 text-xs ring-1 ring-inset ring-[color-mix(in_oklab,var(--accent)_28%,transparent)]" role="status">
      <Lock size={12} className={meta.text} aria-hidden="true" />
      <span className="flex-1">
        <span className="font-semibold">{label}</span> is part of {meta.name}.
      </span>
      <button type="button" onClick={() => void startCheckout(tier, 'monthly')} className={clsx('inline-flex items-center gap-1 font-semibold hover:underline', meta.text)}>
        Start 7-day free trial <ArrowRight size={12} aria-hidden="true" />
      </button>
    </motion.div>
  )
}

function SelectField({ toolId, field, value, onChange }: FieldProps) {
  const id = useId()
  const tier = useTier()
  if (field.type !== 'select') return null
  const current = typeof value === 'string' ? value : field.default ?? field.options[0]?.value
  const compact = field.options.length <= 4 && field.options.every((o) => String(o.label).length <= 22)
  const lockOf = (v: string): Tier | null => {
    const need = optionTier(toolId, field.key, v)
    return need && !tierCovers(tier, need) ? need : null
  }
  const currentLock = lockOf(current)
  const currentLabel = field.options.find((o) => o.value === current)?.label ?? current
  const upsell = currentLock ? <OptionUpsell tier={currentLock} label={`${String(currentLabel).replace(/\s*\(.*\)$/, '')} ${field.label.toLowerCase()}`} /> : null
  if (compact) {
    return (
      <Field id={id} label={field.label} help={field.help} labelAs="div">
        <Segmented
          aria-labelledby={`${id}-label`}
          value={current}
          onChange={onChange}
          options={field.options.map((o) => {
            const lock = lockOf(o.value)
            return {
              value: o.value,
              label: lock ? (
                <span className="inline-flex items-center gap-1">
                  {o.label}
                  <Lock size={11} className={TIER_META[lock].text} aria-label={`requires ${TIER_META[lock].name}`} />
                </span>
              ) : (
                o.label
              ),
            }
          })}
          block
        />
        {upsell}
      </Field>
    )
  }
  return (
    <Field id={id} label={field.label} help={field.help}>
      <div className="relative">
        <select id={id} className="field appearance-none pr-9" value={current} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((o) => {
            const lock = lockOf(o.value)
            return (
              <option key={o.value} value={o.value}>
                {o.label}
                {lock ? ` (${TIER_META[lock].name})` : ''}
              </option>
            )
          })}
        </select>
        <svg className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
      {upsell}
    </Field>
  )
}

function CheckboxField({ field, value, onChange }: FieldProps) {
  if (field.type !== 'checkbox') return null
  return <Switch checked={value === true} onChange={onChange} label={field.label} description={field.help} size="sm" />
}

function PagesField({ field, value, onChange, pageCount, onValidity }: FieldProps) {
  const id = useId()
  const reduce = useReducedMotion()
  const text = typeof value === 'string' ? value : ''
  const parsed = useMemo(() => parsePageSpec(text, pageCount), [text, pageCount])
  const ok = !parsed.error
  useEffect(() => {
    onValidity(ok)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onValidity is a stable callback from the page
  }, [ok])
  if (field.type !== 'pages') return null
  const shown = parsed.ranges.slice(0, 12)
  const presets = ['all', 'odd', 'even', ...(pageCount && pageCount > 1 ? ['1', `last`] : [])]
  return (
    <Field id={id} label={field.label} help={field.help ?? 'e.g. 1-3, 5, 8-   (also: all, odd, even, last)'} error={parsed.error}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input id={id} type="text" className="field font-mono" value={text} placeholder="all" onChange={(e) => onChange(e.target.value)} aria-invalid={!!parsed.error} spellCheck={false} />
        <div className="flex shrink-0 gap-1" aria-label="Presets">
          {presets.map((p) => (
            <button key={p} type="button" onClick={() => onChange(p)} className={clsx('rounded-md px-2 py-1 text-xs font-medium transition', text.trim().toLowerCase() === p ? 'bg-[var(--accent,var(--color-brand-600))] text-white' : 'bg-surface-2 text-muted hover:bg-surface-3 hover:text-fg')}>
              {p}
            </button>
          ))}
        </div>
      </div>
      {!parsed.error && parsed.pages.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-live="polite">
          <AnimatePresence initial={false}>
            {shown.map(([a, b]) => (
              <motion.span key={`${a}-${b}`} layout={!reduce} initial={reduce ? false : { opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.15 }} className="rounded-md bg-[color-mix(in_oklab,var(--accent,var(--color-brand-500))_14%,transparent)] px-1.5 py-0.5 text-xs font-medium text-[var(--accent,var(--color-brand-700))] tabular">
                {a === b ? a : `${a}–${b}`}
              </motion.span>
            ))}
          </AnimatePresence>
          {parsed.ranges.length > shown.length && <span className="text-xs text-muted">+{parsed.ranges.length - shown.length} more</span>}
          <span className="text-xs text-muted tabular">
            {parsed.pages.length}
            {pageCount ? ` of ${pageCount}` : ''} page{parsed.pages.length === 1 ? '' : 's'}
          </span>
        </div>
      )}
    </Field>
  )
}

const SWATCHES = ['#ff0000', '#f97316', '#eab308', '#10b981', '#0ea5e9', '#4a63ff', '#8b5cf6', '#ec4899', '#000000', '#6b7280', '#ffffff', '#fff8e1']

function ColorField({ field, value, onChange }: FieldProps) {
  const id = useId()
  if (field.type !== 'color') return null
  const valid = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
  const hex = valid ? (value as string) : field.default ?? '#000000'
  return (
    <Field id={id} label={field.label}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative grid size-9 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-lg border border-border-strong shadow-[inset_0_0_0_2px_var(--color-surface)]" style={{ background: hex }} aria-label={`${field.label} picker`}>
          <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
        </label>
        <input id={id} type="text" className="field w-32 font-mono uppercase" value={typeof value === 'string' ? value : hex} onChange={(e) => onChange(e.target.value)} pattern="^#[0-9a-fA-F]{6}$" placeholder="#RRGGBB" spellCheck={false} aria-invalid={typeof value === 'string' && value !== '' && !valid} />
        <div className="flex flex-wrap gap-1" aria-label="Color presets">
          {SWATCHES.map((c) => {
            const active = hex.toLowerCase() === c
            return (
              <button key={c} type="button" onClick={() => onChange(c)} aria-label={c} aria-pressed={active} style={{ background: c }} className={clsx('grid size-6 place-items-center rounded-md border border-black/10 transition hover:scale-110 dark:border-white/15', active && 'ring-2 ring-[var(--accent,var(--color-brand-500))] ring-offset-1 ring-offset-surface')}>
                {active && <Check size={12} className={c === '#ffffff' || c === '#fff8e1' || c === '#eab308' ? 'text-black' : 'text-white'} />}
              </button>
            )
          })}
        </div>
      </div>
    </Field>
  )
}

function PasswordField({ field, value, onChange }: FieldProps) {
  const id = useId()
  const [show, setShow] = useState(false)
  if (field.type !== 'password') return null
  return (
    <Field id={id} label={field.label} help={field.help}>
      <div className="relative">
        <input id={id} type={show ? 'text' : 'password'} className="field pr-10" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
        <button type="button" onClick={() => setShow((s) => !s)} className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1.5 text-muted-2 transition hover:bg-surface-2 hover:text-fg" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </Field>
  )
}

function FileField({ field, value, onChange, onExtraUpload }: FieldProps) {
  const id = useId()
  const [meta, setMeta] = useState<FileOut | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (field.type !== 'file') return null

  const accept = field.accept
    ? Object.fromEntries(
        field.accept.split(',').map((a) => {
          const s = a.trim()
          return s.startsWith('.') ? ['application/octet-stream', [s]] : [s, []]
        }),
      )
    : undefined

  const upload = async (files: File[]) => {
    const f = files[0]
    if (!f) return
    setError(null)
    setProgress(0)
    try {
      const [out] = await uploadFiles([f], setProgress)
      setMeta(out)
      onChange(out.file_id)
      onExtraUpload?.(out)
    } catch (e) {
      setError(handleGatingError(e) ? 'This file needs a higher plan.' : e instanceof ApiError ? e.message : 'Upload failed')
    } finally {
      setProgress(null)
    }
  }

  const clear = () => {
    setMeta(null)
    onChange(undefined)
  }

  return (
    <Field id={id} label={field.label} help={field.help} error={error ?? undefined} labelAs="div">
      {typeof value === 'string' && value ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2 shadow-soft">
          <ToolFileThumb name={meta?.name ?? ''} contentType={meta?.content_type ?? ''} fileId={value} className="h-12 w-10" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="truncate font-medium">{meta?.name ?? value}</div>
            {meta && (
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                <span className="tabular">{formatBytes(meta.size)}</span>
                <Badge tone="success">Uploaded</Badge>
              </div>
            )}
          </div>
          <button type="button" onClick={clear} className="rounded-md p-1.5 text-muted-2 transition hover:bg-surface-2 hover:text-red-600" aria-label={`Remove ${field.label}`}>
            <X size={16} />
          </button>
        </div>
      ) : progress !== null ? (
        <div className="rounded-xl border border-border p-3 text-sm">
          <div className="mb-2 flex justify-between text-xs text-muted">
            <span>Uploading…</span>
            <span className="tabular">{Math.round(progress * 100)}%</span>
          </div>
          <ProgressBar value={progress} size="xs" label={`Uploading ${field.label}`} />
        </div>
      ) : (
        <UploadDropzone size="sm" multiple={false} accept={accept} onFiles={upload} title="Choose a file" hint={field.accept} label={field.label} className="py-4" />
      )}
    </Field>
  )
}
