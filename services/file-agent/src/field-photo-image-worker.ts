import { readFile, writeFile } from 'node:fs/promises'
import { convertFieldPhoto } from './field-photo-image.js'

try {
  const result = await convertFieldPhoto(await readFile(process.argv[2]!))
  await writeFile(process.argv[3]!, result.bytes, { flag: 'wx' })
  process.stdout.write(JSON.stringify({ width: result.width, height: result.height }))
} catch (error) {
  const message = error instanceof Error ? error.message : ''
  process.stdout.write(JSON.stringify({ error: ['image_too_large','unsupported_image'].includes(message) ? message : 'image_conversion_failed' }))
  process.exitCode = 1
}
