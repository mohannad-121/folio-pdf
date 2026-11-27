/**
 * Viewer / editor entry point. Exports `ViewerPage` (route: /view/:fileId?).
 * Query params: ?tool=edit|sign|redact|organize|fill-form|view selects the initial mode.
 */
export { default as ViewerPage } from './ViewerPage'
