import { contextBridge, ipcRenderer } from 'electron'

// Only the dedicated assistant window receives this surface. No channel name,
// URL, path, cursor coordinates or general Electron API comes from the renderer.
contextBridge.exposeInMainWorld('hasarbotuAssistant', Object.freeze({
  press: () => ipcRenderer.send('hasarbotu:assistant', 'press'),
  drag: () => ipcRenderer.send('hasarbotu:assistant', 'drag'),
  release: () => ipcRenderer.send('hasarbotu:assistant', 'release'),
  cancel: () => ipcRenderer.send('hasarbotu:assistant', 'cancel'),
  menu: () => ipcRenderer.send('hasarbotu:assistant', 'menu'),
  move: (direction: unknown) => {
    if (direction === 'left' || direction === 'right' || direction === 'up' || direction === 'down') {
      ipcRenderer.send('hasarbotu:assistant', direction)
    }
  },
}))
