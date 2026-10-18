import { contextBridge,ipcRenderer } from 'electron'

const commands = new Set(['open','note','cases','notifications','settings','hide','reset','close'])
contextBridge.exposeInMainWorld('hasarbotuAssistantMenu',Object.freeze({
  choose: (command: unknown, caseId?: unknown) => {
    if (caseId !== undefined && (typeof caseId !== 'string' || caseId.length === 0 || caseId.length > 128)) return
    if (typeof command === 'string' && commands.has(command)) ipcRenderer.send('hasarbotu:assistant-menu',command,caseId)
  },
}))
contextBridge.exposeInMainWorld('hasarbotuCaseFolders', Object.freeze({
  open: (caseId: unknown) => ipcRenderer.invoke('hasarbotu:open-case-folder', caseId),
}))
contextBridge.exposeInMainWorld('hasarbotuAppearance', Object.freeze({
  set: (value: unknown) => ipcRenderer.invoke('hasarbotu:assistant-appearance', value),
  onReady: (callback: unknown) => {
    if (typeof callback !== 'function') throw new TypeError('Appearance callback must be a function')
    const listener = () => callback()
    ipcRenderer.on('hasarbotu:appearance-ready', listener)
    return () => ipcRenderer.removeListener('hasarbotu:appearance-ready', listener)
  },
}))
