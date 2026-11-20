import type { ValueLossCalculatorRequest, ValueLossCalculatorResponse } from '@hasarbotu/contracts'

const money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })
const amount = (minor: number | string) => money.format(Number(minor) / 100)
const escape = (value: string | number) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const operationLabels = { replacement: 'Değişim', repair: 'Onarım', paint: 'Boya' }
const repairLabels = { light: 'Hafif', medium: 'Orta', heavy: 'Ağır' }
const exclusionLabels: Record<string, string> = { previously_damaged: 'Önceden hasarlı', previously_repaired_detachable: 'Önceden onarımlı sökülebilir parça', previously_repaired_welded: 'Önceden onarımlı sabit parça; boya hariç', accessory: 'Aksesuar', superstructure: 'Üstyapı', plastic_or_unpainted: 'Plastik / boyasız panel', paintless_repair: 'Boyasız onarım' }

export function calculatorBreakdownRows(result: ValueLossCalculatorResponse): readonly (readonly [string, string])[] {
  const b = result.breakdown
  if (!b || result.amountMinor === null || result.issues.length) throw new Error('Hesap dökümü için güncel ve tamamlanmış hesaplama gerekir.')
  return [
    ['Araç yaşı / grup', `${b.vehicleAge} yıl / ${b.vehicleGroup}`],
    ['Yaş katsayısı (R)', b.ageCoefficient], ['Kullanım katsayısı (K)', b.usageCoefficient],
    ['Ticari / kiralık düzeltmesi', b.commercialModifier], ['Geçmiş hasar düzeltmesi', b.previousDamageModifier], ['Km alt sınır düzeltmesi', b.mileageModifier],
    ['Genel çarpan (1 + G)', b.generalMultiplier], ['Parça katsayıları toplamı (puan)', b.partCoefficient], ['Hasar / rayiç × 10 (puan)', b.damageContribution],
    ['Hasar katsayısı H = (parça + hasar puanı) / 100', b.damageCoefficient], ['Araç çarpanı', b.vehicleMultiplier],
    ['Ham referans tutar', amount(b.rawAmountMinor)], ['Excel referans tavanı (%30 rayiç)', `${amount(b.capMinor)}${b.capApplied ? ' — uygulandı' : ' — uygulanmadı'}`],
    ['Yuvarlama öncesi', amount(b.cappedAmountMinor)], ['500 TL katına yukarı yuvarlanmış brüt tahmin', amount(b.grossAmountMinor)],
    ['Karşı taraf kusuru', `%${b.faultRateBasisPoints / 100}`], ['Kusur uygulanmış tahmin', amount(result.amountMinor)],
  ]
}

export function calculatorPartRows(result: ValueLossCalculatorResponse): readonly (readonly string[])[] {
  const b = result.breakdown
  if (!b) return []
  return [
    ...b.parts.map(part => [part.label, `${operationLabels[part.operation]}${part.repairClass ? ' / ' + repairLabels[part.repairClass] : ''}`, part.coefficient, part.included ? 'Dahil' : exclusionLabels[part.exclusionReason ?? ''] ?? 'Hariç', `Tablolar, satır ${part.sourceRow}`]),
    ...b.baseOnlyParts.map(part => [part.label, 'Hasar tutarı üzerinden', '0', 'Ek parça / boya katsayısı yok', `Rehber ${part.principle}`]),
  ]
}

