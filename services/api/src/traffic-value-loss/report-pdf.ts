import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { GlobalFonts, PDFDocument, type CanvasRenderingContext2D } from '@napi-rs/canvas'
import type { TrafficValueLossReportContentDto, TrafficValueLossReportDto } from '@hasarbotu/contracts'

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const PAGE_MARGIN = 42
const CONTENT_WIDTH = PAGE_WIDTH - (PAGE_MARGIN * 2)
const FONT_FAMILY = 'HB Liberation Sans'
const COLOR = {
  ink: '#172033',
  secondary: '#475569',
  muted: '#64748b',
  border: '#cbd5e1',
  surface: '#f8fafc',
  accent: '#175cd3',
  accentSoft: '#eaf2ff',
  warning: '#9a3412',
  warningSoft: '#fff7ed',
}

let fontsReady = false
function registerFonts(): void {
  if (fontsReady) return
  const regular = fileURLToPath(import.meta.resolve('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'))
  const bold = fileURLToPath(import.meta.resolve('pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf'))
  GlobalFonts.registerFromPath(regular, FONT_FAMILY)
  GlobalFonts.registerFromPath(bold, FONT_FAMILY)
  fontsReady = true
}

function text(value: unknown): string {
  return Array.from(String(value ?? '—'))
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
    })
    .join('')
    .replace(/\u2011/g, '-')
}

function money(value: number | null): string {
  if (value === null) return '—'
  const whole = Math.floor(value / 100)
  const fraction = String(value % 100).padStart(2, '0')
  return `${whole.toLocaleString('tr-TR')},${fraction} TL`
}

