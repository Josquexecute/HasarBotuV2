import { parseV1PlateFolderName, type V1PlateFolderName } from './v1-import.js'

/** Physical folder annotations need not follow the historical V1 " - N" convention. */
export function parseSourcePlateFolderName(value: string): V1PlateFolderName | null {
  const historical = parseV1PlateFolderName(value)
  if (historical !== null) return historical.suffix !== null && /\d{2}\s*[A-Z]{1,3}\s*\d{2,4}/u.test(historical.suffix.toLocaleUpperCase('tr')) ? null : historical
  const match = /^(\d{2}\s*[A-Z]{1,3}\s*\d{2,4})(\s+.+|\s*\(.+\)|-{2,}.+)$/u.exec(value.trim().toLocaleUpperCase('tr'))
  if (match === null) return null
  // A label containing another plate is ambiguous; do not choose one silently.
  if (/\d{2}\s*[A-Z]{1,3}\s*\d{2,4}/u.test(match[2]!)) return null
  const plate = parseV1PlateFolderName(match[1]!)
  return plate === null ? null : { plate: plate.plate, suffix: match[2]!.trim() }
}
