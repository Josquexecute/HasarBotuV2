import { createCanvas, loadImage } from '@napi-rs/canvas'

/** Only small PNGs reach a native decoder; re-encoding strips metadata and trailing content. */
export async function sanitizeAssistantImage(value: string): Promise<string> {
  const bytes = Buffer.from(value.slice('data:image/png;base64,'.length), 'base64')
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(8) !== 13) throw new Error('invalid_assistant_image')
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  if (width < 1 || height < 1 || width > 256 || height > 256) throw new Error('invalid_assistant_image')
  // APNG can conceal additional large frames. Uploaded characters are deliberately static.
  let offset = 8
  let ended = false
  const chunks = [bytes.subarray(0, 8)]
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8)
    if (length > bytes.length - offset - 12 || kind === 'acTL' || kind === 'fcTL' || kind === 'fdAT') throw new Error('invalid_assistant_image')
    // Do not send compressed profiles/text to the native decoder. Only raster
    // chunks and transparency are needed after the browser's canvas conversion.
    if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(kind)) chunks.push(bytes.subarray(offset, offset + length + 12))
    else if (kind[0] === kind[0]?.toUpperCase()) throw new Error('invalid_assistant_image')
    offset += length + 12
    if (kind === 'IEND') { ended = true; break }
  }
  if (!ended) throw new Error('invalid_assistant_image')
  const image = await loadImage(Buffer.concat(chunks))
  if (image.width !== width || image.height !== height) throw new Error('invalid_assistant_image')
  const canvas = createCanvas(width, height)
  canvas.getContext('2d').drawImage(image, 0, 0)
  return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`
}
