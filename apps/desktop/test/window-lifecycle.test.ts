import { EventEmitter } from 'node:events'
import type { App, BrowserWindow } from 'electron'
import { expect, it, vi } from 'vitest'
import { hideToTrayOnClose } from '../src/main/window-lifecycle.js'

it('hides close attempts to the tray, permits explicit quit and removes the app listener on disposal', () => {
  const app = new EventEmitter()
  const window = Object.assign(new EventEmitter(), { hide: vi.fn(), minimize: vi.fn() })
  hideToTrayOnClose(app as App, window as unknown as BrowserWindow)
  const preventDefault = vi.fn()
  window.emit('close', { preventDefault })
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(window.hide).toHaveBeenCalledOnce()
  expect(window.minimize).not.toHaveBeenCalled()
  app.emit('before-quit')
  window.emit('close', { preventDefault })
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(window.hide).toHaveBeenCalledOnce()
  window.emit('closed')
  expect(app.listenerCount('before-quit')).toBe(0)
})
it('allows Windows session shutdown', () => {
  const app = new EventEmitter()
  const window = Object.assign(new EventEmitter(), { hide: vi.fn() })
  hideToTrayOnClose(app as App, window as unknown as BrowserWindow)
  window.emit('query-session-end')
  const preventDefault = vi.fn()
  window.emit('close', { preventDefault })
  expect(preventDefault).not.toHaveBeenCalled()
  expect(window.hide).not.toHaveBeenCalled()
})
