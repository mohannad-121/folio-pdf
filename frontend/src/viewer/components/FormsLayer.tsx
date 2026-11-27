/** Native inputs positioned over form widgets; changes become `form_value` ops. */
import { useMemo } from 'react'
import { pdfRectToCss, type PageGeom } from '../coords'
import { useViewer } from '../store'
import { useFormValues } from '../hooks/useFormValues'

export default function FormsLayer({ page, geom }: { page: number; geom: PageGeom }) {
  const fields = useViewer((s) => s.fields)
  const values = useFormValues()
  const selection = useViewer((s) => s.selection)
  const pageFields = useMemo(() => fields.filter((f) => f.page === page), [fields, page])
  const setFormValue = useViewer((s) => s.setFormValue)
  const select = useViewer((s) => s.select)

  return (
    <div className="absolute inset-0 z-[2]">
      {pageFields.map((f) => {
        const css = pdfRectToCss(geom, f.rect)
        const fontSize = Math.max(8, Math.min(css.height * 0.65, 14 * geom.scale))
        const style = { left: css.left, top: css.top, width: css.width, height: css.height, fontSize }
        const value = values[f.name]
        const common = {
          name: f.name,
          disabled: f.readonly,
          required: f.required,
          title: f.name,
          onFocus: () => select({ kind: 'field', name: f.name }),
          onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
          className: 'v-forms-input' + (selection?.kind === 'field' && selection.name === f.name ? ' ring-2 ring-brand-500' : ''),
          style,
        }
        const type = f.type.toLowerCase()
        if (type === 'checkbox') {
          return <input key={f.name} type="checkbox" {...common} checked={!!value && value !== 'Off'} onChange={(e) => setFormValue(f.name, e.target.checked, page)} />
        }
        if (type === 'radio' || type === 'radiobutton') {
          return <input key={f.name} type="checkbox" {...common} checked={!!value && value !== 'Off'} onChange={(e) => setFormValue(f.name, e.target.checked, page)} style={{ ...style, borderRadius: '50%' }} />
        }
        if (type === 'combobox' || type === 'listbox' || type === 'choice') {
          return (
            <select key={f.name} {...common} multiple={type === 'listbox'} value={String(value ?? '')} onChange={(e) => setFormValue(f.name, e.target.value, page)}>
              {!f.required && <option value="" />}
              {(f.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )
        }
        if (type === 'signature') {
          return (
            <button key={f.name} type="button" {...common} className={common.className + ' text-[10px] text-neutral-500'} onClick={() => useViewer.getState().setDialog('signature')}>
              Signature field
            </button>
          )
        }
        if (type === 'button' || type === 'pushbutton') return null
        if (f.multiline) {
          return <textarea key={f.name} {...common} value={String(value ?? '')} maxLength={f.max_len ?? undefined} onChange={(e) => setFormValue(f.name, e.target.value, page)} style={{ ...style, resize: 'none', lineHeight: 1.2 }} />
        }
        return <input key={f.name} type="text" {...common} value={String(value ?? '')} maxLength={f.max_len ?? undefined} onChange={(e) => setFormValue(f.name, e.target.value, page)} />
      })}
    </div>
  )
}
