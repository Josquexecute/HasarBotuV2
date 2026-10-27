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
contextBridge.exposeInMainWorld('hasarbotuTouch', Object.freeze({
  control: (value: unknown) => ipcRenderer.invoke('hasarbotu:touch-control', value),
  getState: () => ipcRenderer.invoke('hasarbotu:touch-state'),
  onState: (callback: unknown) => {
    if (typeof callback !== 'function') throw new TypeError('Touch callback must be a function')
    const listener = (_event: unknown, value: unknown) => callback(value)
    ipcRenderer.on('hasarbotu:touch-state', listener)
    return () => ipcRenderer.removeListener('hasarbotu:touch-state', listener)
  },
}))
contextBridge.exposeInMainWorld('hasarbotuAssistantFeedback', Object.freeze({
  noteSaved: () => ipcRenderer.send('hasarbotu:assistant-success'),
  activity: (id: unknown, phase: unknown, message?: unknown) => ipcRenderer.send('hasarbotu:assistant-feedback', { type: 'activity', id, phase, message }),
  taskCompleted: () => ipcRenderer.send('hasarbotu:assistant-feedback', { type: 'completed' }),
  notificationReceived: () => ipcRenderer.send('hasarbotu:assistant-feedback', { type: 'notification' }),
}))
