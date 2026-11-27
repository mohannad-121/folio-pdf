/**
 * The tool catalog. Home renders it as a grid; /tools/:toolId renders a ToolPage
 * for the matching entry. Each tool declares the backend endpoint it calls and
 * the options form it needs (see tools/ for the option renderers).
 */

export type ToolCategory =
  | 'organize'
  | 'convert-from'
  | 'convert-to'
  | 'edit'
  | 'optimize'
  | 'security'
  | 'forms-sign'
  | 'review'

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  organize: 'Organize',
  'convert-to': 'Convert to PDF',
  'convert-from': 'Convert from PDF',
  edit: 'Edit',
  optimize: 'Optimize',
  security: 'Security',
  'forms-sign': 'Forms & Sign',
  review: 'Review & Compare',
}

/** What the tool accepts as input. */
export type ToolInput =
  | { kind: 'pdf'; multiple?: boolean }
  | { kind: 'pdf-pair' } // exactly two PDFs (compare)
  | { kind: 'images'; multiple: true }
  | { kind: 'office' } // docx/xlsx/pptx/odt/...
  | { kind: 'html' } // .html file or URL
  | { kind: 'any'; multiple?: boolean }

export type OptionField =
  | { type: 'text'; key: string; label: string; placeholder?: string; default?: string; help?: string }
  | { type: 'textarea'; key: string; label: string; placeholder?: string; default?: string; help?: string }
  | { type: 'number'; key: string; label: string; min?: number; max?: number; step?: number; default?: number; help?: string }
  | { type: 'select'; key: string; label: string; options: { value: string; label: string }[]; default?: string; help?: string }
  | { type: 'checkbox'; key: string; label: string; default?: boolean; help?: string }
  | { type: 'pages'; key: string; label: string; default?: string; help?: string } // page spec like 1-3,5
  | { type: 'color'; key: string; label: string; default?: string }
  | { type: 'password'; key: string; label: string; help?: string }
  | { type: 'file'; key: string; label: string; accept?: string; help?: string } // extra single upload -> file_id

export interface ToolDef {
  id: string
  name: string
  description: string
  category: ToolCategory
  /** lucide-react icon name, resolved in the UI. */
  icon: string
  input: ToolInput
  /** Backend endpoint (POST). Body = { file_id | file_ids, ...options }. */
  endpoint: string
  options?: OptionField[]
  /** Tools that open the interactive viewer instead of a form. */
  opensViewer?: boolean
  /** Whether the tool is rendered as a highlight on the home page. */
  featured?: boolean
}

