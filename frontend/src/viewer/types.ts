/**
 * Shared viewer types. Coordinates are PDF points, top-left origin, in the
 * displayed (rotated) page space — exactly what the backend expects.
 */

export type RectT = [number, number, number, number]
export type PointT = [number, number]

export type FontName = 'helv' | 'tiro' | 'cour' | 'tibo' | 'heit'
export type Align = 'left' | 'center' | 'right'
export type MarkupType = 'highlight' | 'underline' | 'strikeout' | 'squiggly'
export type ShapeType = 'rect' | 'ellipse' | 'line' | 'arrow'
export type FieldType = 'text' | 'checkbox' | 'radio' | 'combobox' | 'listbox' | 'signature' | 'date'

interface PageOp {
  page: number // 1-based
}

export type EditOp =
  | (PageOp & { type: MarkupType; rects: RectT[]; color: string; opacity: number })
  | (PageOp & { type: 'ink'; paths: PointT[][]; color: string; width: number; opacity: number })
  | (PageOp & { type: 'rect' | 'ellipse'; rect: RectT; stroke: string; fill: string | null; width: number; opacity: number })
  | (PageOp & { type: 'line' | 'arrow'; from: PointT; to: PointT; stroke: string; width: number })
  | (PageOp & { type: 'note'; point: PointT; contents: string; author: string })
  | (PageOp & { type: 'freetext'; rect: RectT; text: string; font_size: number; color: string; font: FontName; align: Align })
  | (PageOp & { type: 'text'; rect: RectT; text: string; font_size: number; color: string; font: FontName; align: Align })
  | (PageOp & { type: 'image'; rect: RectT; image_file_id: string; rotate: number })
  | (PageOp & { type: 'delete_image'; xref: number })
  | (PageOp & { type: 'replace_image'; xref: number; image_file_id: string })
  | (PageOp & { type: 'link'; rect: RectT; uri?: string; target_page?: number; remove_xref?: number })
  | (PageOp & { type: 'delete_link'; xref: number })
  | (PageOp & { type: 'redact'; rects: RectT[]; fill: string; text?: string })
  | (PageOp & { type: 'erase'; rect: RectT })
  | (PageOp & { type: 'replace_text'; rect: RectT; text: string; font_size?: number; color?: string; font?: FontName })
  | (PageOp & { type: 'delete_annot'; xref: number })
  | (PageOp & { type: 'update_annot'; xref: number; contents?: string; color?: string; opacity?: number; rect?: RectT })
  | (PageOp & { type: 'rotate_page'; angle: number })
  | (PageOp & { type: 'delete_page' })
  | (PageOp & { type: 'insert_blank_page'; after_page: number })
  | (PageOp & { type: 'move_page'; to: number })
  | (PageOp & { type: 'form_value'; field_name: string; value: string | boolean })
  /** Rubber stamp baked into the page. `rotate` is the tilt in degrees, clockwise (-45..45). */
  | (PageOp & { type: 'stamp'; rect: RectT; text: string; subtext?: string; color: string; opacity: number; rotate: number })
  | (PageOp & { type: 'signature'; rect: RectT; image_file_id: string })
  | (PageOp & { type: 'crop_page'; rect: RectT })
  | { type: 'set_metadata'; title: string; author: string; subject: string; keywords: string }

export type EditOpType = EditOp['type']

export interface PendingOp {
  id: string
  op: EditOp
}

export interface Annotation {
  page: number
  xref: number
  type: string
  rect: RectT
  contents: string
  author: string
  color: string | null
  opacity: number
}

export interface TextSpan {
  bbox: RectT
  text: string
  font: string
  size: number
  color: string
  bold: boolean
  italic: boolean
}
export interface TextLine {
  bbox: RectT
  spans: TextSpan[]
}
export interface TextBlock {
  bbox: RectT
  lines: TextLine[]
}
export interface PageTextSpans {
  width: number
  height: number
  blocks: TextBlock[]
}

export interface PageImage {
  xref: number
  bbox: RectT
  width: number
  height: number
}

export interface PdfLink {
  page: number
  xref: number
  rect: RectT
  kind: string
  uri?: string | null
  target_page?: number | null
}

export interface FormField {
  name: string
  type: string
  page: number
  rect: RectT
  value: string | boolean | null
  options: string[] | null
  required: boolean
  readonly: boolean
  multiline: boolean
  max_len: number | null
}

export interface NewFormField {
  type: FieldType
  name: string
  page: number
  rect: RectT
  options?: string[]
  required?: boolean
  multiline?: boolean
  default?: string
}

export interface SavedSignature {
  id: string
  file_id: string
  preview: string // data URL
  kind: 'draw' | 'type' | 'upload'
  label: string
  created: number
  /** width / height of the image (default 3). */
  aspect?: number
}

export interface SearchHit {
  page: number
  rect: RectT
  text: string
}

export type Mode =
  | 'select'
  | 'hand'
  | 'markup'
  | 'draw'
  | 'eraser'
  | 'shape'
  | 'text'
  | 'edit-text'
  | 'note'
  | 'image'
  | 'link'
  | 'redact'
  | 'sign'
  | 'stamp'
  | 'forms'
  | 'organize'

export type SidebarTab = 'thumbnails' | 'outline' | 'annotations' | 'search' | 'forms'
export type LayoutMode = 'continuous' | 'single' | 'spread'
export type ViewRotation = 0 | 90 | 180 | 270

export type Selection =
  | { kind: 'op'; id: string }
  | { kind: 'annot'; xref: number; page: number }
  | { kind: 'link'; xref: number; page: number }
  | { kind: 'image'; xref: number; page: number }
  | { kind: 'field'; name: string }
  | null

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error' | 'warning'
  text: string
}
