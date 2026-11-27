/** Helpers to reason about EditOps geometrically (bounds, move, resize). */
import { roundRect, unionRects } from './coords'
import type { EditOp, PendingOp, RectT } from './types'

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** Ops that are positioned by a single rect and can be moved/resized. */
export function isRectOp(op: EditOp): op is Extract<EditOp, { rect: RectT }> {
  return 'rect' in op && Array.isArray(op.rect) && op.type !== 'update_annot' && op.type !== 'crop_page'
}

/** Ops that render on a page (as opposed to page/metadata/form ops). */
export function isVisualOp(op: EditOp): boolean {
  switch (op.type) {
    case 'rotate_page':
    case 'delete_page':
    case 'insert_blank_page':
    case 'move_page':
    case 'form_value':
    case 'set_metadata':
    case 'delete_annot':
    case 'update_annot':
    case 'delete_image':
    case 'replace_image':
    case 'delete_link':
    case 'crop_page':
      return false
    default:
      return true
  }
}

export function opPage(op: EditOp): number | null {
  return 'page' in op ? op.page : null
}

export function opBounds(op: EditOp): RectT | null {
  switch (op.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
    case 'squiggly':
    case 'redact':
      return op.rects.length ? unionRects(op.rects) : null
    case 'ink': {
      const pts = op.paths.flat()
      if (!pts.length) return null
      return unionRects(pts.map((p) => [p[0], p[1], p[0], p[1]] as RectT))
    }
    case 'line':
    case 'arrow':
      return unionRects([
        [op.from[0], op.from[1], op.from[0], op.from[1]],
        [op.to[0], op.to[1], op.to[0], op.to[1]],
      ])
    case 'note':
      return [op.point[0], op.point[1], op.point[0] + 20, op.point[1] + 20]
    case 'update_annot':
      return op.rect ?? null
    default:
      if ('rect' in op) return op.rect
      return null
  }
}

export function translateOp(op: EditOp, dx: number, dy: number): EditOp {
  const r = (rect: RectT): RectT => roundRect([rect[0] + dx, rect[1] + dy, rect[2] + dx, rect[3] + dy])
  switch (op.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
    case 'squiggly':
    case 'redact':
      return { ...op, rects: op.rects.map(r) }
    case 'ink':
      return { ...op, paths: op.paths.map((p) => p.map(([x, y]) => [x + dx, y + dy] as [number, number])) }
    case 'line':
    case 'arrow':
      return { ...op, from: [op.from[0] + dx, op.from[1] + dy], to: [op.to[0] + dx, op.to[1] + dy] }
    case 'note':
      return { ...op, point: [op.point[0] + dx, op.point[1] + dy] }
    default:
      if (isRectOp(op)) return { ...op, rect: r(op.rect) }
      return op
  }
}

export function resizeOp(op: EditOp, rect: RectT): EditOp {
  if (isRectOp(op)) return { ...op, rect: roundRect(rect) }
  if (op.type === 'redact' && op.rects.length === 1) return { ...op, rects: [roundRect(rect)] }
  return op
}

export function canMove(op: EditOp): boolean {
  return isVisualOp(op) && !['highlight', 'underline', 'strikeout', 'squiggly', 'replace_text', 'erase'].includes(op.type)
}

export function canResize(op: EditOp): boolean {
  return isRectOp(op) ? op.type !== 'replace_text' && op.type !== 'erase' : op.type === 'redact' && op.rects.length === 1
}

export function opLabel(op: EditOp): string {
  const names: Record<EditOp['type'], string> = {
    highlight: 'Highlight',
    underline: 'Underline',
    strikeout: 'Strikeout',
    squiggly: 'Squiggly',
    ink: 'Drawing',
    rect: 'Rectangle',
    ellipse: 'Ellipse',
    line: 'Line',
    arrow: 'Arrow',
    note: 'Sticky note',
    freetext: 'Text box',
    text: 'Text',
    image: 'Image',
    delete_image: 'Delete image',
    replace_image: 'Replace image',
    link: 'Link',
    delete_link: 'Delete link',
    redact: 'Redaction',
    erase: 'Erase area',
    replace_text: 'Edited text',
    delete_annot: 'Delete annotation',
    update_annot: 'Edit annotation',
    rotate_page: 'Rotate page',
    delete_page: 'Delete page',
    insert_blank_page: 'Insert blank page',
    move_page: 'Move page',
    form_value: 'Form value',
    signature: 'Signature',
    crop_page: 'Crop page',
    set_metadata: 'Document info',
  }
  return names[op.type]
}

export function opSummary(op: EditOp): string {
  switch (op.type) {
    case 'note':
      return op.contents || '(empty note)'
    case 'freetext':
    case 'text':
    case 'replace_text':
      return op.text
    case 'link':
      return op.uri ?? (op.target_page ? `Go to page ${op.target_page}` : '(no target)')
    case 'form_value':
      return `${op.field_name} = ${String(op.value)}`
    case 'rotate_page':
      return `${op.angle}°`
    case 'set_metadata':
      return op.title
    default:
      return ''
  }
}

/** Primary color of an op, for list swatches. */
export function opColor(op: EditOp): string | null {
  if ('color' in op && typeof op.color === 'string') return op.color
  if ('stroke' in op) return op.stroke
  if (op.type === 'redact') return op.fill
  return null
}

/** Serialise for the API (strip client ids). */
export function serializeOps(ops: PendingOp[]): EditOp[] {
  return ops.map((p) => p.op)
}
