import type { OptionValues } from './types'

type Rule = (values: OptionValues) => boolean

const has = (v: unknown) => v !== undefined && v !== null && v !== '' && v !== false

/**
 * Conditional visibility for option fields, keyed by "<toolId>.<fieldKey>".
 * Fields without a rule are always shown. Hidden fields are not sent to the backend.
 */
const RULES: Record<string, Rule> = {
  'split.ranges': (v) => v.mode === 'ranges',
  'split.every': (v) => v.mode === 'every',

  'page-size.width': (v) => v.size === 'custom',
  'page-size.height': (v) => v.size === 'custom',

  // Watermark: text OR image.
  'watermark.text': (v) => !has(v.image_file_id),
  'watermark.image_file_id': (v) => !has(v.text),
  'watermark.font_size': (v) => !has(v.image_file_id),
  'watermark.color': (v) => !has(v.image_file_id),

  // Background: colour OR image.
  'background.color': (v) => !has(v.image_file_id),

  'insert-pages.blank_count': (v) => !has(v.insert_file_id),

  'digital-sign.cert_password': (v) => has(v.cert_file_id),

  'scan-to-pdf.language': (v) => v.ocr !== false,

  'bookmarks.outline': (v) => v.auto !== true,
}

export function isVisible(toolId: string, fieldKey: string, values: OptionValues): boolean {
  const rule = RULES[`${toolId}.${fieldKey}`]
  return rule ? rule(values) : true
}
