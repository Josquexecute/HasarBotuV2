/** Label-based extraction shared by clipboard, PDF text and OCR. Raw text remains evidence. */
export function eksistKey(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').toLowerCase().replace(/[^a-z0-9]/g, '')
}

const LABELS = [
  'Talep İşlem Ref No', 'Atama Tipi', 'Atama Şekli', 'Hasar Tipi', 'İtiraz Tipi',
  'Ürün', 'Sigortalı TC Kimlik No', 'Sigortalı Ad/Ünvan', 'Sigortalı Soyad', 'Sigorta Şirketi',
  'Poliçe No', 'Acente No', 'Yenileme No', 'Poliçe Vadesi', 'Hasar Dosya No', 'Hasar Zamanı', 'Hasar Tarihi',
  'Hasar Nedeni', 'İl', 'İlçe', 'Plaka', 'Model Yılı', 'Marka', 'Araç Tarife Grubu', 'Araç Tipi',
  'Motor No', 'Şasi No', 'Renk', 'Yakıt Tipi', 'Vites Tipi', 'Kullanım Şekli', 'Kullanım Amacı',
  'Silindir Hacmi', 'Motor Gücü', 'Koltuk Sayısı', 'İlk Tescil Tarihi', 'Tescil Tarihi', 'Tip / Varyant / Versiyon',
  'Eposta', 'Cep Telefonu', 'Kimlik Tipi', 'Kimlik No', 'Ad/Ünvan', 'Soyad', 'İş Telefonu',
  'Ekspertiz Yeri Ad/Ünvan', 'Ekspertiz Yeri Soyad', 'Ekspertiz Yeri Kimlik Tipi', 'Ekspertiz Yeri Kimlik No',
  'Belde', 'Mahalle', 'Cadde', 'Sokak', 'Telefon', 'Açık Adres', 'Tamirhane Ad / Ünvan', 'Tamirhane Soyad',
  'Tamirhane Kimlik Türü', 'Tamirhane Kimlik No', 'Levha No', 'Eksper Ad-Soyad', 'Atayan Tip', 'Atama Durumu',
  'Tüzel Eksper Levha No', 'Red Nedeni', 'Eksper Atama Tarihi', 'SBM Eksper Rapor No',
  'Sigorta Şirketi İtiraz Mı', 'Sigortalı İtiraz Mı', 'Yeni Durum',
] as const
const HEADINGS = /(?:Hatmer Eksist Uygulaması|Talep Detayı|Sigortalı Poliçe Bilgileri|Hasar Detay Bilgileri|Eksper Atanacak Araç Bilgileri|Atama Yapan İletişim Bilgileri|Ekspertiz Yeri Bilgileri|Tamirhane Yeri Bilgileri|Eksper Bilgileri|Ağır Hasar bilgileri|İşlemler)/giu
const labelPattern = LABELS.slice().sort((a, b) => b.length - a.length).map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*').replace(/\//g, '\\s*/\\s*')).join('|')
const pattern = new RegExp(`(${labelPattern})\\s*[:：]`, 'giu')

export interface EksistExtraction {
  reference: string
  fields: Record<string, string>
  conflicts: string[]
  caseType: 'traffic' | 'casco' | null
  plate: string
  claimNumber: string
  lossDate: string
  insurer: string
  service: string
  expert: string
  assignmentDate: string
  assignmentDateText: string
  expertLicenseNumber: string
  corporateExpertLicenseNumber: string
  engineNumber: string
  chassisNumber: string
  vehicleFields: Record<string, string>
  brand: string
  model: string
  modelYear: string
  vehicleClass: 'passenger_car' | 'light_commercial' | 'heavy_commercial' | 'motorcycle' | 'trailer' | 'other' | ''
}