function percentage(value: number | null): string {
  if (value === null) return '—'
  return `%${(value / 100).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

function dateTime(value: string): string {
  return new Date(value).toLocaleString('tr-TR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  })
}

function labelFor(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    calculable: 'Hesaplanabilir',
    no_value_loss: 'Değer kaybı yok',
    not_applicable: 'Uygulanmaz',
    control_required: 'Kontrol gerekli',
    pre_accident: 'Kaza öncesi',
    post_repair: 'Onarım sonrası',
    verified: 'Doğrulandı',
    document_version: 'Belge sürümü',
    market_comparable: 'Piyasa emsali',
    sbm_history: 'SBM geçmişi',
    expert_observation: 'Eksper gözlemi',
    repair_paint: 'Onarım + boya',
    replace_paint: 'Değişim + boya',
    paint: 'Boya',
    replace: 'Değişim',
    paintless_repair: 'Boyasız onarım',
    yes: 'Var',
    no: 'Yok',
    unknown: 'Belirsiz',
  }
  return labels[value] ?? value
}

function splitToken(context: CanvasRenderingContext2D, token: string, maxWidth: number): string[] {
  if (context.measureText(token).width <= maxWidth) return [token]
  const chunks: string[] = []
  let current = ''
  for (const character of Array.from(token)) {
    if (current.length > 0 && context.measureText(current + character).width > maxWidth) {
      chunks.push(current)
      current = character
    } else current += character
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

function wrap(context: CanvasRenderingContext2D, value: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text(value).split(/\r?\n/)) {
    const tokens = paragraph.split(/\s+/).filter(Boolean).flatMap((token) => splitToken(context, token, maxWidth))
    if (tokens.length === 0) {
      lines.push('')
      continue
    }
    let line = ''
    for (const token of tokens) {
      const candidate = line.length === 0 ? token : `${line} ${token}`
      if (line.length > 0 && context.measureText(candidate).width > maxWidth) {
        lines.push(line)
        line = token
      } else line = candidate
    }
    if (line.length > 0) lines.push(line)
  }
  return lines
}

interface PdfWriter {
  readonly document: PDFDocument
  context: CanvasRenderingContext2D
  y: number
  page: number
}

function beginPage(writer: PdfWriter, reportId: string): void {
  writer.page += 1
  writer.context = writer.document.beginPage(PAGE_WIDTH, PAGE_HEIGHT)
  const context = writer.context
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)
  context.fillStyle = COLOR.accent
  context.fillRect(0, 0, PAGE_WIDTH, 7)
  context.font = `700 9px "${FONT_FAMILY}"`
  context.fillStyle = COLOR.ink
  context.fillText('HASARBOTU V2', PAGE_MARGIN, 28)
  context.font = `8px "${FONT_FAMILY}"`
  context.fillStyle = COLOR.muted
  context.textAlign = 'right'
  context.fillText('Trafik Değer Kaybı Nihai Raporu', PAGE_WIDTH - PAGE_MARGIN, 28)
  context.textAlign = 'left'
  context.strokeStyle = COLOR.border
  context.beginPath()
  context.moveTo(PAGE_MARGIN, 37)
  context.lineTo(PAGE_WIDTH - PAGE_MARGIN, 37)
  context.stroke()
  context.font = `7px "${FONT_FAMILY}"`
  context.fillStyle = COLOR.muted
  context.fillText(`Rapor kimliği: ${reportId}`, PAGE_MARGIN, PAGE_HEIGHT - 22)
  context.textAlign = 'right'
  context.fillText(`Sayfa ${writer.page}`, PAGE_WIDTH - PAGE_MARGIN, PAGE_HEIGHT - 22)
  context.textAlign = 'left'
  writer.y = 54
}

function ensure(writer: PdfWriter, height: number, reportId: string): void {
  if (writer.y + height <= PAGE_HEIGHT - 42) return
  writer.document.endPage()
  beginPage(writer, reportId)
}

function paragraph(
  writer: PdfWriter,
  reportId: string,
  value: string,
  options: { readonly size?: number; readonly color?: string; readonly bold?: boolean; readonly indent?: number } = {},
): void {
  const size = options.size ?? 9
  const indent = options.indent ?? 0
  writer.context.font = `${options.bold === true ? '700 ' : ''}${size}px "${FONT_FAMILY}"`
  const lines = wrap(writer.context, value, CONTENT_WIDTH - indent)
  const lineHeight = size * 1.42
  ensure(writer, Math.max(lineHeight, lines.length * lineHeight) + 3, reportId)
  writer.context.fillStyle = options.color ?? COLOR.secondary
  for (const line of lines) {
    writer.context.fillText(line, PAGE_MARGIN + indent, writer.y)
    writer.y += lineHeight
  }
  writer.y += 3
}

function section(writer: PdfWriter, reportId: string, title: string, subtitle?: string): void {
  ensure(writer, subtitle === undefined ? 31 : 43, reportId)
  writer.y += 5
  writer.context.fillStyle = COLOR.accentSoft
  writer.context.fillRect(PAGE_MARGIN, writer.y - 13, CONTENT_WIDTH, subtitle === undefined ? 25 : 37)
  writer.context.fillStyle = COLOR.accent
  writer.context.fillRect(PAGE_MARGIN, writer.y - 13, 4, subtitle === undefined ? 25 : 37)
  writer.context.font = `700 11px "${FONT_FAMILY}"`
  writer.context.fillStyle = COLOR.ink
  writer.context.fillText(title, PAGE_MARGIN + 12, writer.y + 3)
  if (subtitle !== undefined) {
    writer.context.font = `8px "${FONT_FAMILY}"`
    writer.context.fillStyle = COLOR.muted
    writer.context.fillText(subtitle, PAGE_MARGIN + 12, writer.y + 17)
  }
  writer.y += subtitle === undefined ? 30 : 42
}

function keyValues(writer: PdfWriter, reportId: string, items: readonly (readonly [string, string])[]): void {
  const columns = 2
  const gap = 8
  const width = (CONTENT_WIDTH - gap) / columns
  for (let index = 0; index < items.length; index += columns) {
    const row = items.slice(index, index + columns)
    writer.context.font = `8px "${FONT_FAMILY}"`
    const heights = row.map(([, value]) => Math.max(18, wrap(writer.context, value, width - 18).length * 11 + 20))
    const height = Math.max(...heights)
    ensure(writer, height + 8, reportId)
    row.forEach(([label, value], column) => {
      const x = PAGE_MARGIN + (column * (width + gap))
      writer.context.fillStyle = COLOR.surface
      writer.context.strokeStyle = COLOR.border
      writer.context.fillRect(x, writer.y, width, height)
      writer.context.strokeRect(x, writer.y, width, height)
      writer.context.font = `700 7px "${FONT_FAMILY}"`
      writer.context.fillStyle = COLOR.muted
      writer.context.fillText(label.toLocaleUpperCase('tr-TR'), x + 8, writer.y + 12)
      writer.context.font = `9px "${FONT_FAMILY}"`
      writer.context.fillStyle = COLOR.ink
      const lines = wrap(writer.context, value, width - 16)
      lines.forEach((line, lineIndex) => writer.context.fillText(line, x + 8, writer.y + 27 + (lineIndex * 11)))
    })
    writer.y += height + 8
  }
}

function listItem(writer: PdfWriter, reportId: string, title: string, lines: readonly string[], warning = false): void {
  writer.context.font = `8px "${FONT_FAMILY}"`
  const wrapped = lines.flatMap((line) => wrap(writer.context, line, CONTENT_WIDTH - 28))
  const height = 26 + (wrapped.length * 11)
  ensure(writer, height + 6, reportId)
  writer.context.fillStyle = warning ? COLOR.warningSoft : COLOR.surface
  writer.context.strokeStyle = warning ? '#fdba74' : COLOR.border
  writer.context.fillRect(PAGE_MARGIN, writer.y, CONTENT_WIDTH, height)
  writer.context.strokeRect(PAGE_MARGIN, writer.y, CONTENT_WIDTH, height)
  writer.context.font = `700 9px "${FONT_FAMILY}"`
  writer.context.fillStyle = warning ? COLOR.warning : COLOR.ink
  writer.context.fillText(title, PAGE_MARGIN + 9, writer.y + 15)
  writer.context.font = `8px "${FONT_FAMILY}"`
  writer.context.fillStyle = COLOR.secondary
  wrapped.forEach((line, index) => writer.context.fillText(line, PAGE_MARGIN + 9, writer.y + 30 + (index * 11)))
  writer.y += height + 6
}

export function renderTrafficValueLossReportPdf(input: {
  readonly reportId: string
  readonly generatedAt: string
  readonly content: TrafficValueLossReportContentDto
}): Buffer {
  registerFonts()
  const document = new PDFDocument({ rasterDPI: 144 })
  const writer: PdfWriter = {
    document,
    context: undefined as unknown as CanvasRenderingContext2D,
    y: 0,
    page: 0,
  }
  beginPage(writer, input.reportId)
  const content = input.content

  writer.context.font = `700 20px "${FONT_FAMILY}"`
  writer.context.fillStyle = COLOR.ink
  writer.context.fillText(content.title, PAGE_MARGIN, writer.y + 10)
  writer.y += 29
  paragraph(writer, input.reportId,
    'Bu çıktı yalnız insan tarafından onaylanmış Trafik değer kaybı çalışma sürümünden üretilmiştir. Kaynaklar, emsaller, hesaplama ve belirsizlikler bu immutable snapshot içinde birlikte korunur.',
    { size: 9 })
  keyValues(writer, input.reportId, [
    ['Ofis dosya numarası', content.caseReference.officeNumber],
    ['Plaka', content.caseReference.plate],
    ['Hasar tarihi', content.caseReference.lossDate ?? '—'],
    ['İhbar tarihi', content.caseReference.notificationDate ?? '—'],
    ['Hesap sürümü', `v${content.assessment.assessmentVersion}`],
    ['Rapor üretim zamanı', dateTime(input.generatedAt)],
    ['Kural sürümü', content.rule.ruleVersion],
    ['Sonuç', labelFor(content.calculation.eligibilityStatus)],
  ])

  section(writer, input.reportId, 'Araç ve Hesaplama', 'Piyasa değer farkı ve kusur oranı insan onaylı sürümden alınır.')
  keyValues(writer, input.reportId, [
    ['Araç', [content.vehicle.make, content.vehicle.model, content.vehicle.variant].filter(Boolean).join(' ') || '—'],
    ['Model yılı / kilometre', `${content.vehicle.modelYear ?? '—'} / ${content.vehicle.mileage?.toLocaleString('tr-TR') ?? '—'} km`],
    ['Kullanım şekli', content.vehicle.usageType ?? '—'],
    ['Kusur oranı', percentage(content.calculation.faultRateBasisPoints)],
    ['Kaza öncesi piyasa değeri', money(content.calculation.preAccidentMarketValueMinor)],
    ['Onarım sonrası piyasa değeri', money(content.calculation.postRepairMarketValueMinor)],
    ['Brüt değer kaybı', money(content.calculation.grossValueLossMinor)],
    ['Kusur sonrası değer kaybı', money(content.calculation.faultAdjustedValueLossMinor)],
  ])
  content.calculation.reasoning.forEach((reason, index) =>
    listItem(writer, input.reportId, `Hesaplama gerekçesi ${index + 1}`, [reason]))

  section(writer, input.reportId, 'Hasarlı Parçalar', `${content.damageParts.length} kayıt`)
  if (content.damageParts.length === 0) paragraph(writer, input.reportId, 'Parça kaydı yok.')
  content.damageParts.forEach((part) => listItem(writer, input.reportId, `${part.partCode} · ${part.partName}`, [
    `İşlem: ${labelFor(part.repairAction)}`,
    `Önceki hasar: ${labelFor(part.priorDamage)}`,
  ], part.priorDamage === 'unknown'))

  section(writer, input.reportId, 'Piyasa Emsalleri',
    `${content.calculation.qualifyingPreComparableCount} nitelikli kaza öncesi · ${content.calculation.qualifyingPostComparableCount} nitelikli onarım sonrası`)
  if (content.comparables.length === 0) paragraph(writer, input.reportId, 'Emsal kaydı yok.')
  content.comparables.forEach((item) => listItem(writer, input.reportId,
    `${labelFor(item.side)} · ${money(item.amountMinor)}`,
    [
      `Tarih: ${item.observedAt} · Kilometre: ${item.mileage?.toLocaleString('tr-TR') ?? '—'}`,
      `Kanıt: ${item.evidenceKey} · Kaynak: ${item.sourceReference ?? '—'}`,
      item.excluded ? `Hariç tutuldu: ${item.exclusionReason ?? 'Gerekçe yok'}` : 'Değerlendirmeye dahil edildi.',
    ],
    item.excluded))

  section(writer, input.reportId, 'Kanıt ve Kaynak İzleri', `${content.evidence.length} kanıt`)
  content.evidence.forEach((item) => listItem(writer, input.reportId,
    `${item.evidenceKey} · ${labelFor(item.sourceType)}`,
    [
      `Doğrulama: ${labelFor(item.verificationStatus)} · Çelişki: ${item.conflict ? 'Var' : 'Yok'}`,
      `Desteklediği alanlar: ${item.supports.join(', ')}`,
      item.documentVersionId === null
        ? `Kaynak referansı: ${item.externalReference ?? '—'}`
        : `Belge: ${item.documentId} · Sürüm: ${item.documentVersionId}`,
      `Kaynak özeti: ${item.sourceHash.slice(0, 16)}…`,
    ],
    item.verificationStatus !== 'verified' || item.conflict))

  section(writer, input.reportId, 'Belirsizlikler', `${content.uncertainties.length} kayıt`)
  if (content.uncertainties.length === 0) {
    paragraph(writer, input.reportId, 'Onaylı sürümde açık belirsizlik bulunmuyor.', { bold: true, color: '#166534' })
  } else {
    content.uncertainties.forEach((item) => listItem(writer, input.reportId,
      `${item.code} · ${item.field}`,
      [item.reason, `Bloklayıcı: ${item.blocking ? 'Evet' : 'Hayır'} · İnsan kontrolü: Evet`],
      true))
  }

  section(writer, input.reportId, 'Kural ve Mevzuat Kaynakları', `${content.rule.ruleSetId} · ${content.rule.ruleVersion}`)
  content.rule.sources.forEach((item) => listItem(writer, input.reportId, item.title, [
    `${item.code} · ${item.locator}`,
    `Yayın: ${item.publishedAt} · Yürürlük: ${item.effectiveFrom}`,
    item.url,
  ]))

  section(writer, input.reportId, 'İnsan Onayı ve Nihai Not')
  keyValues(writer, input.reportId, [
    ['Onay zamanı', dateTime(content.assessment.approvedAt)],
    ['Onaylayan kullanıcı kimliği', content.assessment.approvedBy],
  ])
  paragraph(writer, input.reportId, `Onay gerekçesi: ${content.assessment.approvalReason ?? 'Gerekçe girilmedi.'}`)
  paragraph(writer, input.reportId, `Nihai rapor notu: ${content.reportNote ?? 'Ek rapor notu girilmedi.'}`)
  paragraph(writer, input.reportId,
    `Şema: ${content.schemaVersion} · Şablon: ${content.templateVersion}`,
    { size: 7, color: COLOR.muted })

  document.endPage()
  return Buffer.from(document.close())
}

export function hashTrafficValueLossReportPdf(pdf: Uint8Array): string {
  return createHash('sha256').update(pdf).digest('hex')
}

export function trafficValueLossReportFilename(report: Pick<TrafficValueLossReportDto, 'assessmentVersion'>): string {
  return `trafik-deger-kaybi-v${report.assessmentVersion}.pdf`
}
