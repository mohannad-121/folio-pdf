import { useMemo } from 'react'
import { useViewer } from '../store'

/** Current form values = document values overlaid with pending `form_value` ops. */
export function useFormValues(): Record<string, string | boolean> {
  const fields = useViewer((s) => s.fields)
  const ops = useViewer((s) => s.ops)
  return useMemo(() => {
    const v: Record<string, string | boolean> = {}
    for (const f of fields) v[f.name] = f.value ?? (f.type === 'checkbox' ? false : '')
    for (const p of ops) if (p.op.type === 'form_value') v[p.op.field_name] = p.op.value
    return v
  }, [fields, ops])
}
