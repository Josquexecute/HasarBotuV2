import { parseV1PlateFolderName, type V1PlateFolderName } from './v1-import.js'

function parseInsurerPrefixedPlate(value: string): V1PlateFolderName | null {
  const matches = [...value.matchAll(/(?<![A-Z0-9])(\d{2}\s*[A-Z]{1,3}\s*\d{2,4})(?![A-Z0-9])/gu)]
  if (matches.length !== 1) return null
  const match = matches[0]!
  const prefix = value.slice(0, match.index).trim()
  // Office folders also put the insurer and claim number before the plate.
  // Require that label and one whole plate; another vehicle is ambiguous.
  if (!/^.+\s+S[İI]G[İI]?ORTA(?:\s|[-–—_])/u.test(prefix)) return null
  const plate = parseV1PlateFolderName(match[1]!)
  return plate === null ? null : { plate: plate.plate, suffix: `${prefix} ${value.slice(match.index! + match[0].length).trim()}`.trim() }
}

/** Physical folder annotations need not follow the historical V1 " - N" convention. */
export function parseSourcePlateFolderName(value: string): V1PlateFolderName | null {
  const historical = parseV1PlateFolderName(value)
  if (historical !== null) return historical.suffix !== null && /\d{2}\s*[A-Z]{1,3}\s*\d{2,4}/u.test(historical.suffix.toLocaleUpperCase('tr')) ? null : historical
  const match = /^(\d{2}\s*[A-Z]{1,3}\s*\d{2,4})(\s+.+|\s*\(.+\)|[-–—_]+.+)$/u.exec(value.trim().toLocaleUpperCase('tr'))
  if (match === null) return parseInsurerPrefixedPlate(value.trim().toLocaleUpperCase('tr'))
  // A label containing another plate is ambiguous; do not choose one silently.
  if (/\d{2}\s*[A-Z]{1,3}\s*\d{2,4}/u.test(match[2]!)) return null
  const plate = parseV1PlateFolderName(match[1]!)
  return plate === null ? null : { plate: plate.plate, suffix: match[2]!.trim() }
}

/** The insurer label describes this source folder; it is never a case identity. */
export function matchSourceFolderInsurer<T extends { readonly id: string; readonly name: string }>(folderName: string, insurers: readonly T[]): T | null {
  const suffix = parseSourcePlateFolderName(folderName)?.suffix
  if (!suffix) return null
  const normalize = (value: string) => value.toLocaleLowerCase('tr-TR').replace(/ı/gu, 'i').normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ').replace(/\b(?:sigorta|sigortasi|anonim|sirketi)\b/gu, '').replace(/\s+/gu, ' ').trim()
  const annotation = ` ${normalize(suffix)} `
  const matches = insurers.filter(insurer => {
    const name = normalize(insurer.name)
    return name.length > 1 && annotation.includes(` ${name} `)
  })
  return matches.length === 1 ? matches[0]! : null
}