export const TOOLS: ToolDef[] = [
  // ---- Organize ----------------------------------------------------------
  {
    id: 'merge',
    name: 'Merge PDF',
    description: 'Combine multiple PDFs (and images or Office files) into one document, in the order you choose.',
    category: 'organize',
    icon: 'Combine',
    input: { kind: 'any', multiple: true },
    endpoint: '/api/organize/merge',
    featured: true,
  },
  {
    id: 'split',
    name: 'Split PDF',
    description: 'Split by page ranges, every N pages, by file size, or by bookmarks.',
    category: 'organize',
    icon: 'Scissors',
    input: { kind: 'pdf' },
    endpoint: '/api/organize/split',
    options: [
      {
        type: 'select',
        key: 'mode',
        label: 'Split mode',
        default: 'ranges',
        options: [
          { value: 'ranges', label: 'Custom page ranges' },
          { value: 'every', label: 'Every N pages' },
          { value: 'single', label: 'Every page to its own file' },
          { value: 'bookmarks', label: 'By top-level bookmarks' },
        ],
      },
      { type: 'text', key: 'ranges', label: 'Ranges', placeholder: '1-3, 4-6, 7-', help: 'Comma separated. Used in "ranges" mode.' },
      { type: 'number', key: 'every', label: 'Pages per file', min: 1, default: 1, help: 'Used in "every" mode.' },
    ],
    featured: true,
  },
  {
    id: 'organize',
    name: 'Organize Pages',
    description: 'Visually reorder, rotate, delete, duplicate and insert pages with drag and drop.',
    category: 'organize',
    icon: 'LayoutGrid',
    input: { kind: 'pdf' },
    endpoint: '/api/organize/reorder',
    opensViewer: true,
    featured: true,
  },
  {
    id: 'extract-pages',
    name: 'Extract Pages',
    description: 'Pull selected pages out into a new PDF.',
    category: 'organize',
    icon: 'FileOutput',
    input: { kind: 'pdf' },
    endpoint: '/api/organize/extract',
    options: [{ type: 'pages', key: 'pages', label: 'Pages to extract', default: '1' }],
  },
  {
    id: 'delete-pages',
    name: 'Delete Pages',
    description: 'Remove pages from a PDF.',
    category: 'organize',
    icon: 'FileMinus',
    input: { kind: 'pdf' },
    endpoint: '/api/organize/delete',
    options: [{ type: 'pages', key: 'pages', label: 'Pages to delete' }],
  },
  {
    id: 'rotate',
    name: 'Rotate PDF',
    description: 'Rotate all or selected pages by 90°, 180° or 270°.',
    category: 'organize',
    icon: 'RotateCw',
    input: { kind: 'pdf', multiple: true },
    endpoint: '/api/organize/rotate',
    options: [
      {
        type: 'select',
        key: 'angle',
        label: 'Angle',
        default: '90',
        options: [
          { value: '90', label: '90° clockwise' },
          { value: '180', label: '180°' },
          { value: '270', label: '90° counter-clockwise' },
        ],
      },
      { type: 'pages', key: 'pages', label: 'Pages', default: 'all' },
    ],
  },
  {
    id: 'insert-pages',
    name: 'Insert Pages',
    description: 'Insert another PDF (or blank pages) at a given position.',
    category: 'organize',
    icon: 'FilePlus',
    input: { kind: 'pdf' },
    endpoint: '/api/organize/insert',
    options: [
      { type: 'number', key: 'at', label: 'Insert after page', min: 0, default: 0, help: '0 = at the beginning' },
      { type: 'file', key: 'insert_file_id', label: 'PDF to insert', accept: 'application/pdf', help: 'Leave empty to insert blank pages.' },
      { type: 'number', key: 'blank_count', label: 'Blank pages to insert', min: 0, default: 1 },
    ],
  },
  {
    id: 'crop',
    name: 'Crop PDF',
    description: 'Trim margins or crop pages to a custom box.',
    category: 'organize',
    icon: 'Crop',
    input: { kind: 'pdf' },
    endpoint: '/api/edit/crop',
    options: [
      { type: 'pages', key: 'pages', label: 'Pages', default: 'all' },
      { type: 'number', key: 'top', label: 'Top (pt)', min: 0, default: 0 },
      { type: 'number', key: 'right', label: 'Right (pt)', min: 0, default: 0 },
      { type: 'number', key: 'bottom', label: 'Bottom (pt)', min: 0, default: 0 },
      { type: 'number', key: 'left', label: 'Left (pt)', min: 0, default: 0 },
      { type: 'checkbox', key: 'auto', label: 'Auto-trim white margins', default: false },
    ],
  },
  {
    id: 'page-size',
    name: 'Resize Pages',
    description: 'Scale pages to A4, Letter or a custom size.',
    category: 'organize',
    icon: 'Scaling',
    input: { kind: 'pdf' },
    endpoint: '/api/edit/resize',
    options: [
      {
        type: 'select',
        key: 'size',
        label: 'Page size',
        default: 'A4',
        options: [
          { value: 'A4', label: 'A4' },
          { value: 'Letter', label: 'US Letter' },
          { value: 'Legal', label: 'US Legal' },
          { value: 'A3', label: 'A3' },
          { value: 'A5', label: 'A5' },
          { value: 'custom', label: 'Custom (pt)' },
        ],
      },
      { type: 'number', key: 'width', label: 'Custom width (pt)', min: 1 },
      { type: 'number', key: 'height', label: 'Custom height (pt)', min: 1 },
      { type: 'checkbox', key: 'landscape', label: 'Landscape', default: false },
    ],
  },

  // ---- Convert to PDF ----------------------------------------------------
  {
    id: 'word-to-pdf',
    name: 'Word to PDF',
    description: 'Convert DOCX / DOC / ODT / RTF documents to PDF.',
    category: 'convert-to',
    icon: 'FileText',
    input: { kind: 'office' },
    endpoint: '/api/convert/office-to-pdf',
    featured: true,
  },
  {
    id: 'excel-to-pdf',
    name: 'Excel to PDF',
    description: 'Convert XLSX / XLS / ODS / CSV spreadsheets to PDF.',
    category: 'convert-to',
    icon: 'Table',
    input: { kind: 'office' },
    endpoint: '/api/convert/office-to-pdf',
  },
  {
    id: 'powerpoint-to-pdf',
    name: 'PowerPoint to PDF',
    description: 'Convert PPTX / PPT / ODP presentations to PDF.',
    category: 'convert-to',
    icon: 'Presentation',
    input: { kind: 'office' },
    endpoint: '/api/convert/office-to-pdf',
  },
  {
    id: 'images-to-pdf',
    name: 'Images to PDF',
    description: 'Turn JPG, PNG, WebP, TIFF, HEIC and more into a PDF — one image per page or a photo collage.',
    category: 'convert-to',
    icon: 'Images',
    input: { kind: 'images', multiple: true },
    endpoint: '/api/convert/images-to-pdf',
    options: [
      {
        type: 'select',
        key: 'page_size',
        label: 'Page size',
        default: 'fit',
        options: [
          { value: 'fit', label: 'Fit to image' },
          { value: 'A4', label: 'A4' },
          { value: 'Letter', label: 'US Letter' },
        ],
      },
      { type: 'number', key: 'margin', label: 'Margin (pt)', min: 0, default: 0 },
    ],
    featured: true,
  },
  {
    id: 'html-to-pdf',
    name: 'HTML to PDF',
    description: 'Render an HTML file or a web page URL to PDF.',
    category: 'convert-to',
    icon: 'Globe',
    input: { kind: 'html' },
    endpoint: '/api/convert/html-to-pdf',
    options: [{ type: 'text', key: 'url', label: 'Or enter a URL', placeholder: 'https://example.com' }],
  },
  {
    id: 'text-to-pdf',
    name: 'Text / Markdown to PDF',
    description: 'Convert plain text or Markdown into a clean PDF.',
    category: 'convert-to',
    icon: 'Type',
    input: { kind: 'any' },
    endpoint: '/api/convert/text-to-pdf',
  },
  {
    id: 'scan-to-pdf',
    name: 'Scan to PDF',
    description: 'Turn photos of paper into a clean, deskewed, searchable PDF.',
    category: 'convert-to',
    icon: 'ScanLine',
    input: { kind: 'images', multiple: true },
    endpoint: '/api/ocr/scan-to-pdf',
    options: [
      { type: 'checkbox', key: 'ocr', label: 'Make text searchable (OCR)', default: true },
      { type: 'checkbox', key: 'deskew', label: 'Deskew and clean', default: true },
      { type: 'text', key: 'language', label: 'OCR language(s)', default: 'eng', help: 'Tesseract codes, e.g. eng+ara' },
    ],
  },

  // ---- Convert from PDF --------------------------------------------------
  {
    id: 'pdf-to-word',
    name: 'PDF to Word',
    description: 'Convert PDFs into editable DOCX files with layout preserved.',
    category: 'convert-from',
    icon: 'FileText',
    input: { kind: 'pdf' },
    endpoint: '/api/convert/pdf-to-docx',
    options: [{ type: 'pages', key: 'pages', label: 'Pages', default: 'all' }],
    featured: true,
  },
  {
    id: 'pdf-to-excel',
    name: 'PDF to Excel',
    description: 'Extract tables from PDFs into XLSX spreadsheets.',
    category: 'convert-from',
    icon: 'Table',
    input: { kind: 'pdf' },
    endpoint: '/api/convert/pdf-to-xlsx',
    options: [{ type: 'pages', key: 'pages', label: 'Pages', default: 'all' }],
  },
  {
    id: 'pdf-to-powerpoint',
    name: 'PDF to PowerPoint',
    description: 'Turn each PDF page into a PPTX slide.',
    category: 'convert-from',
    icon: 'Presentation',
    input: { kind: 'pdf' },
    endpoint: '/api/convert/pdf-to-pptx',
    options: [
      {
        type: 'select',
        key: 'mode',
        label: 'Slide content',
        default: 'image',
        options: [
          { value: 'image', label: 'Page image (exact look)' },
          { value: 'text', label: 'Editable text' },
        ],
      },
    ],
  },
  {
    id: 'pdf-to-jpg',
    name: 'PDF to JPG',
    description: 'Export pages as JPG images, or extract every embedded image.',
    category: 'convert-from',
    icon: 'Image',
    input: { kind: 'pdf' },
    endpoint: '/api/convert/pdf-to-images',
    options: [
      { type: 'select', key: 'format', label: 'Format', default: 'jpeg', options: [{ value: 'jpeg', label: 'JPG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }, { value: 'tiff', label: 'TIFF' }] },
      { type: 'number', key: 'dpi', label: 'DPI', min: 36, max: 600, default: 150 },
      { type: 'pages', key: 'pages', label: 'Pages', default: 'all' },
      { type: 'checkbox', key: 'extract_embedded', label: 'Extract embedded images instead of rendering pages', default: false },
    ],
    featured: true,
  },
  {
    id: 'pdf-to-png',
    name: 'PDF to PNG',
    description: 'Export pages as lossless PNG images.',
    category: 'convert-from',
    icon: 'Image',
    input: { kind: 'pdf' },
    endpoint: '/api/convert/pdf-to-images',
    options: [
      { type: 'select', key: 'format', label: 'Format', default: 'png', options: [{ value: 'png', label: 'PNG' }] },
      { type: 'number', key: 'dpi', label: 'DPI', min: 36, max: 600, default: 150 },
      { type: 'pages', key: 'pages', label: 'Pages', default: 'all' },
    ],
  },
  {
    id: 'pdf-to-html',
    name: 'PDF to HTML',
    description: 'Convert PDF content into an HTML page.',
    category: 'convert-from',
    icon: 'Code',
    input: { kind: 'pdf' },
    endpoint: '/api/convert/pdf-to-html',
  },
  {
    id: 'pdf-to-text',
    name: 'PDF to Text',
    description: 'Extract plain text (or Markdown) from a PDF.',
    category: 'convert-from',
    icon: 'Type',
    input: { kind: 'pdf' },
    endpoint: '/api/convert/pdf-to-text',
    options: [{ type: 'select', key: 'format', label: 'Format', default: 'txt', options: [{ value: 'txt', label: 'Plain text' }, { value: 'md', label: 'Markdown' }, { value: 'json', label: 'JSON (with positions)' }] }],
  },
  {
    id: 'pdf-to-pdfa',
    name: 'PDF to PDF/A',
    description: 'Convert to the PDF/A archival standard.',
    category: 'convert-from',
    icon: 'Archive',
    input: { kind: 'pdf' },
    endpoint: '/api/convert/pdf-to-pdfa',
  },

  // ---- Edit --------------------------------------------------------------
  {
    id: 'edit',
    name: 'Edit PDF',
    description: 'Edit text, add text & images, draw, highlight, annotate, add links — all in the browser.',
    category: 'edit',
    icon: 'PenTool',
    input: { kind: 'pdf' },
    endpoint: '/api/edit/apply',
    opensViewer: true,
    featured: true,
  },
  {
    id: 'watermark',
    name: 'Add Watermark',
    description: 'Put text or an image over or under every page.',
    category: 'edit',
    icon: 'Droplets',
    input: { kind: 'pdf', multiple: true },
    endpoint: '/api/edit/watermark',
    options: [
      { type: 'text', key: 'text', label: 'Watermark text', placeholder: 'CONFIDENTIAL' },
      { type: 'file', key: 'image_file_id', label: 'Or image', accept: 'image/*' },
      { type: 'number', key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, default: 0.3 },
      { type: 'number', key: 'rotation', label: 'Rotation (°)', min: -180, max: 180, default: 45 },
      { type: 'number', key: 'font_size', label: 'Font size', min: 6, max: 300, default: 60 },
      { type: 'color', key: 'color', label: 'Color', default: '#ff0000' },
      { type: 'select', key: 'position', label: 'Position', default: 'center', options: [{ value: 'center', label: 'Center' }, { value: 'tile', label: 'Tiled' }, { value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }] },
      { type: 'checkbox', key: 'under', label: 'Place under content', default: false },
      { type: 'pages', key: 'pages', label: 'Pages', default: 'all' },
    ],
  },
  {
    id: 'page-numbers',
    name: 'Add Page Numbers',
    description: 'Number pages with custom position, format and starting number.',
    category: 'edit',
    icon: 'Hash',
    input: { kind: 'pdf' },
    endpoint: '/api/edit/page-numbers',
    options: [
      { type: 'select', key: 'position', label: 'Position', default: 'bottom-center', options: [
        { value: 'bottom-center', label: 'Bottom center' }, { value: 'bottom-right', label: 'Bottom right' }, { value: 'bottom-left', label: 'Bottom left' },
        { value: 'top-center', label: 'Top center' }, { value: 'top-right', label: 'Top right' }, { value: 'top-left', label: 'Top left' },
      ] },
      { type: 'text', key: 'format', label: 'Format', default: '{n}', help: 'Use {n} for the number and {total} for the page count, e.g. "Page {n} of {total}".' },
      { type: 'number', key: 'start', label: 'Start at', min: 1, default: 1 },
      { type: 'number', key: 'font_size', label: 'Font size', min: 6, max: 72, default: 11 },
      { type: 'pages', key: 'pages', label: 'Pages', default: 'all' },
    ],
  },
  {
    id: 'header-footer',
    name: 'Header & Footer',
    description: 'Add text headers and footers (date, title, Bates numbering).',
    category: 'edit',
    icon: 'PanelTop',
    input: { kind: 'pdf' },
    endpoint: '/api/edit/header-footer',
    options: [
      { type: 'text', key: 'header_left', label: 'Header left' },
      { type: 'text', key: 'header_center', label: 'Header center' },
      { type: 'text', key: 'header_right', label: 'Header right' },
      { type: 'text', key: 'footer_left', label: 'Footer left' },
      { type: 'text', key: 'footer_center', label: 'Footer center', default: '{n}' },
      { type: 'text', key: 'footer_right', label: 'Footer right' },
      { type: 'number', key: 'font_size', label: 'Font size', min: 6, max: 48, default: 10 },
      { type: 'number', key: 'bates_start', label: 'Bates start', min: 0, help: 'Use {bates} in any slot. Leave empty to disable.' },
    ],
  },
  {
    id: 'background',
    name: 'Add Background',
    description: 'Set a solid colour or image background behind every page.',
    category: 'edit',
    icon: 'Paintbrush',
    input: { kind: 'pdf' },
    endpoint: '/api/edit/background',
    options: [
      { type: 'color', key: 'color', label: 'Background colour', default: '#fff8e1' },
      { type: 'file', key: 'image_file_id', label: 'Or image', accept: 'image/*' },
      { type: 'number', key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, default: 1 },
    ],
  },
  {
    id: 'metadata',
    name: 'Edit Metadata',
    description: 'Change title, author, subject, keywords; strip hidden metadata.',
    category: 'edit',
    icon: 'Info',
    input: { kind: 'pdf' },
    endpoint: '/api/edit/metadata',
    options: [
      { type: 'text', key: 'title', label: 'Title' },
      { type: 'text', key: 'author', label: 'Author' },
      { type: 'text', key: 'subject', label: 'Subject' },
      { type: 'text', key: 'keywords', label: 'Keywords' },
      { type: 'checkbox', key: 'strip', label: 'Remove all existing metadata first', default: false },
    ],
  },
  {
    id: 'bookmarks',
    name: 'Edit Bookmarks',
    description: 'Create or edit the document outline (table of contents).',
    category: 'edit',
    icon: 'Bookmark',
    input: { kind: 'pdf' },
    endpoint: '/api/edit/bookmarks',
    options: [
      { type: 'textarea', key: 'outline', label: 'Outline', placeholder: 'Introduction|1\n  Background|2\n  Method|4\nResults|7', help: 'One per line: "Title|page". Indent with two spaces per level. Leave empty to auto-generate from headings.' },
      { type: 'checkbox', key: 'auto', label: 'Auto-detect headings', default: false },
    ],
  },

  // ---- Optimize ----------------------------------------------------------
  {
    id: 'compress',
    name: 'Compress PDF',
    description: 'Shrink file size with smart image recompression and object cleanup.',
    category: 'optimize',
    icon: 'Minimize2',
    input: { kind: 'pdf', multiple: true },
    endpoint: '/api/optimize/compress',
    options: [
      { type: 'select', key: 'level', label: 'Compression level', default: 'medium', options: [
        { value: 'low', label: 'Low (best quality)' }, { value: 'medium', label: 'Medium (recommended)' }, { value: 'high', label: 'High (smallest)' }, { value: 'extreme', label: 'Extreme (grayscale, 72 dpi)' },
      ] },
      { type: 'checkbox', key: 'remove_metadata', label: 'Remove metadata', default: false },
    ],
    featured: true,
  },
  {
    id: 'ocr',
    name: 'OCR PDF',
    description: 'Recognise text in scanned PDFs to make them searchable and copyable.',
    category: 'optimize',
    icon: 'ScanText',
    input: { kind: 'pdf', multiple: true },
    endpoint: '/api/ocr/pdf',
    options: [
      { type: 'text', key: 'language', label: 'Language(s)', default: 'eng', help: 'Tesseract codes, e.g. eng+ara+deu' },
      { type: 'checkbox', key: 'deskew', label: 'Deskew pages', default: true },
      { type: 'checkbox', key: 'rotate', label: 'Auto-rotate pages', default: true },
      { type: 'checkbox', key: 'force', label: 'Re-OCR pages that already have text', default: false },
    ],
    featured: true,
  },
  {
    id: 'repair',
    name: 'Repair PDF',
    description: 'Fix corrupted or malformed PDFs.',
    category: 'optimize',
    icon: 'Wrench',
    input: { kind: 'pdf' },
    endpoint: '/api/optimize/repair',
  },
  {
    id: 'flatten',
    name: 'Flatten PDF',
    description: 'Bake forms and annotations into the page content.',
    category: 'optimize',
    icon: 'Layers',
    input: { kind: 'pdf' },
    endpoint: '/api/optimize/flatten',
  },
  {
    id: 'grayscale',
    name: 'Grayscale PDF',
    description: 'Convert all pages to black & white.',
    category: 'optimize',
    icon: 'Contrast',
    input: { kind: 'pdf' },
    endpoint: '/api/optimize/grayscale',
  },

  // ---- Security ----------------------------------------------------------
  {
    id: 'protect',
    name: 'Protect PDF',
    description: 'Add a password and restrict printing, copying and editing (AES-256).',
    category: 'security',
    icon: 'Lock',
    input: { kind: 'pdf', multiple: true },
    endpoint: '/api/security/protect',
    options: [
      { type: 'password', key: 'user_password', label: 'Open password', help: 'Required to open the file. Leave empty to only restrict permissions.' },
      { type: 'password', key: 'owner_password', label: 'Permissions password', help: 'Required to change permissions.' },
      { type: 'checkbox', key: 'allow_print', label: 'Allow printing', default: true },
      { type: 'checkbox', key: 'allow_copy', label: 'Allow copying text', default: true },
      { type: 'checkbox', key: 'allow_modify', label: 'Allow editing', default: false },
      { type: 'checkbox', key: 'allow_annotate', label: 'Allow comments & form fill', default: true },
    ],
    featured: true,
  },
  {
    id: 'unlock',
    name: 'Unlock PDF',
    description: 'Remove a password and restrictions from a PDF you own.',
    category: 'security',
    icon: 'Unlock',
    input: { kind: 'pdf', multiple: true },
    endpoint: '/api/security/unlock',
    options: [{ type: 'password', key: 'password', label: 'Current password' }],
  },
  {
    id: 'redact',
    name: 'Redact PDF',
    description: 'Permanently black out text, patterns (emails, phone numbers, SSNs) or regions.',
    category: 'security',
    icon: 'EyeOff',
    input: { kind: 'pdf' },
    endpoint: '/api/security/redact',
    opensViewer: true,
    options: [
      { type: 'textarea', key: 'terms', label: 'Words / phrases to redact', placeholder: 'One per line' },
      { type: 'checkbox', key: 'emails', label: 'Email addresses', default: false },
      { type: 'checkbox', key: 'phones', label: 'Phone numbers', default: false },
      { type: 'checkbox', key: 'ssn', label: 'US Social Security numbers', default: false },
      { type: 'checkbox', key: 'credit_cards', label: 'Credit card numbers', default: false },
      { type: 'text', key: 'regex', label: 'Custom regex' },
    ],
  },
  {
    id: 'sanitize',
    name: 'Sanitize PDF',
    description: 'Remove hidden data: metadata, JavaScript, embedded files, comments, form data, links.',
    category: 'security',
    icon: 'ShieldCheck',
    input: { kind: 'pdf' },
    endpoint: '/api/security/sanitize',
    options: [
      { type: 'checkbox', key: 'metadata', label: 'Metadata', default: true },
      { type: 'checkbox', key: 'javascript', label: 'JavaScript', default: true },
      { type: 'checkbox', key: 'attachments', label: 'Embedded files', default: true },
      { type: 'checkbox', key: 'annotations', label: 'Comments & annotations', default: false },
      { type: 'checkbox', key: 'forms', label: 'Form fields', default: false },
      { type: 'checkbox', key: 'links', label: 'Links', default: false },
    ],
  },

  // ---- Forms & sign --------------------------------------------------------
  {
    id: 'sign',
    name: 'Sign PDF',
    description: 'Draw, type or upload a signature and place it anywhere. Optionally add a digital certificate.',
    category: 'forms-sign',
    icon: 'PenLine',
    input: { kind: 'pdf' },
    endpoint: '/api/sign/stamp',
    opensViewer: true,
    featured: true,
  },
  {
    id: 'stamp',
    name: 'Stamp PDF',
    description: 'Stamp pages with APPROVED, PAID, RECEIVED or your own text, with the date and your name.',
    category: 'forms-sign',
    icon: 'Stamp',
    input: { kind: 'pdf' },
    endpoint: '/api/edit/apply',
    opensViewer: true,
  },
  {
    id: 'digital-sign',
    name: 'Digital Signature',
    description: 'Cryptographically sign with a PKCS#12 certificate, or verify existing signatures.',
    category: 'forms-sign',
    icon: 'BadgeCheck',
    input: { kind: 'pdf' },
    endpoint: '/api/sign/digital',
    options: [
      { type: 'file', key: 'cert_file_id', label: 'Certificate (.p12 / .pfx)', accept: '.p12,.pfx', help: 'Leave empty to generate a self-signed certificate.' },
      { type: 'password', key: 'cert_password', label: 'Certificate password' },
      { type: 'text', key: 'reason', label: 'Reason', placeholder: 'I approve this document' },
      { type: 'text', key: 'location', label: 'Location' },
      { type: 'checkbox', key: 'visible', label: 'Visible signature on last page', default: true },
    ],
  },
  {
    id: 'verify-signatures',
    name: 'Verify Signatures',
    description: 'Check the digital signatures in a PDF.',
    category: 'forms-sign',
    icon: 'ShieldCheck',
    input: { kind: 'pdf' },
    endpoint: '/api/sign/verify',
  },
  {
    id: 'fill-form',
    name: 'Fill & Create Forms',
    description: 'Fill in interactive forms, or add text fields, checkboxes, dropdowns and signature fields.',
    category: 'forms-sign',
    icon: 'ClipboardList',
    input: { kind: 'pdf' },
    endpoint: '/api/forms/fill',
    opensViewer: true,
  },
  {
    id: 'form-data',
    name: 'Export Form Data',
    description: 'Export filled form values to JSON / CSV, or import them.',
    category: 'forms-sign',
    icon: 'Database',
    input: { kind: 'pdf' },
    endpoint: '/api/forms/export',
    options: [{ type: 'select', key: 'format', label: 'Format', default: 'json', options: [{ value: 'json', label: 'JSON' }, { value: 'csv', label: 'CSV' }, { value: 'fdf', label: 'FDF' }] }],
  },

  // ---- Review ------------------------------------------------------------
  {
    id: 'compare',
    name: 'Compare PDFs',
    description: 'Find text and visual differences between two versions of a document.',
    category: 'review',
    icon: 'GitCompare',
    input: { kind: 'pdf-pair' },
    endpoint: '/api/review/compare',
    options: [
      { type: 'checkbox', key: 'text', label: 'Compare text', default: true },
      { type: 'checkbox', key: 'visual', label: 'Compare visually (pixel diff)', default: true },
    ],
    featured: true,
  },
  {
    id: 'view',
    name: 'View & Annotate',
    description: 'Read, search, highlight, comment and draw on any PDF.',
    category: 'review',
    icon: 'BookOpen',
    input: { kind: 'pdf' },
    endpoint: '/api/edit/apply',
    opensViewer: true,
  },
  {
    id: 'accessibility',
    name: 'Accessibility Check',
    description: 'Audit a PDF for tags, alt text, language, reading order and contrast issues.',
    category: 'review',
    icon: 'Accessibility',
    input: { kind: 'pdf' },
    endpoint: '/api/review/accessibility',
  },
  {
    id: 'inspect',
    name: 'Inspect PDF',
    description: 'See fonts, images, metadata, page sizes, attachments and hidden content.',
    category: 'review',
    icon: 'Search',
    input: { kind: 'pdf' },
    endpoint: '/api/review/inspect',
  },
  {
    id: 'word-count',
    name: 'Word Count',
    description: 'Count words, characters and pages.',
    category: 'review',
    icon: 'Sigma',
    input: { kind: 'pdf' },
    endpoint: '/api/review/word-count',
  },
]

export const TOOLS_BY_ID: Record<string, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.id, t]))

