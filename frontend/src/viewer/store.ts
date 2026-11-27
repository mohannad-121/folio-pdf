import { create } from 'zustand'
import type { PdfInfo } from '../lib/api'
import type { PDFDocumentProxy } from './pdfjs'
import { newId } from './ops'
import type {
  Align,
  Annotation,
  EditOp,
  FieldType,
  FontName,
  FormField,
  LayoutMode,
  MarkupType,
  Mode,
  NewFormField,
  PageImage,
  PageTextSpans,
  PdfLink,
  PendingOp,
  RectT,
  SavedSignature,
  SearchHit,
  Selection,
  ShapeType,
  SidebarTab,
  Toast,
  ViewRotation,
} from './types'

export interface StyleState {
  color: string
  fill: string | null
  strokeWidth: number
  opacity: number
  fontSize: number
  font: FontName
  align: Align
}

export interface ScrollRequest {
  page: number
  rect?: RectT
  nonce: number
}

export type SignPlacement = 'signature' | 'initials' | 'date'

/** Settings for the next stamp placed in stamp mode (remembered per browser). */
export interface StampSettings {
  text: string
  color: string
  /** Add today's date on the second line. */
  date: boolean
  /** Optional name on the second line ("by …"). */
  name: string
  /** Tilt in degrees, clockwise. */
  rotate: number
  opacity: number
}

export const STAMP_PRESETS: { text: string; color: string }[] = [
  { text: 'APPROVED', color: '#16a34a' },
  { text: 'REJECTED', color: '#dc2626' },
  { text: 'PAID', color: '#2563eb' },
  { text: 'RECEIVED', color: '#7c3aed' },
  { text: 'REVIEWED', color: '#0891b2' },
  { text: 'CONFIDENTIAL', color: '#dc2626' },
  { text: 'DRAFT', color: '#525252' },
  { text: 'FINAL', color: '#16a34a' },
  { text: 'VOID', color: '#dc2626' },
  { text: 'COPY', color: '#525252' },
]

const STAMP_KEY = 'folio.viewer.stamp'
const DEFAULT_STAMP: StampSettings = { text: 'APPROVED', color: '#16a34a', date: true, name: '', rotate: -6, opacity: 0.9 }

function loadStamp(): StampSettings {
  try {
    const raw = localStorage.getItem(STAMP_KEY)
    return raw ? { ...DEFAULT_STAMP, ...(JSON.parse(raw) as Partial<StampSettings>) } : DEFAULT_STAMP
  } catch {
    return DEFAULT_STAMP
  }
}

/** Second line of a stamp for the given settings, e.g. "27 NOV 2026 · Mohannad". */
export function stampSubtext(st: Pick<StampSettings, 'date' | 'name'>, now = new Date()): string | undefined {
  const parts: string[] = []
  if (st.date) parts.push(now.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase())
  if (st.name.trim()) parts.push(st.name.trim())
  return parts.length ? parts.join(' · ') : undefined
}
export type DialogKind = 'signature' | 'info' | 'readaloud' | 'redact-search' | 'password' | null

interface DocState {
  fileId: string | null
  info: PdfInfo | null
  doc: PDFDocumentProxy | null
  password: string | undefined
  loading: boolean
  loadError: string | null
}

export interface ViewerState extends DocState {
  // view
  zoom: number
  fitMode: 'width' | 'page' | null
  viewRotation: ViewRotation
  layout: LayoutMode
  currentPage: number
  scrollRequest: ScrollRequest | null
  sidebarOpen: boolean
  sidebarTab: SidebarTab
  propsOpen: boolean
  dialog: DialogKind

  // tools
  mode: Mode
  markupType: MarkupType
  shapeType: ShapeType
  style: StyleState
  textBaked: boolean
  signPlacement: SignPlacement
  activeSignature: SavedSignature | null
  stamp: StampSettings
  fieldTool: FieldType | null
  pendingImage: { fileId: string; aspect: number } | null
  flattenOnSave: boolean

