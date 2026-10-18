import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const output = resolve('.local/field-edge/site')
await mkdir(output, { recursive: true })
await build({
  entryPoints: ['deploy/cloudflare/field-portal-worker.mjs'],
  outfile: join(output, '_worker.js'),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
})
await writeFile(join(output, '_routes.json'), JSON.stringify({ version: 1, include: ['/*'], exclude: [] }))
await writeFile(join(output, 'index.html'), '<!doctype html><html lang="tr"><meta charset="utf-8"><title>HasarBotu</title><p>Saha portalı şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.</p></html>')
console.log('Public field edge bundle ready:', output)
