import { createHash } from 'node:crypto'
import { open, readFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { desktopReleaseSchema } from '@hasarbotu/contracts'
import { createAuthStore } from '../auth/store.js'
import { requireSession } from '../auth/guard.js'
import { failureBody } from '../errors/failure.js'

export function registerDesktopUpdateRoutes(app: FastifyInstance, options: { pool: pg.Pool; directory?: string }) {
  const auth = createAuthStore(options.pool)
  async function latest() {
    if (!options.directory) return null
    const directory = await realpath(options.directory)
    const manifest = join(directory, 'latest.json')
    if (await realpath(manifest) !== manifest) throw new Error('Release manifest must not be a symlink')
    return desktopReleaseSchema.parse(JSON.parse(await readFile(manifest, 'utf8')))
  }
  app.get('/api/v1/desktop-updates/latest', async (request, reply) => {
    if (!await requireSession(auth, request, reply)) return
    try { return { release: await latest() } }
    catch { return reply.code(503).send(failureBody('service_unavailable', 'Güncelleme yayını doğrulanamadı.', String(request.id))) }
  })
  app.get<{ Params: { sha256: string } }>('/api/v1/desktop-updates/artifacts/:sha256', async (request, reply) => {
    if (!await requireSession(auth, request, reply)) return
    const hash = request.params.sha256
    if (!/^[a-f0-9]{64}$/.test(hash)) return reply.code(404).send()
    let handle
    try {
      const release = await latest()
      if (!release || release.sha256 !== hash || !options.directory) return reply.code(404).send()
      const directory = await realpath(options.directory), path = resolve(directory, `${hash}.exe`)
      if (await realpath(path) !== path) throw new Error('Release artifact must not be a symlink')
      handle = await open(path, 'r')
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size !== release.size) throw new Error('Release artifact size mismatch')
      const digest = createHash('sha256')
      // Verify the same open file that will be streamed, before any executable bytes are served.
      for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk)
      if (digest.digest('hex') !== hash) throw new Error('Release artifact digest mismatch')
      const stream = handle.createReadStream({ start: 0, autoClose: true })
      handle = undefined
      return reply.header('content-type', 'application/octet-stream').header('content-length', release.size)
        .header('cache-control', 'no-store').header('content-disposition', `attachment; filename="HasarBotu-Setup-${release.version}.exe"`).send(stream)
    } catch {
      await handle?.close()
      return reply.code(503).send(failureBody('service_unavailable', 'Güncelleme dosyası doğrulanamadı.', String(request.id)))
    }
  })
}