  // edits
  ops: PendingOp[]
  past: PendingOp[][]
  future: PendingOp[][]
  newFields: NewFormField[]
  selection: Selection
  editingOpId: string | null

  // document data caches
  annotations: Annotation[]
  links: PdfLink[]
  fields: FormField[]
  textSpans: Record<number, PageTextSpans | undefined>
  images: Record<number, PageImage[] | undefined>

  // search
  search: { query: string; matchCase: boolean; hits: SearchHit[]; index: number; running: boolean }
  redactMatches: { page: number; rect: RectT }[]

  toasts: Toast[]

  // actions
  setLoading: (loading: boolean, error?: string | null) => void
  openDocument: (p: { fileId: string; info: PdfInfo; doc: PDFDocumentProxy; password?: string }) => void
  closeDocument: () => void
  setZoom: (zoom: number, fitMode?: 'width' | 'page' | null) => void
  setFitMode: (m: 'width' | 'page' | null) => void
  setViewRotation: (r: ViewRotation) => void
  setLayout: (l: LayoutMode) => void
  setCurrentPage: (p: number) => void
  scrollToPage: (page: number, rect?: RectT) => void
  setSidebar: (open: boolean, tab?: SidebarTab) => void
  setPropsOpen: (open: boolean) => void
  setDialog: (d: DialogKind) => void

  setMode: (m: Mode) => void
  setMarkupType: (t: MarkupType) => void
  setShapeType: (t: ShapeType) => void
  setStyle: (patch: Partial<StyleState>) => void
  setTextBaked: (b: boolean) => void
  setSignPlacement: (p: SignPlacement) => void
  setActiveSignature: (s: SavedSignature | null) => void
  setStamp: (patch: Partial<StampSettings>) => void
  setFieldTool: (t: FieldType | null) => void
  setPendingImage: (img: { fileId: string; aspect: number } | null) => void
  setFlattenOnSave: (b: boolean) => void

  addOp: (op: EditOp, select?: boolean) => string
  updateOp: (id: string, patch: Partial<EditOp> | ((op: EditOp) => EditOp)) => void
  removeOp: (id: string) => void
  commitOps: (next: PendingOp[]) => void
  undo: () => void
  redo: () => void
  clearEdits: () => void
  setFormValue: (name: string, value: string | boolean, page: number) => void
  upsertAnnotUpdate: (xref: number, page: number, patch: { contents?: string; color?: string; opacity?: number }) => void
  addField: (f: NewFormField) => void
  removeField: (index: number) => void
  select: (s: Selection) => void
  setEditingOpId: (id: string | null) => void

  setAnnotations: (a: Annotation[]) => void
  setLinks: (l: PdfLink[]) => void
  setFields: (f: FormField[]) => void
  setTextSpans: (page: number, data: PageTextSpans) => void
  setImages: (page: number, data: PageImage[]) => void

  setSearch: (patch: Partial<ViewerState['search']>) => void
  setRedactMatches: (m: { page: number; rect: RectT }[]) => void

  notify: (kind: Toast['kind'], text: string) => void
  dismissToast: (id: number) => void
}

const DEFAULT_STYLE: StyleState = {
  color: '#ffd400',
  fill: null,
  strokeWidth: 2,
  opacity: 1,
  fontSize: 12,
  font: 'helv',
  align: 'left',
}

let toastSeq = 1

const docDefaults = (): DocState & Pick<ViewerState, 'ops' | 'past' | 'future' | 'newFields' | 'selection' | 'editingOpId' | 'annotations' | 'links' | 'fields' | 'textSpans' | 'images' | 'search' | 'redactMatches' | 'pendingImage' | 'currentPage'> => ({
  fileId: null,
  info: null,
  doc: null,
  password: undefined,
  loading: false,
  loadError: null,
  ops: [],
  past: [],
  future: [],
  newFields: [],
  selection: null,
  editingOpId: null,
  annotations: [],
  links: [],
  fields: [],
  textSpans: {},
  images: {},
  search: { query: '', matchCase: false, hits: [], index: -1, running: false },
  redactMatches: [],
  pendingImage: null,
  currentPage: 1,
})

