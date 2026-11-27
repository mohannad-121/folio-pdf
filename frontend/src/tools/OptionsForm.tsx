import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Eye, EyeOff, X } from 'lucide-react'
import clsx from 'clsx'
import type { OptionField, ToolDef } from '../lib/tools'
import { ApiError, formatBytes, uploadFiles, type FileOut } from '../lib/api'
import UploadDropzone from '../components/UploadDropzone'
import ToolFileThumb from '../components/ToolFileThumb'
import { parsePageSpec } from './pages'
import { isVisible } from './visibility'
import type { OptionValues } from './types'

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

/** Generic renderer for `tool.options`. */
export default function OptionsForm({ tool, values, onChange, pageCount, onValidity, onExtraUpload }: Props) {
  const fields = tool.options ?? []
  const visible = fields.filter((f) => isVisible(tool.id, f.key, values))
  if (!visible.length) return null
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {visible.map((field) => (
        <FieldRenderer key={field.key} field={field} value={values[field.key]} onChange={(v) => onChange(field.key, v)} pageCount={pageCount} onValidity={(ok) => onValidity(field.key, ok)} onExtraUpload={onExtraUpload} />
      ))}
    </div>
  )
}

interface FieldProps {
  field: OptionField
  value: OptionValues[string]
  onChange: (v: OptionValues[string]) => void
  pageCount: number | null
  onValidity: (ok: boolean) => void
  onExtraUpload?: (f: FileOut) => void
}

const inputCls =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:ring-brand-900'

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

function Field({ id, label, help, children, wide, error }: { id: string; label: string; help?: string; children: ReactNode; wide?: boolean; error?: string }) {
  return (
    <div className={clsx(wide && 'sm:col-span-2')}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : (
        help && <p className="mt-1 text-xs text-neutral-500">{help}</p>
      )}
    </div>
  )
}

