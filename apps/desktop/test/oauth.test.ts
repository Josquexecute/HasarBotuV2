import { afterEach, expect, it, vi } from 'vitest'
import type { DesktopShell } from '../src/main/shell.js'
import { startOAuthReturn } from '../src/main/oauth.js'

const ipc = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: ipc }))
afterEach(() => vi.clearAllMocks())

it('restores and focuses only the trusted main renderer and removes the handler on close', () => {
  const frame = { url: 'http://127.0.0.1:4000/' }, contents = { mainFrame: null as unknown }
  contents.mainFrame = frame
  const window = { webContents: contents, isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn(), once: vi.fn() }
  startOAuthReturn({ window, origin: 'http://127.0.0.1:4000' } as unknown as DesktopShell)
  const handler = ipc.handle.mock.calls[0]![1] as (event: object) => void
  handler({ sender: contents, senderFrame: frame })
  expect(window.restore).toHaveBeenCalledOnce()
  expect(window.show).toHaveBeenCalledOnce()
  expect(window.focus).toHaveBeenCalledOnce()
  for (const event of [
    { sender: { mainFrame: frame }, senderFrame: frame },
    { sender: contents, senderFrame: { url: frame.url } },
  ]) expect(() => handler(event)).toThrow('Untrusted OAuth caller')
  frame.url = 'https://evil.example/'
  expect(() => handler({ sender: contents, senderFrame: frame })).toThrow('Untrusted OAuth caller')
  expect(window.focus).toHaveBeenCalledOnce()
  window.once.mock.calls[0]![1]()
  expect(ipc.removeHandler).toHaveBeenCalledWith('hasarbotu:oauth-focus')
})
