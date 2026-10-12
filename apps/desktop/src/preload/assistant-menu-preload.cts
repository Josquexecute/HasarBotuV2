import { contextBridge,ipcRenderer } from 'electron'

const commands = new Set(['open','note','cases','notifications','settings','hide','reset','quit','close'])
contextBridge.exposeInMainWorld('hasarbotuAssistantMenu',Object.freeze({
  choose: (command: unknown) => {
    if (typeof command === 'string' && commands.has(command)) ipcRenderer.send('hasarbotu:assistant-menu',command)
  },
}))