function TextField({ field, value, onChange }: FieldProps) {
  const id = useId()
  if (field.type !== 'text') return null
  return (
    <Field id={id} label={field.label} help={field.help}>
      <input id={id} type="text" className={inputCls} placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}

function TextareaField({ field, value, onChange }: FieldProps) {
  const id = useId()
  if (field.type !== 'textarea') return null
  return (
    <Field id={id} label={field.label} help={field.help} wide>
      <textarea id={id} rows={5} className={clsx(inputCls, 'font-mono text-xs')} placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}

function NumberField({ field, value, onChange }: FieldProps) {
  const id = useId()
  if (field.type !== 'number') return null
  return (
    <Field id={id} label={field.label} help={field.help}>
      <input
        id={id}
        type="number"
        className={inputCls}
        min={field.min}
        max={field.max}
        step={field.step ?? 'any'}
        defaultValue={typeof value === 'number' ? value : ''}
        onChange={(e) => {
          if (e.target.value === '') onChange(undefined)
          else if (Number.isFinite(e.target.valueAsNumber)) onChange(e.target.valueAsNumber)
        }}
      />
    </Field>
  )
}

function SelectField({ field, value, onChange }: FieldProps) {
  const id = useId()
  if (field.type !== 'select') return null
  return (
    <Field id={id} label={field.label} help={field.help}>
      <select id={id} className={inputCls} value={typeof value === 'string' ? value : field.default ?? field.options[0]?.value} onChange={(e) => onChange(e.target.value)}>
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

function CheckboxField({ field, value, onChange }: FieldProps) {
  const id = useId()
  if (field.type !== 'checkbox') return null
  const on = value === true
  return (
    <div className="flex items-start gap-3 py-1">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={clsx(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
          on ? 'bg-brand-600' : 'bg-neutral-300 dark:bg-neutral-700',
        )}
      >
        <span className={clsx('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', on && 'translate-x-5')} />
      </button>
      <label htmlFor={id} className="cursor-pointer select-none">
        <span className="block text-sm font-medium">{field.label}</span>
        {field.help && <span className="block text-xs text-neutral-500">{field.help}</span>}
      </label>
    </div>
  )
}

function PagesField({ field, value, onChange, pageCount, onValidity }: FieldProps) {
  const id = useId()
  const text = typeof value === 'string' ? value : ''
  const parsed = useMemo(() => parsePageSpec(text, pageCount), [text, pageCount])
  const ok = !parsed.error
  useEffect(() => {
    onValidity(ok)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onValidity is a stable callback from the page
  }, [ok])
  if (field.type !== 'pages') return null
  const shown = parsed.ranges.slice(0, 10)
  return (
    <Field id={id} label={field.label} help={field.help ?? 'e.g. 1-3, 5, 8-   (also: all, odd, even, last)'} error={parsed.error} wide>
      <input
        id={id}
        type="text"
        className={clsx(inputCls, parsed.error && 'border-red-400 focus:border-red-500 focus:ring-red-100')}
        value={text}
        placeholder="all"
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!parsed.error}
        spellCheck={false}
      />
      {!parsed.error && parsed.pages.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-live="polite">
          {shown.map(([a, b]) => (
            <span key={`${a}-${b}`} className="rounded-md bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700 tabular-nums dark:bg-brand-900/40 dark:text-brand-200">
              {a === b ? a : `${a}–${b}`}
            </span>
          ))}
          {parsed.ranges.length > shown.length && <span className="text-xs text-neutral-500">+{parsed.ranges.length - shown.length} more</span>}
          <span className="text-xs text-neutral-500">
            {parsed.pages.length}
            {pageCount ? ` of ${pageCount}` : ''} page{parsed.pages.length === 1 ? '' : 's'}
          </span>
        </div>
      )}
    </Field>
  )
}

function ColorField({ field, value, onChange }: FieldProps) {
  const id = useId()
  if (field.type !== 'color') return null
  const hex = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : field.default ?? '#000000'
  return (
    <Field id={id} label={field.label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${field.label} picker`}
          className="h-9 w-12 cursor-pointer rounded-lg border border-neutral-300 bg-white p-0.5 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <input
          id={id}
          type="text"
          className={clsx(inputCls, 'font-mono uppercase')}
          value={typeof value === 'string' ? value : hex}
          onChange={(e) => onChange(e.target.value)}
          pattern="^#[0-9a-fA-F]{6}$"
          placeholder="#RRGGBB"
          spellCheck={false}
        />
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
        <input id={id} type={show ? 'text' : 'password'} className={clsx(inputCls, 'pr-10')} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
        >
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
      setError(e instanceof ApiError ? e.message : 'Upload failed')
    } finally {
      setProgress(null)
    }
  }

  const clear = () => {
    setMeta(null)
    onChange(undefined)
  }

  return (
    <Field id={id} label={field.label} help={field.help} error={error ?? undefined}>
      {typeof value === 'string' && value ? (
        <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
          <ToolFileThumb name={meta?.name ?? ''} contentType={meta?.content_type ?? ''} fileId={value} className="h-12 w-10" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="truncate font-medium">{meta?.name ?? value}</div>
            {meta && <div className="text-xs text-neutral-500">{formatBytes(meta.size)}</div>}
          </div>
          <button type="button" onClick={clear} className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-red-600 dark:hover:bg-neutral-800" aria-label={`Remove ${field.label}`}>
            <X size={16} />
          </button>
        </div>
      ) : progress !== null ? (
        <div className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          Uploading… {Math.round(progress * 100)}%
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div className="h-full bg-brand-600" style={{ width: `${Math.max(3, progress * 100)}%` }} />
          </div>
        </div>
      ) : (
        <UploadDropzone size="sm" multiple={false} accept={accept} onFiles={upload} title="Choose a file" hint={field.accept} label={field.label} className="py-4" />
      )}
    </Field>
  )
}