export const useViewer = create<ViewerState>()((set, get) => ({
  ...docDefaults(),
  zoom: 1,
  fitMode: 'width',
  viewRotation: 0,
  layout: 'continuous',
  scrollRequest: null,
  sidebarOpen: true,
  sidebarTab: 'thumbnails',
  propsOpen: true,
  dialog: null,

  mode: 'select',
  markupType: 'highlight',
  shapeType: 'rect',
  style: DEFAULT_STYLE,
  textBaked: false,
  signPlacement: 'signature',
  activeSignature: null,
  stamp: loadStamp(),
  fieldTool: null,
  flattenOnSave: false,
  toasts: [],

  setLoading: (loading, error = null) => set({ loading, loadError: error }),
  openDocument: ({ fileId, info, doc, password }) => {
    const prev = get().doc
    if (prev && prev !== doc) void prev.loadingTask.destroy().catch(() => undefined)
    set({ ...docDefaults(), fileId, info, doc, password, loading: false })
  },
  closeDocument: () => {
    const prev = get().doc
    if (prev) void prev.loadingTask.destroy().catch(() => undefined)
    set({ ...docDefaults() })
  },

  setZoom: (zoom, fitMode = null) => set({ zoom: Math.min(8, Math.max(0.1, zoom)), fitMode }),
  setFitMode: (fitMode) => set({ fitMode }),
  setViewRotation: (viewRotation) => set({ viewRotation }),
  setLayout: (layout) => set({ layout }),
  setCurrentPage: (currentPage) => {
    if (get().currentPage !== currentPage) set({ currentPage })
  },
  scrollToPage: (page, rect) => set({ scrollRequest: { page, rect, nonce: Date.now() + Math.random() }, currentPage: page }),
  setSidebar: (sidebarOpen, tab) => set((s) => ({ sidebarOpen, sidebarTab: tab ?? s.sidebarTab })),
  setPropsOpen: (propsOpen) => set({ propsOpen }),
  setDialog: (dialog) => set({ dialog }),

  setMode: (mode) => {
    const patch: Partial<ViewerState> = { mode, selection: null, editingOpId: null }
    if (mode !== 'forms') patch.fieldTool = null
    if (mode === 'markup') patch.style = { ...get().style, color: markupDefaultColor(get().markupType, get().style.color) }
    set(patch)
  },
  setMarkupType: (markupType) => set((s) => ({ markupType, style: { ...s.style, color: markupDefaultColor(markupType, s.style.color) } })),
  setShapeType: (shapeType) => set({ shapeType }),
  setStyle: (patch) => set((s) => ({ style: { ...s.style, ...patch } })),
  setTextBaked: (textBaked) => set({ textBaked }),
  setSignPlacement: (signPlacement) => set({ signPlacement }),
  setActiveSignature: (activeSignature) => set({ activeSignature }),
  setStamp: (patch) => {
    const stamp = { ...get().stamp, ...patch }
    set({ stamp })
    try {
      localStorage.setItem(STAMP_KEY, JSON.stringify(stamp))
    } catch {
      // storage unavailable (private window etc.): settings just aren't remembered
    }
  },
  setFieldTool: (fieldTool) => set({ fieldTool }),
  setPendingImage: (pendingImage) => set({ pendingImage }),
  setFlattenOnSave: (flattenOnSave) => set({ flattenOnSave }),

  commitOps: (next) => set((s) => ({ ops: next, past: [...s.past.slice(-99), s.ops], future: [] })),
  addOp: (op, select = true) => {
    const id = newId()
    get().commitOps([...get().ops, { id, op }])
    if (select) set({ selection: { kind: 'op', id } })
    return id
  },
  updateOp: (id, patch) => {
    const ops = get().ops
    const i = ops.findIndex((p) => p.id === id)
    if (i < 0) return
    const cur = ops[i].op
    const nextOp = typeof patch === 'function' ? patch(cur) : ({ ...cur, ...patch } as EditOp)
    const next = ops.slice()
    next[i] = { id, op: nextOp }
    get().commitOps(next)
  },
  removeOp: (id) => {
    const s = get()
    s.commitOps(s.ops.filter((p) => p.id !== id))
    if (s.selection?.kind === 'op' && s.selection.id === id) set({ selection: null })
    if (s.editingOpId === id) set({ editingOpId: null })
  },
  undo: () =>
    set((s) => {
      if (!s.past.length) return {}
      const prev = s.past[s.past.length - 1]
      return { ops: prev, past: s.past.slice(0, -1), future: [s.ops, ...s.future], selection: null, editingOpId: null }
    }),
  redo: () =>
    set((s) => {
      if (!s.future.length) return {}
      const [next, ...rest] = s.future
      return { ops: next, past: [...s.past, s.ops], future: rest, selection: null, editingOpId: null }
    }),
  clearEdits: () => set({ ops: [], past: [], future: [], newFields: [], selection: null, editingOpId: null }),
  setFormValue: (name, value, page) => {
    const s = get()
    const existing = s.ops.find((p) => p.op.type === 'form_value' && p.op.field_name === name)
    const op: EditOp = { type: 'form_value', page, field_name: name, value }
    if (existing) s.commitOps(s.ops.map((p) => (p.id === existing.id ? { id: p.id, op } : p)))
    else s.commitOps([...s.ops, { id: newId(), op }])
  },
  upsertAnnotUpdate: (xref, page, patch) => {
    const s = get()
    const existing = s.ops.find((p) => p.op.type === 'update_annot' && p.op.xref === xref)
    if (existing && existing.op.type === 'update_annot') {
      const op: EditOp = { ...existing.op, ...patch }
      s.commitOps(s.ops.map((p) => (p.id === existing.id ? { id: p.id, op } : p)))
    } else {
      s.commitOps([...s.ops, { id: newId(), op: { type: 'update_annot', page, xref, ...patch } }])
    }
  },
  addField: (f) => set((s) => ({ newFields: [...s.newFields, f] })),
  removeField: (index) => set((s) => ({ newFields: s.newFields.filter((_, i) => i !== index) })),
  select: (selection) => set({ selection, propsOpen: selection ? true : get().propsOpen }),
  setEditingOpId: (editingOpId) => set({ editingOpId }),

  setAnnotations: (annotations) => set({ annotations }),
  setLinks: (links) => set({ links }),
  setFields: (fields) => set({ fields }),
  setTextSpans: (page, data) => set((s) => ({ textSpans: { ...s.textSpans, [page]: data } })),
  setImages: (page, data) => set((s) => ({ images: { ...s.images, [page]: data } })),

  setSearch: (patch) => set((s) => ({ search: { ...s.search, ...patch } })),
  setRedactMatches: (redactMatches) => set({ redactMatches }),

  notify: (kind, text) => {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 4000)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

function markupDefaultColor(t: MarkupType, current: string): string {
  if (t === 'highlight' && current === '#ff0000') return '#ffd400'
  if (t !== 'highlight' && current === '#ffd400') return '#ff0000'
  return current
}

/** Number of unsaved changes. */
export function useDirtyCount(): number {
  return useViewer((s) => s.ops.length + s.newFields.length)
}

export const MARKUP_COLORS = ['#ffd400', '#7cff4a', '#4ad9ff', '#ff7ad9', '#ff9b3d', '#ff0000', '#1f3df5', '#000000']
export const INK_COLORS = ['#000000', '#1f3df5', '#e11d48', '#16a34a', '#f59e0b', '#7c3aed', '#ffffff']
