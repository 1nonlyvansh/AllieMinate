import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('alliminate', {
  platform: process.platform,
  openApp: (target?: string): Promise<void> => ipcRenderer.invoke('tray:openApp', target),
  onNavigate: (cb: (view: string) => void): (() => void) => {
    const listener = (_e: unknown, view: string) => cb(view);
    ipcRenderer.on('app:navigate', listener);
    return () => ipcRenderer.removeListener('app:navigate', listener);
  },
  completeDrop: (kind: 'folder' | 'device' | 'nearby', id: string): Promise<void> =>
    ipcRenderer.invoke('tray:completeDrop', kind, id),
  cancelDrop: (): Promise<void> => ipcRenderer.invoke('tray:cancelDrop'),
  keepPanelOpen: (): Promise<void> => ipcRenderer.invoke('tray:keepPanelOpen'),
  notifyPanelDragLeave: (): Promise<void> => ipcRenderer.invoke('tray:panelDragLeave'),
  dropFilesInPanel: (filePaths: string[], kind?: 'cloud' | 'device' | 'nearby'): Promise<void> =>
    ipcRenderer.invoke('tray:filesDroppedInPanel', filePaths, kind),
  switchDropKind: (kind: 'cloud' | 'device'): Promise<void> => ipcRenderer.invoke('tray:switchDropKind', kind),
  copyFile: (url: string, filename: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('tray:copyFile', url, filename),
  prepareFileForDrag: (url: string, filename: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('tray:prepareFileForDrag', url, filename),
  startFileDrag: (filePath: string): void => ipcRenderer.send('tray:startFileDrag', filePath),
  showInFinder: (filePath: string): Promise<void> => ipcRenderer.invoke('file:showInFinder', filePath),
  openFolder: (folderPath: string): Promise<string> => ipcRenderer.invoke('file:openFolder', folderPath),
  copyLocalFile: (filePath: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('file:copyLocal', filePath),
  pickFolder: (): Promise<{ canceled: boolean; path?: string }> => ipcRenderer.invoke('dialog:pickFolder'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  composeMailWithAttachments: (params: { to: string; subject: string; body: string; attachmentPaths: string[] }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('mail:composeWithAttachments', params),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  onTrayState: (cb: (state: unknown) => void): (() => void) => {
    const listener = (_e: unknown, state: unknown) => cb(state);
    ipcRenderer.on('tray:state', listener);
    return () => ipcRenderer.removeListener('tray:state', listener);
  },
});

contextBridge.exposeInMainWorld('security', {
  isEnabled: (): Promise<boolean> => ipcRenderer.invoke('security:isEnabled'),
  setEnabled: (enabled: boolean, pin?: string): Promise<void> => ipcRenderer.invoke('security:setEnabled', enabled, pin),
  verifyPin: (pin: string): Promise<boolean> => ipcRenderer.invoke('security:verifyPin', pin),
  canTouchID: (): Promise<boolean> => ipcRenderer.invoke('security:canTouchID'),
  tryTouchID: (): Promise<boolean> => ipcRenderer.invoke('security:tryTouchID'),
});

contextBridge.exposeInMainWorld('launchAtLogin', {
  isEnabled: (): Promise<boolean> => ipcRenderer.invoke('launchAtLogin:isEnabled'),
  setEnabled: (enabled: boolean): Promise<void> => ipcRenderer.invoke('launchAtLogin:setEnabled', enabled),
});

contextBridge.exposeInMainWorld('usbPairing', {
  connect: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('usb:connect'),
  launchPairDeepLink: (code: string, macName: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('usb:launchPairDeepLink', code, macName),
});
