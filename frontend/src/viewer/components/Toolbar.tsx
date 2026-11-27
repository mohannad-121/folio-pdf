import clsx from 'clsx'
import {
  ArrowUpRight,
  Circle,
  Download,
  Eraser,
  FileSignature,
  FormInput,
  Hand,
  Highlighter,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  Link2,
  Minus,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Pen,
  Printer,
  Redo2,
  Save,
  Scissors,
  Search,
  Square,
  Stamp,
  StickyNote,
  Strikethrough,
  TextCursorInput,
  Type,
  Underline,
  Undo2,
  Volume2,
  WrapText,
} from 'lucide-react'
import { useState } from 'react'
import { FONT_OPTIONS } from '../fonts'
import { INK_COLORS, MARKUP_COLORS, STAMP_PRESETS, stampSubtext, useDirtyCount, useViewer } from '../store'
import type { FieldType, FontName, MarkupType, Mode, ShapeType } from '../types'
import { ColorSwatches, Divider, IconButton, Toggle, inputCls } from './ui'

export interface ToolbarActions {
  save: () => void
  download: () => void
  print: () => void
  saving: boolean
}

export default function Toolbar({ actions }: { actions: ToolbarActions }) {
  const mode = useViewer((s) => s.mode)
  const setMode = useViewer((s) => s.setMode)
  const markupType = useViewer((s) => s.markupType)
  const shapeType = useViewer((s) => s.shapeType)
  const sidebarOpen = useViewer((s) => s.sidebarOpen)
  const propsOpen = useViewer((s) => s.propsOpen)
  const canUndo = useViewer((s) => s.past.length > 0)
  const canRedo = useViewer((s) => s.future.length > 0)
  const hasForms = useViewer((s) => s.info?.has_forms ?? false)
  const dirty = useDirtyCount()

  const m = (target: Mode, label: string, icon: React.ReactNode, shortcut?: string, extra?: () => void) => (
    <IconButton
      key={target + label}
      label={label}
      shortcut={shortcut}
      active={mode === target}
      onClick={() => {
        extra?.()
        setMode(target)
      }}
    >
      {icon}
    </IconButton>
  )

  return (
    <div className="flex flex-col border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex h-11 items-center gap-0.5 overflow-x-auto px-2 [scrollbar-width:none]">
        <IconButton label="Toggle sidebar" active={sidebarOpen} onClick={() => useViewer.getState().setSidebar(!sidebarOpen)}>
          <PanelLeft size={17} />
        </IconButton>
        <Divider />
        {m('select', 'Select', <MousePointer2 size={17} />, 'V')}
        {m('hand', 'Pan', <Hand size={17} />, 'H')}
        <Divider />
        <MarkupButton current={markupType} active={mode === 'markup'} />
        {m('draw', 'Draw', <Pen size={17} />, 'D')}
        {m('eraser', 'Eraser', <Eraser size={17} />)}
        <ShapeButton current={shapeType} active={mode === 'shape'} />
        {m('text', 'Add text', <Type size={17} />, 'T')}
        {m('edit-text', 'Edit existing text', <TextCursorInput size={17} />, 'E')}
        {m('note', 'Sticky note', <StickyNote size={17} />, 'N')}
        {m('image', 'Insert image', <ImageIcon size={17} />, 'I')}
        {m('link', 'Link', <Link2 size={17} />, 'L')}
        <Divider />
        {m('redact', 'Redact', <Scissors size={17} />, 'R')}
        {m('sign', 'Sign', <FileSignature size={17} />, 'S')}
        {m('stamp', 'Stamp', <Stamp size={17} />, 'P')}
        {m('forms', hasForms ? 'Fill & edit forms' : 'Add form fields', <FormInput size={17} />, 'F')}
        {m('organize', 'Organize pages', <LayoutGrid size={17} />, 'O')}
        <span className="flex-1" />
        <IconButton label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={() => useViewer.getState().undo()}>
          <Undo2 size={17} />
        </IconButton>
        <IconButton label="Redo" shortcut="Ctrl+Y" disabled={!canRedo} onClick={() => useViewer.getState().redo()}>
          <Redo2 size={17} />
        </IconButton>
        <Divider />
        <IconButton label="Search" shortcut="Ctrl+F" onClick={() => useViewer.getState().setSidebar(true, 'search')}>
          <Search size={17} />
        </IconButton>
        <IconButton label="Read aloud" active={useViewer((s) => s.dialog === 'readaloud')} onClick={() => useViewer.getState().setDialog(useViewer.getState().dialog === 'readaloud' ? null : 'readaloud')}>
          <Volume2 size={17} />
        </IconButton>
        <IconButton label="Document info" onClick={() => useViewer.getState().setDialog('info')}>
          <Info size={17} />
        </IconButton>
        <IconButton label="Print" shortcut="Ctrl+P" onClick={actions.print}>
          <Printer size={17} />
        </IconButton>
        <IconButton label="Download" onClick={actions.download}>
          <Download size={17} />
        </IconButton>
        <IconButton label="Properties panel" active={propsOpen} onClick={() => useViewer.getState().setPropsOpen(!propsOpen)}>
          <PanelRight size={17} />
        </IconButton>
        <button
          type="button"
          onClick={actions.save}
          disabled={actions.saving || dirty === 0}
          className={clsx('ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition', dirty > 0 ? 'bg-brand-600 text-white hover:bg-brand-700' : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500', actions.saving && 'opacity-60')}
          title="Save changes (Ctrl+S)"
        >
          <Save size={15} />
          {actions.saving ? 'Saving…' : dirty > 0 ? `Save (${dirty})` : 'Save'}
        </button>
      </div>
      <ModeOptions />
    </div>
  )
}

function MarkupButton({ current, active }: { current: MarkupType; active: boolean }) {
  const icons: Record<MarkupType, React.ReactNode> = {
    highlight: <Highlighter size={17} />,
    underline: <Underline size={17} />,
    strikeout: <Strikethrough size={17} />,
    squiggly: <WrapText size={17} />,
  }
  const labels: Record<MarkupType, string> = { highlight: 'Highlight', underline: 'Underline', strikeout: 'Strikeout', squiggly: 'Squiggly' }
  return (
    <div className="flex items-center">
      {(Object.keys(labels) as MarkupType[]).map((t) => (
        <IconButton
          key={t}
          label={labels[t]}
          shortcut={t === 'highlight' ? 'Shift+H' : undefined}
          active={active && current === t}
          onClick={() => {
            const s = useViewer.getState()
            s.setMarkupType(t)
            s.setMode('markup')
          }}
        >
          {icons[t]}
        </IconButton>
      ))}
    </div>
  )
}

function ShapeButton({ current, active }: { current: ShapeType; active: boolean }) {
  const defs: { t: ShapeType; label: string; icon: React.ReactNode }[] = [
    { t: 'rect', label: 'Rectangle', icon: <Square size={17} /> },
    { t: 'ellipse', label: 'Ellipse', icon: <Circle size={17} /> },
    { t: 'line', label: 'Line', icon: <Minus size={17} /> },
    { t: 'arrow', label: 'Arrow', icon: <ArrowUpRight size={17} /> },
  ]
  return (
    <div className="flex items-center">
      {defs.map((d) => (
        <IconButton
          key={d.t}
          label={d.label}
          active={active && current === d.t}
          onClick={() => {
            const s = useViewer.getState()
            s.setShapeType(d.t)
            s.setMode('shape')
          }}
        >
          {d.icon}
        </IconButton>
      ))}
    </div>
  )
}

/** Second row: contextual options for the current mode. */
function ModeOptions() {
  const mode = useViewer((s) => s.mode)
  const style = useViewer((s) => s.style)
  const setStyle = useViewer((s) => s.setStyle)
  const textBaked = useViewer((s) => s.textBaked)
  const signPlacement = useViewer((s) => s.signPlacement)
  const activeSignature = useViewer((s) => s.activeSignature)
  const fieldTool = useViewer((s) => s.fieldTool)
  const flatten = useViewer((s) => s.flattenOnSave)
  const hasForms = useViewer((s) => s.info?.has_forms ?? false)
  const pendingImage = useViewer((s) => s.pendingImage)
  const redactCount = useViewer((s) => s.ops.filter((p) => p.op.type === 'redact').length)

  const row = 'flex h-9 items-center gap-3 overflow-x-auto border-t border-neutral-100 px-3 text-xs text-neutral-600 dark:border-neutral-800/80 dark:text-neutral-300 [scrollbar-width:none]'
  const hint = (t: string) => <span className="truncate text-neutral-400">{t}</span>

  switch (mode) {
    case 'markup':
      return (
        <div className={row}>
          <span className="font-medium">Color</span>
          <ColorSwatches colors={MARKUP_COLORS} value={style.color} onChange={(c) => setStyle({ color: c })} />
          <OpacityControl />
          {hint('Select text on the page to apply the markup')}
        </div>
      )
    case 'draw':
    case 'shape':
      return (
        <div className={row}>
          <span className="font-medium">{mode === 'draw' ? 'Pen' : 'Stroke'}</span>
          <ColorSwatches colors={INK_COLORS} value={style.color} onChange={(c) => setStyle({ color: c })} />
          <label className="flex items-center gap-1">
            Width
            <input type="range" min={0.5} max={12} step={0.5} value={style.strokeWidth} onChange={(e) => setStyle({ strokeWidth: Number(e.target.value) })} className="w-24 accent-brand-600" />
            <span className="w-8 tabular-nums">{style.strokeWidth}pt</span>
          </label>
          {mode === 'shape' && (
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={style.fill != null} onChange={(e) => setStyle({ fill: e.target.checked ? '#ffd400' : null })} className="accent-brand-600" />
              Fill
              {style.fill != null && <input type="color" value={style.fill} onChange={(e) => setStyle({ fill: e.target.value })} className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0" />}
            </label>
          )}
          <OpacityControl />
          {hint(mode === 'draw' ? 'Draw freehand. Use the eraser to remove strokes.' : 'Drag on the page to draw a shape')}
        </div>
      )
    case 'eraser':
      return <div className={row}>{hint('Click or drag over your pending strokes to erase them')}</div>
    case 'text':
      return (
        <div className={row}>
          <FontControls />
          <Toggle checked={textBaked} onChange={(b) => useViewer.getState().setTextBaked(b)} label={textBaked ? 'Bake into page' : 'As annotation'} />
          {hint('Click on the page to place a text box')}
        </div>
      )
    case 'edit-text':
      return <div className={row}>{hint('Hover a line of text and click to retype it. Click an image to replace or delete it.')}</div>
    case 'note':
      return <div className={row}>{hint('Click on the page to add a sticky note')}</div>
    case 'image':
      return (
        <div className={row}>
          <button type="button" className="rounded-md border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 dark:border-neutral-600 dark:hover:bg-neutral-800" onClick={() => document.getElementById('v-image-input')?.click()}>
            {pendingImage ? 'Choose another image…' : 'Choose image…'}
          </button>
          {pendingImage ? hint('Click or drag on the page to place the image') : hint('Pick an image file (PNG/JPEG) to insert')}
        </div>
      )
    case 'link':
      return <div className={row}>{hint('Drag a rectangle to create a link; click an existing link to edit or remove it')}</div>
    case 'redact':
      return (
        <div className={row}>
          <button type="button" className="rounded-md border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 dark:border-neutral-600 dark:hover:bg-neutral-800" onClick={() => useViewer.getState().setDialog('redact-search')}>
            Search &amp; redact…
          </button>
          {redactCount > 0 && <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300">{redactCount} pending</span>}
          {hint('Drag rectangles over content to redact. Redaction is permanent once saved.')}
        </div>
      )
    case 'sign': {
      const seg = (v: typeof signPlacement, label: string) => (
        <button key={v} type="button" onClick={() => useViewer.getState().setSignPlacement(v)} className={clsx('rounded-md px-2 py-0.5', signPlacement === v ? 'bg-brand-100 font-medium text-brand-700 dark:bg-brand-900/50 dark:text-brand-200' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800')}>
          {label}
        </button>
      )
      return (
        <div className={row}>
          <div className="flex items-center gap-0.5 rounded-md border border-neutral-200 p-0.5 dark:border-neutral-700">
            {seg('signature', 'Signature')}
            {seg('initials', 'Initials')}
            {seg('date', 'Date')}
          </div>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50 dark:border-neutral-600 dark:hover:bg-neutral-800" onClick={() => useViewer.getState().setDialog('signature')}>
            {activeSignature ? <img src={activeSignature.preview} alt="" className="h-5 max-w-16 object-contain" /> : null}
            {activeSignature ? 'Change signature…' : 'Create signature…'}
          </button>
          {hint(signPlacement === 'date' ? 'Click to stamp today’s date' : activeSignature ? 'Click on the page to place; drag the box to move or resize' : 'Create a signature to start')}
        </div>
      )
    }
    case 'stamp':
      return (
        <div className={row}>
          <StampControls />
        </div>
      )
    case 'forms': {
      const types: { t: FieldType; label: string }[] = [
        { t: 'text', label: 'Text' },
        { t: 'checkbox', label: 'Checkbox' },
        { t: 'radio', label: 'Radio' },
        { t: 'combobox', label: 'Dropdown' },
        { t: 'listbox', label: 'List' },
        { t: 'date', label: 'Date' },
        { t: 'signature', label: 'Signature' },
      ]
      return (
        <div className={row}>
          <span className="font-medium">Add field</span>
          <div className="flex items-center gap-0.5 rounded-md border border-neutral-200 p-0.5 dark:border-neutral-700">
            {types.map(({ t, label }) => (
              <button key={t} type="button" onClick={() => useViewer.getState().setFieldTool(fieldTool === t ? null : t)} className={clsx('rounded px-2 py-0.5', fieldTool === t ? 'bg-emerald-100 font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800')}>
                {label}
              </button>
            ))}
          </div>
          <Toggle checked={flatten} onChange={(b) => useViewer.getState().setFlattenOnSave(b)} label="Flatten on save" />
          {hint(fieldTool ? 'Drag on the page to place the field' : hasForms ? 'Fill the fields directly on the page' : 'This document has no form fields yet — add some')}
        </div>
      )
    }
    default:
      return null
  }
}

const STAMP_COLORS = ['#16a34a', '#dc2626', '#2563eb', '#7c3aed', '#0891b2', '#525252']

function StampControls() {
  const st = useViewer((s) => s.stamp)
  const set = useViewer((s) => s.setStamp)
  const isPreset = STAMP_PRESETS.some((p) => p.text === st.text)
  const sub = stampSubtext(st)
  return (
    <>
      <select
        aria-label="Stamp preset"
        value={isPreset ? st.text : ''}
        onChange={(e) => {
          const p = STAMP_PRESETS.find((x) => x.text === e.target.value)
          set(p ? { text: p.text, color: p.color } : { text: '' })
        }}
        className={clsx(inputCls, 'h-7 w-36 max-w-36 shrink-0 py-0 text-xs')}
      >
        {STAMP_PRESETS.map((p) => (
          <option key={p.text} value={p.text}>
            {p.text}
          </option>
        ))}
        <option value="">Custom…</option>
      </select>
      <input
        aria-label="Stamp text"
        value={st.text}
        maxLength={60}
        onChange={(e) => set({ text: e.target.value.toUpperCase() })}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="Your stamp text"
        className={clsx(inputCls, 'h-7 w-36 max-w-36 shrink-0 py-0 text-xs font-semibold uppercase')}
      />
      <ColorSwatches colors={STAMP_COLORS} value={st.color} onChange={(c) => set({ color: c })} size="sm" />
      <label className="flex shrink-0 items-center gap-1">
        <input type="checkbox" checked={st.date} onChange={(e) => set({ date: e.target.checked })} className="accent-brand-600" />
        Date
      </label>
      <input
        aria-label="Name on stamp"
        value={st.name}
        maxLength={40}
        onChange={(e) => set({ name: e.target.value })}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="Name (optional)"
        className={clsx(inputCls, 'h-7 w-32 max-w-32 shrink-0 py-0 text-xs')}
      />
      <label className="flex shrink-0 items-center gap-1">
        Tilt
        <input type="range" min={-30} max={30} step={1} value={st.rotate} onChange={(e) => set({ rotate: Number(e.target.value) })} className="w-20 accent-brand-600" />
        <span className="w-8 tabular-nums">{st.rotate}°</span>
      </label>
      <span className="truncate text-neutral-400">{st.text.trim() ? `Click the page to stamp${sub ? ` (${sub})` : ''}` : 'Type the stamp text'}</span>
    </>
  )
}

function OpacityControl() {
  const style = useViewer((s) => s.style)
  const setStyle = useViewer((s) => s.setStyle)
  return (
    <label className="flex items-center gap-1">
      Opacity
      <input type="range" min={0.1} max={1} step={0.05} value={style.opacity} onChange={(e) => setStyle({ opacity: Number(e.target.value) })} className="w-20 accent-brand-600" />
      <span className="w-8 tabular-nums">{Math.round(style.opacity * 100)}%</span>
    </label>
  )
}

function FontControls() {
  const style = useViewer((s) => s.style)
  const setStyle = useViewer((s) => s.setStyle)
  const [size, setSize] = useState(String(style.fontSize))
  const [prevSize, setPrevSize] = useState(style.fontSize)
  if (prevSize !== style.fontSize) {
    setPrevSize(style.fontSize)
    setSize(String(style.fontSize))
  }
  return (
    <>
      <select value={style.font} onChange={(e) => setStyle({ font: e.target.value as FontName })} className={clsx(inputCls, 'h-7 w-36 max-w-36 shrink-0 py-0 text-xs')}>
        {FONT_OPTIONS.map((f) => (
          <option key={f.v} value={f.v}>
            {f.label}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={4}
        max={144}
        value={size}
        onChange={(e) => setSize(e.target.value)}
        onBlur={() => {
          const n = Number(size)
          if (n >= 4 && n <= 144) setStyle({ fontSize: n })
          else setSize(String(style.fontSize))
        }}
        className={clsx(inputCls, 'h-7 w-16 py-0 text-xs')}
        aria-label="Font size"
      />
      <ColorSwatches colors={['#000000', '#1f3df5', '#e11d48', '#16a34a', '#525252']} value={style.color} onChange={(c) => setStyle({ color: c })} size="sm" />
    </>
  )
}
