import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import type { Point } from './assistant-policy.js'

/** Coalesce movement while keeping atomic replacements strictly sequential. */
export function createAssistantPositionStore(file: string, onError: (error: unknown) => void) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  let pending: Point | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let writing: Promise<void> | undefined

  const flush = (): Promise<void> => {
    clearTimeout(timer)
    timer = undefined
    if (writing) return writing
    if (!pending) return Promise.resolve()
    writing = (async () => {
      while (pending) {
        const value = pending
        pending = undefined
        try {
          await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
          await rename(temporary, file)
        } catch (error) {
          pending ??= value
          throw error
        } finally {
          await rm(temporary, { force: true })
        }
      }
    })().finally(() => { writing = undefined })
    return writing
  }

  return {
    save(point: Point) {
      pending = { x: point.x, y: point.y }
      clearTimeout(timer)
      timer = setTimeout(() => { void flush().catch(onError) }, 200)
    },
    flush,
  }
}
