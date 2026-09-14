import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'
import { expect, it } from 'vitest'

it('Vite watches UI source without watching installers or local database files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hb-watch-test-'))
  let server: ViteDevServer | undefined
  try {
    for (const path of ['src', 'apps/desktop/release/win-unpacked', '.local/database']) {
      await mkdir(join(root, path), { recursive: true })
      await writeFile(join(root, path, 'fixture.txt'), 'synthetic test file')
    }
    server = await createServer({
      root, configFile: fileURLToPath(new URL('../../../vite.config.ts', import.meta.url)),
      server: { middlewareMode: true }, logLevel: 'silent',
    })
    const deadline = Date.now() + 5000
    while (!server.watcher.getWatched()[join(root, 'src')]?.includes('fixture.txt')) {
      if (Date.now() > deadline) throw new Error('Vite source watcher did not become ready')
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const watched = Object.keys(server.watcher.getWatched()).map((path) => path.replaceAll('\\', '/'))
    expect(watched.some((path) => path.includes('/release') || path.includes('/.local'))).toBe(false)
    // The rename which failed during live packaging must remain possible while Vite runs.
    await rename(join(root, 'apps/desktop/release/win-unpacked'), join(root, 'apps/desktop/release/renamed'))
    expect(server.watcher.getWatched()[join(root, 'src')]).toContain('fixture.txt')
  } finally {
    await server?.close()
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
