import { CANONICAL_DOCUMENT_TYPES } from './document-requirements.js'

export const TRACKED_DOCUMENT_TYPES = [
  ...CANONICAL_DOCUMENT_TYPES,
  'accident_scene_photo', 'gear_photo', 'odometer_photo', 'damage_photo', 'other_document',
] as const
export type TrackedDocumentType = (typeof TRACKED_DOCUMENT_TYPES)[number]

export const TRACKED_DOCUMENT_LABELS: Readonly<Record<TrackedDocumentType, string>> = {
  victim_traffic_policy: 'Mağdur trafik poliçesi', insured_traffic_policy: 'Sigortalı trafik poliçesi',
  sbm_heavy_damage_result: 'SBM ağır hasar sonucu', victim_registration: 'Mağdur ruhsat',
  insured_registration: 'Sigortalı ruhsat', victim_driver_license: 'Mağdur ehliyet', insured_driver_license: 'Sigortalı ehliyet',
  casco_policy: 'Kasko poliçesi', casco_vehicle_registration: 'Kasko ruhsat', casco_driver_license: 'Kasko ehliyet',
  accident_report: 'Zabıt', ktt: 'Kaza tespit tutanağı', statement: 'Beyan', tramer_result: 'Tramer sonucu',
  opposing_vehicle_registration: 'Karşı araç ruhsat', opposing_driver_license: 'Karşı sürücü ehliyet',
  opposing_traffic_policy: 'Karşı araç trafik poliçesi', fault_ratio: 'Kusur oranı',
  accident_scene_photo: 'Olay yeri fotoğrafı', gear_photo: 'Vites fotoğrafı', odometer_photo: 'KM fotoğrafı',
  damage_photo: 'Hasar fotoğrafı', other_document: 'Diğer evrak / fotoğraf',
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('tr-TR').replace(/ı/gu, 'i').normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ').trim()
}

/** Names classify metadata only; they never approve a document or satisfy a requirement. */
export function inferTrackedDocumentType(relativePath: string): TrackedDocumentType | null {
  // The closest named folder supplies context for camera-generated filenames.
  const segments = relativePath.split(/[\\/]/u).reverse()
  for (const segment of segments) {
    const name = normalize(segment.replace(/\.[^.]+$/u, ''))
    const matches = new Set<TrackedDocumentType>()
    if (/\bolay\s*yeri\b|\bkaza\s*yeri\b/u.test(name)) matches.add('accident_scene_photo')
    if (/\bvites\b/u.test(name)) matches.add('gear_photo')
    if (/\bkm\b|\bkilometre\b|\bkilometer\b/u.test(name)) matches.add('odometer_photo')
    if (/\bhasar\b/u.test(name) && !/\bagir\s+hasar\b|\bhasar\s+(?:rapor|dosya|tespit)/u.test(name)) matches.add('damage_photo')
    if (/\bktt\b|\bkaza\s+tespit\s+tutanagi\b/u.test(name)) matches.add('ktt')
    if (/\bzabit\b|\bpolis\s+tutanagi\b/u.test(name)) matches.add('accident_report')
    if (/\bbeyan\b/u.test(name)) matches.add('statement')
    if (/\btramer\b/u.test(name)) matches.add('tramer_result')
    if (/\bkusur\b/u.test(name)) matches.add('fault_ratio')
    if (/\bagir\s+hasar\b/u.test(name) && /\bsbm\b|\bsorgu\b|\bsonuc/u.test(name)) matches.add('sbm_heavy_damage_result')
    const party = /\bmagdur\b|\bm\b/u.test(name) ? 'victim'
      : /\bkarsi\b/u.test(name) ? 'opposing'
        : /\bsigortali\b|\bs\b/u.test(name) ? 'insured'
          : /\bkasko\b|\bk\b/u.test(name) ? 'casco' : null
    if (/\bruhsat\b/u.test(name) && party) matches.add(party === 'casco' ? 'casco_vehicle_registration' : party === 'opposing' ? 'opposing_vehicle_registration' : `${party}_registration`)
    if (/\behliyet\b/u.test(name) && party) matches.add(party === 'casco' ? 'casco_driver_license' : `${party}_driver_license`)
    if (/\bpolice\b|\bpolicesi\b/u.test(name)) {
      if (party === 'casco') matches.add('casco_policy')
      else if (party) matches.add(`${party}_traffic_policy`)
    }
    if (matches.size > 1) return null
    if (matches.size === 1) return [...matches][0]!
  }
  return null
}