/**
 * Display order inside each category: the everyday tools first, niche ones last. Tools missing
 * here keep their catalog order after the listed ones.
 */
const TOOL_ORDER: string[] = [
  // organize
  'merge', 'split', 'organize', 'rotate', 'extract-pages', 'delete-pages', 'insert-pages', 'crop', 'page-size',
  // convert to PDF
  'word-to-pdf', 'images-to-pdf', 'excel-to-pdf', 'powerpoint-to-pdf', 'scan-to-pdf', 'html-to-pdf', 'text-to-pdf',
  // convert from PDF
  'pdf-to-word', 'pdf-to-jpg', 'pdf-to-excel', 'pdf-to-powerpoint', 'pdf-to-png', 'pdf-to-text', 'pdf-to-html', 'pdf-to-pdfa',
  // edit
  'edit', 'watermark', 'page-numbers', 'header-footer', 'background', 'bookmarks', 'metadata',
  // forms & sign
  'sign', 'fill-form', 'stamp', 'digital-sign', 'verify-signatures', 'form-data',
  // optimize
  'compress', 'ocr', 'flatten', 'grayscale', 'repair',
  // security
  'protect', 'unlock', 'redact', 'sanitize',
  // review
  'view', 'compare', 'inspect', 'accessibility', 'word-count',
] // prettier-ignore

const TOOL_RANK = new Map(TOOL_ORDER.map((id, i) => [id, i]))
const rank = (t: ToolDef) => TOOL_RANK.get(t.id) ?? TOOL_ORDER.length + TOOLS.indexOf(t)

/** Tools of a category in display order. */
export function toolsInCategory(cat: ToolCategory): ToolDef[] {
  return TOOLS.filter((t) => t.category === cat).sort((a, b) => rank(a) - rank(b))
}

/** Categories in display order, following the most common workflows. */
export const CATEGORY_ORDER: ToolCategory[] = [
  'organize',
  'convert-to',
  'convert-from',
  'edit',
  'forms-sign',
  'optimize',
  'security',
  'review',
]
