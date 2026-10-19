import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { createAssistantPositionStore } from '../src/main/assistant-position.js'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, writeFile: vi.fn(actual.writeFile) }
})
const directories: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  vi.mocked(writeFile).mockRestore()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'hb-position-'))
  directories.push(directory)
  return { directory, file: join(directory, 'position.json') }
}

it('coalesces a keyboard burst into one atomic write of the latest position', async () => {
  const { file, directory } = await fixture()
  vi.useFakeTimers()
  const store = createAssistantPositionStore(file, vi.fn())
  for (let x = 0; x < 30; x++) store.save({ x, y: -20 })
  expect(writeFile).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(200)
  await store.flush()
  expect(writeFile).toHaveBeenCalledTimes(1)
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ x: 29, y: -20 })
  expect(await readdir(directory)).toEqual(['position.json'])
})

it('keeps slow writes sequential and flushes newer movement before shutdown completes', async () => {
  const { file } = await fixture()
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  vi.mocked(writeFile).mockImplementationOnce(async (...args) => { await blocked; await actual.writeFile(...args) })
  const store = createAssistantPositionStore(file, vi.fn())
  store.save({ x: 1, y: 2 })
  const flushing = store.flush()
  store.save({ x: 3, y: 4 })
  store.save({ x: 5, y: 6 })
  expect(store.flush()).toBe(flushing)
  expect(writeFile).toHaveBeenCalledTimes(1)
  release()
  await flushing
  expect(writeFile).toHaveBeenCalledTimes(2)
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ x: 5, y: 6 })
})

it('flushes the last movement immediately without waiting for the debounce timer', async () => {
  const { file } = await fixture()
  vi.useFakeTimers()
  const store = createAssistantPositionStore(file, vi.fn())
  store.save({ x: -100, y: 99 })
  await store.flush()
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ x: -100, y: 99 })
  expect(vi.getTimerCount()).toBe(0)
})

it('preserves the last good file and reports a failed background write without retrying in a loop', async () => {
  const { file, directory } = await fixture()
  const failed = vi.fn()
  const store = createAssistantPositionStore(file, failed)
  store.save({ x: 1, y: 1 })
  await store.flush()
  vi.mocked(writeFile).mockRejectedValueOnce(Object.assign(new Error('synthetic disk failure'), { code: 'ENOSPC' }))
  vi.useFakeTimers()
  store.save({ x: 2, y: 2 })
  await vi.advanceTimersByTimeAsync(200)
  // Awaiting the callback's microtasks also covers temporary-file cleanup.
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce())
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ x: 1, y: 1 })
  expect(await readdir(directory)).toEqual(['position.json'])
  expect(vi.getTimerCount()).toBe(0)
  await store.flush()
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ x: 2, y: 2 })
})
