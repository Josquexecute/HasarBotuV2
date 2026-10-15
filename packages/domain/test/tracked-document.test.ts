import { describe, expect, it } from 'vitest'
import { inferTrackedDocumentType } from '../src/tracked-document.js'

describe('document names and photo folders', () => {
  it.each([
    ['OLAY YERİ.jpg', 'accident_scene_photo'], ['olay_yeri/IMG_001.jpg', 'accident_scene_photo'],
    ['VİTES FOTOĞRAFI.jpeg', 'gear_photo'], ['KM/DSC0102.jpg', 'odometer_photo'],
    ['kilometre.png', 'odometer_photo'], ['HASAR/IMG1234.jpg', 'damage_photo'],
    ['m ruhsat.pdf', 'victim_registration'], ['S_RUHSAT.jpg', 'insured_registration'],
    ['KASKO POLİÇESİ.pdf', 'casco_policy'], ['KTT.pdf', 'ktt'], ['M TRAFİK POLİÇESİ.pdf', 'victim_traffic_policy'],
    ['SBM AĞIR HASAR SONUCU.pdf', 'sbm_heavy_damage_result'],
    ['HASAR/KM.jpg', 'odometer_photo'],
  ])('classifies %s as %s', (name, expected) => {
    expect(inferTrackedDocumentType(name)).toBe(expected)
  })
  it.each(['IMG1234.jpg', 'ruhsat.pdf', 'hasar raporu.pdf', 'olay yeri ve vites.jpg', 'km hasar.jpg'])('keeps ambiguous or unspecified %s unclassified', name => {
    expect(inferTrackedDocumentType(name)).toBeNull()
  })
})
