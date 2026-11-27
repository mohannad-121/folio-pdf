'use strict';
// Minimal, sandbox-safe bridge exposed to the web app as `window.folioDesktop`.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('folioDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: ipcRenderer.sendSync('folio:version'),
  openExternal: (url) => ipcRenderer.invoke('folio:open-external', String(url)),
  showItemInFolder: (path) => ipcRenderer.invoke('folio:show-item-in-folder', String(path)),
  /** Called with `{ path, fileId }` after a PDF was opened from the OS (menu, double-click, drop on icon). */
  onOpenFile: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('folio:open-file', listener);
    return () => ipcRenderer.removeListener('folio:open-file', listener);
  },
  // Used by the "Optional components" window.
  getHealth: () => ipcRenderer.invoke('folio:health'),
  copyText: (text) => ipcRenderer.invoke('folio:copy-text', String(text)),
  openLogs: () => ipcRenderer.invoke('folio:open-logs'),
  relaunch: () => ipcRenderer.invoke('folio:relaunch'),
});
