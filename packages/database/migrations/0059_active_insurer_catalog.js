export const shorthands = undefined

// SEDDK, 11.09.2026: hayat dışı branşında faaliyet gösteren şirketler.
// https://seddk.gov.tr/tr/kuruluslar/sigorta-reasurans-ve-bes-sirketleri
// Existing names, revisions and inactive entries are deliberately preserved.
export const insurerNames = [
  'AK Sigorta A.Ş.', 'Allianz Sigorta A.Ş.', 'Anadolu Anonim Türk Sigorta Şirketi',
  'Ankara Anonim Türk Sigorta Şirketi', 'Atradius Credit Insurance N.V. Türkiye İstanbul Şubesi',
  'AXA Sigorta A.Ş.', 'Bereket Sigorta A.Ş.', 'BUPA Acıbadem Sigorta A.Ş.',
  'BNP Paribas Cardif Sigorta A.Ş.', 'CHUBB European Group SE Türkiye İstanbul Şubesi',
  'Coface Sigorta A.Ş.', 'Doğa Sigorta A.Ş.', 'VHV Allgemeine Sigorta A.Ş.',
  'Ethica Sigorta A.Ş.', 'Euler Hermes Sigorta A.Ş.', 'Eureko Sigorta A.Ş.',
  'Referans Sigorta A.Ş.', 'GIG Sigorta A.Ş.', 'HDI Sigorta A.Ş.', 'Koru Sigorta A.Ş.',
  'Magdeburger Sigorta A.Ş.', 'Mapfre Sigorta A.Ş.', 'Neova Katılım Sigorta A.Ş.',
  'Orient Sigorta A.Ş.', 'Quick Sigorta A.Ş.', 'Ray Sigorta A.Ş.',
  'S.S. Atlas Sigorta Kooperatifi', 'Şeker Sigorta A.Ş.', 'Sompo Sigorta A.Ş.',
  'Corpus Sigorta A.Ş.', 'Türk Nippon Sigorta A.Ş.', 'Türk P&I Sigorta A.Ş.',
  'Unico Sigorta A.Ş.', 'Zurich Sigorta A.Ş.', 'Ana Sigorta A.Ş.',
  'Türkiye Katılım Sigorta A.Ş.', 'Türkiye Sigorta A.Ş.', 'Prive Sigorta A.Ş.',
  'Hepiyi Sigorta A.Ş.', 'Emaa Sigorta A.Ş.', 'HDI Katılım Sigorta A.Ş.',
  'Turkcell Dijital Sigorta A.Ş.', 'Fiba Sigorta A.Ş.', 'Global World Sigorta A.Ş.',
  'Medisa Sigorta A.Ş.',
]
export function up(pgm) {
  const values = insurerNames.map(name => `('${name.replaceAll("'", "''")}')`).join(',')
  pgm.sql(`INSERT INTO insurers(id,organization_id,name,is_active)
    SELECT gen_random_uuid(),o.id,c.name,true FROM organizations o CROSS JOIN (VALUES ${values}) c(name)
    WHERE NOT EXISTS (SELECT 1 FROM insurers i WHERE i.organization_id=o.id AND lower(btrim(i.name))=lower(c.name))
    ON CONFLICT(organization_id,name) DO NOTHING`)
}
export function down() {
  throw new Error('Insurer catalogue contains editable business references; automatic deletion is unsafe.')
}