export const EKSIST_VEHICLE_LABELS = ['Plaka', 'Marka', 'Araç Tipi', 'Model Yılı', 'Araç Tarife Grubu', 'Motor No', 'Şasi No', 'Renk', 'Yakıt Tipi', 'Vites Tipi', 'Kullanım Şekli', 'Kullanım Amacı', 'Silindir Hacmi', 'Motor Gücü', 'Koltuk Sayısı', 'İlk Tescil Tarihi', 'Tescil Tarihi', 'Tip / Varyant / Versiyon'] as const

function sourceDate(value: string): string {
  const local = /^(\d{2})[/.](\d{2})[/.](\d{4})(?:\s|$)/.exec(value)
  const iso = local ? `${local[3]}-${local[2]}-${local[1]}` : /^\d{4}-\d{2}-\d{2}(?:[ T]|$)/.test(value) ? value.slice(0, 10) : ''
  if (!iso) return ''
  const parsed = new Date(`${iso}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : ''
}

export function parseEksist(text: string): EksistExtraction {
  const clean = text.replace(HEADINGS, '\u0000').replace(/https?:\/\/\S+/g, '')
  const matches = [...clean.matchAll(pattern)]
  const fields: Record<string, string> = {}, conflicts: string[] = []
  matches.forEach((match, index) => {
    const label = eksistKey(match[1]!)
    const value = clean.slice(match.index! + match[0].length, matches[index + 1]?.index ?? clean.length).trim().split('\u0000')[0]!.split(/©|Kayıt bulunamadı/)[0]!.trim().replace(/\s+/g, ' ')
    if (fields[label] && value && fields[label] !== value) conflicts.push(label)
    fields[label] ??= value
  })
  const get = (label: string) => fields[eksistKey(label)] ?? ''
  const rawPlate = get('Plaka').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0(?=\d{2}[A-Z])/, '')
  const plate = rawPlate.replace(/^(\d{2})([A-Z]{1,3})(\d{2,4})$/, '$1 $2 $3')
  const date = get('Hasar Zamanı') || get('Hasar Tarihi')
  const lossDate = sourceDate(date)
  const classes: Record<string, EksistExtraction['vehicleClass']> = { otomobil: 'passenger_car', kamyonet: 'light_commercial', kamyon: 'heavy_commercial', otobus: 'heavy_commercial', motosiklet: 'motorcycle', romork: 'trailer' }
  return {
    reference: get('Talep İşlem Ref No'), fields, conflicts,
    caseType: eksistKey(get('Ürün')) === 'trafik' ? 'traffic' : eksistKey(get('Ürün')) === 'kasko' ? 'casco' : null,
    plate, claimNumber: get('Hasar Dosya No'), lossDate,
    insurer: get('Sigorta Şirketi'), service: [get('Tamirhane Ad / Ünvan'), get('Tamirhane Soyad')].filter(Boolean).join(' '),
    expert: get('Eksper Ad-Soyad'), brand: get('Marka'), model: get('Araç Tipi'), modelYear: get('Model Yılı'),
    assignmentDate: sourceDate(get('Eksper Atama Tarihi')), assignmentDateText: get('Eksper Atama Tarihi'),
    expertLicenseNumber: get('Levha No'), corporateExpertLicenseNumber: get('Tüzel Eksper Levha No'),
    engineNumber: get('Motor No'), chassisNumber: get('Şasi No'),
    vehicleFields: Object.fromEntries(EKSIST_VEHICLE_LABELS.filter(label => get(label)).map(label => [label, get(label)])),
    vehicleClass: classes[eksistKey(get('Araç Tarife Grubu'))] ?? '',
  }
}

/** Only unique canonical names are accepted; approximate matches require an explicit choice. */
export function matchEksistReference(value: string, options: readonly { id: string; name: string }[], company = false): string | null {
  if (!value) return null
  const normalize = (name: string) => {
    const plain = name.normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').toLowerCase()
    return eksistKey(company ? plain.replace(/\s+(?:anonim\s+sirketi|a\.?\s*s\.?)$/, '') : plain)
  }
  const matches = options.filter(option => normalize(option.name) === normalize(value))
  return matches.length === 1 ? matches[0]!.id : null
}