export function calculatorReportHtml(title: string, input: ValueLossCalculatorRequest, result: ValueLossCalculatorResponse): string {
  const rows = calculatorBreakdownRows(result)
  const b = result.breakdown!
  const table = (values: readonly (readonly (string | number)[])[], headers?: readonly string[]) => `<table>${headers ? '<thead><tr>' + headers.map(header => `<th scope="col">${escape(header)}</th>`).join('') + '</tr></thead>' : ''}<tbody>${values.map(row => '<tr>' + row.map(value => `<td>${escape(value)}</td>`).join('') + '</tr>').join('')}</tbody></table>`
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Değer kaybı hesap dökümü</title><style>
  body{font:14px/1.55 system-ui,Arial,sans-serif;color:#182530;margin:32px auto;padding:0 24px;max-width:1000px}h1{font-size:25px}h2{font-size:18px;margin-top:28px}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid #ccd3da;overflow-wrap:anywhere}th{background:#edf1f4}td:last-child{font-variant-numeric:tabular-nums}code{overflow-wrap:anywhere}p{overflow-wrap:anywhere}.note{border-left:3px solid #435c70;padding:10px 16px;background:#f3f5f7}@page{size:A4;margin:16mm}@media print{body{margin:0;padding:0;font-size:10pt}thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}a{color:inherit}}
  </style></head><body><h1>Değer kaybı hesap dökümü</h1><p>${escape(title)}</p><p class="note">Araç grubuna ait referans tahmindir. Piyasa araştırması ve onaylı eksper raporu yerine geçmez. %30 tavanı ve 500 TL yuvarlama kaynak Excel yöntemine aittir; yasal tazminat sınırı olarak yorumlanmaz.</p><h2>Hesap girdileri</h2>${table([
    ['Kaza tarihi', input.accidentDate], ['Araç', [input.vehicleIdentity?.manufacturer, input.vehicleIdentity?.model, input.vehicleType].filter(Boolean).join(' ')],
    ['Model yılı', input.modelYear ?? 'Belirtilmedi'], [b.vehicleGroup === 'D' ? 'Çalışma saati' : 'Kilometre', input.usageValue ?? 'Belirtilmedi'],
    ['Rayiç bedeli', amount(input.marketValueMinor)], ['Hesaba esas hasar tutarı', amount(input.damageAmountMinor)], ['Önceki hasar adedi', input.previousDamageCount ?? 'Bilinmiyor'], ['Ticari / kiralık', input.commercialOrRental ? 'Evet' : 'Hayır'],
  ])}<h2>Hesaplama</h2><p>DK = Rayiç × R × K × H × (1 + G) × Araç çarpanı. Hasar sıfırsa H sıfırdır. Ara işlemlerde yuvarlama yapılmaz. Brüt tahminden sonra karşı taraf kusuru uygulanır; sonuç kuruşa yuvarlanır.</p>${table(rows)}<h2>Parça ve işlem değerlendirmesi</h2>${table(calculatorPartRows(result), ['Parça', 'İşlem / sınıf', 'Katsayı puanı', 'Değerlendirme', 'Kaynak'])}<h2>Kaynak ve sınırlar</h2><p>${escape(b.sourceFileName)}<br>SHA-256: <code>${escape(b.sourceSha256)}</code><br>Kural sürümü: ${escape(result.ruleVersion)}</p><p>Rehber 3.4 ile Excel'in çeliştiği tam %15 ve %30 onarım sınırları otomatik hesaplanmaz. Çalışma saati 5.000 üzerindeki Excel başvuru hatasında tablodaki 0,70 esas alınır. Tam 1.000 TL katlarını sıfıra düşüren Excel yuvarlama hatası yerine rehberdeki 500 TL katına yukarı yuvarlama uygulanır.</p><p>Güncelleme kılavuzundaki Eksper Kanaati katsayısı V1 Excel’de tanımlı değildir; bu referans tahmin o katsayıyı içermez.</p><p>Piyasa dayanağı: son 30 gün içinde, ±%10 kullanım aralığında en az 3 uygun emsal; fiyat aykırılıkları ve pazarlık payı gerekçeli değerlendirilmelidir. Bu çıktı emsal doğrulaması veya eksper onayı sağlamaz.</p><p><a href="https://seddk.gov.tr/UploadContent/Documents/2026-11_Say%C4%B1l%C4%B1_Genelge.pdf">SEDDK 2026/11 rapor şablonları</a></p></body></html>`
}
