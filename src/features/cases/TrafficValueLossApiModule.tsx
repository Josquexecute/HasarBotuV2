import { canUsePermission } from '../../app/permissions'
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  CirclePlus,
  FileCheck2,
  History,
  LoaderCircle,
  RefreshCw,
  Scale,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CaseDocumentsDataPort, DataSourceKind } from '../../data/ports'
import type { TrafficValueLossComparableInput, TrafficValueLossDamagePartInput, TrafficValueLossDataPort, TrafficValueLossDraftInput, TrafficValueLossEvidenceField, TrafficValueLossEvidenceInput, TrafficValueLossRealMarketPartInput, TrafficValueLossVersionRecord } from '../../data/trafficValueLossPort'
import type { TrafficValueLossReportDataPort } from '../../data/trafficValueLossReportPort'
import { useCaseDocuments } from '../../data/useCaseDocuments'
import { useTrafficValueLoss } from '../../data/useTrafficValueLoss'
import { useSession } from '../../app/sessionContext'
import type { CaseRecord } from '../../types/case'
import { TrafficValueLossReportPanel } from './TrafficValueLossReportPanel'

interface ComparableDraft {
  readonly id: string
  readonly side: 'pre_accident' | 'post_repair'
  readonly amount: string
  readonly mileage: string
  readonly observedAt: string
  readonly reference: string
  readonly verified: boolean
  readonly conflict: boolean
  readonly excluded: boolean
  readonly exclusionReason: string
}

interface DamagePartDraft {
  readonly id: string
  readonly partCode: string
  readonly partName: string
  readonly repairAction: TrafficValueLossDamagePartInput['repairAction']
  readonly priorDamage: TrafficValueLossDamagePartInput['priorDamage']
}

interface RealMarketPartDraft extends TrafficValueLossRealMarketPartInput {
  readonly id: string
  readonly label: string
}

const VEHICLE_GROUPS = {
  'OTOMOBİL': 'A', 'TAKSİ': 'A', 'MİNİBÜS': 'B', 'OTOBÜS': 'B',
  'KAMYONET': 'C', 'KAMYON': 'C', 'ÇEKİCİ': 'C', 'İŞ MAKİNESİ': 'D',
  'TRAKTÖR': 'D', 'TARIM MAKİNESİ': 'D', 'ÖZEL AMAÇLI ARAÇ': 'Ç',
  'RÖMORK': 'E', 'MOTORSİKLET': 'F', 'TANKER': 'Ç',
} as const

const STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'Taslak',
  control_required: 'Kontrol gerekli',
  awaiting_approval: 'Onay bekliyor',
  approved: 'Onaylı',
  rejected: 'Reddedildi',
  superseded: 'Eski sürüm',
  calculable: 'Hesaplanabilir',
  no_value_loss: 'Değer kaybı yok',
  not_applicable: 'Uygulanmaz',
}

const SUPPORT_OPTIONS: readonly { readonly value: TrafficValueLossEvidenceField; readonly label: string }[] = [
  { value: 'vehicle_identity', label: 'Araç kimliği' },
  { value: 'mileage', label: 'Kilometre' },
  { value: 'usage_type', label: 'Kullanım' },
  { value: 'damage_parts', label: 'Hasarlı parçalar' },
  { value: 'prior_damage', label: 'Önceki hasar' },
  { value: 'fault_rate', label: 'Kusur' },
  { value: 'heavy_damage_status', label: 'Ağır/tam hasar' },
]

const DOCUMENT_LABELS: Readonly<Record<string, string>> = {
  expert_report: 'Ekspertiz raporu',
  sbm_heavy_damage_result: 'SBM Ağır Hasar sonucu',
  victim_registration: 'Mağdur ruhsat',
  victim_traffic_policy: 'Mağdur trafik poliçesi',
  tramer_result: 'Tramer sonucu',
  fault_ratio: 'Kusur oranı',
}

let localRowSequence = 0
function rowId(prefix: string): string {
  localRowSequence += 1
  return `${prefix}-${Date.now()}-${localRowSequence}`
}

function todayLocalDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function emptyComparable(side: ComparableDraft['side']): ComparableDraft {
  return {
    id: rowId(side === 'pre_accident' ? 'pre' : 'post'),
    side,
    amount: '',
    mileage: '',
    observedAt: todayLocalDate(),
    reference: '',
    verified: false,
    conflict: false,
    excluded: false,
    exclusionReason: '',
  }
}

function defaultComparables(realMarket = true): readonly ComparableDraft[] {
  return [
    emptyComparable('pre_accident'), emptyComparable('pre_accident'), emptyComparable('pre_accident'),
    ...(realMarket ? [] : [emptyComparable('post_repair'), emptyComparable('post_repair'), emptyComparable('post_repair')]),
  ]
}

function emptyDamagePart(): DamagePartDraft {
  return {
    id: rowId('part'),
    partCode: '',
    partName: '',
    repairAction: 'repair_paint',
    priorDamage: 'unknown',
  }
}

function nullableText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function nullableInteger(value: string): number | null {
  if (value.trim().length === 0) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function moneyMinor(value: string): number | null {
  if (value.trim().length === 0) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  const minor = Math.round(parsed * 100)
  return Number.isSafeInteger(minor) ? minor : null
}

function moneyInput(value: number | null): string {
  return value === null ? '' : String(value / 100)
}

function formatMoney(value: number | null): string {
  if (value === null) return '—'
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(value / 100)
}

async function sha256Hex(value: string): Promise<string> {
  if (globalThis.crypto?.subtle === undefined) throw new Error('Güvenli kanıt özeti üretilemiyor.')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function statusClass(status: string): string {
  if (status === 'approved' || status === 'calculable' || status === 'no_value_loss') return 'status-pill--open'
  if (status === 'rejected') return 'status-pill--late'
  if (status === 'control_required' || status === 'awaiting_approval') return 'status-pill--review'
  return 'status-pill--waiting'
}

function StateView({ status, retry }: { readonly status: string; readonly retry: () => void }) {
  const content = status === 'loading'
    ? ['Değer kaybı çalışma alanı yükleniyor…', 'Güncel taslak, kanıtlar ve sürüm geçmişi okunuyor.']
    : status === 'unauthorized'
      ? ['Oturum gerekli', 'Gerçek değer kaybı verisini görmek için yeniden giriş yapın.']
      : status === 'forbidden'
        ? ['Yetki yetersiz', 'Bu rol değer kaybı çalışma alanını kullanamıyor.']
        : status === 'not_found'
          ? ['Dosya bulunamadı', 'Dosya organizasyon erişim alanınızda değil.']
          : status === 'conflict'
            ? ['Sürüm çakışması', 'Taslak başka bir işlemle değişti. Güncel veriyi yükleyin.']
            : ['Bağlantı kurulamadı', 'Değer kaybı API’sine erişilemiyor; mock sonuç gösterilmedi.']
  return <div className="document-module-state value-loss-state" role={status === 'loading' ? 'status' : 'alert'}>
    {status === 'loading' ? <LoaderCircle className="spin" /> : <AlertTriangle />}
    <strong>{content[0]}</strong><span>{content[1]}</span>
    {['unavailable', 'conflict'].includes(status) && <button className="button button--secondary" type="button" onClick={retry}><RefreshCw size={14} /> Güncel Veriyi Yükle</button>}
  </div>
}

export function TrafficValueLossApiModule({
  item,
  source,
  port,
  documentPort,
  reportPort,
}: {
  readonly item: CaseRecord
  readonly source: DataSourceKind
  readonly port?: TrafficValueLossDataPort
  readonly documentPort?: CaseDocumentsDataPort
  readonly reportPort?: TrafficValueLossReportDataPort
}) {
  const usesRealMarket = !item.lossDate || item.lossDate >= '2026-07-01'
  const session = useSession()
  const valueLoss = useTrafficValueLoss(item.caseId, source, item.type === 'Trafik', port)
  const documents = useCaseDocuments(item.caseId, source, item.type === 'Trafik', documentPort)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [evaluatedOn, setEvaluatedOn] = useState(todayLocalDate)
  const [heavyStatus, setHeavyStatus] = useState<'unknown' | 'no' | 'yes'>('unknown')
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [variant, setVariant] = useState('')
  const [modelYear, setModelYear] = useState('')
  const [mileage, setMileage] = useState('')
  const [usageType, setUsageType] = useState('')
  const [faultPercent, setFaultPercent] = useState('')
  const [preValue, setPreValue] = useState('')
  const [postValue, setPostValue] = useState('')
  const [damageAmount, setDamageAmount] = useState(() => String(item.estimatedDamage))
  const [marketValueReason, setMarketValueReason] = useState('')
  const [damageAmountReason, setDamageAmountReason] = useState('')
  const [vehicleType, setVehicleType] = useState<keyof typeof VEHICLE_GROUPS>('OTOMOBİL')
  const [commercialOrRental, setCommercialOrRental] = useState(false)
  const [previousDamageCount, setPreviousDamageCount] = useState('0')
  const [antiqueStatus, setAntiqueStatus] = useState<'unknown' | 'no' | 'yes'>('unknown')
  const [priorHeavyStatus, setPriorHeavyStatus] = useState<'unknown' | 'no' | 'yes'>('unknown')
  const [foreignPlate, setForeignPlate] = useState(false)
  const [foreignMarketVerified, setForeignMarketVerified] = useState(false)
  const [realMarketParts, setRealMarketParts] = useState<readonly RealMarketPartDraft[]>([])
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogOperation, setCatalogOperation] = useState<TrafficValueLossRealMarketPartInput['operation']>('replacement')
  const [damageParts, setDamageParts] = useState<readonly DamagePartDraft[]>([emptyDamagePart()])
  const [comparables, setComparables] = useState<readonly ComparableDraft[]>(() => defaultComparables(usesRealMarket))
  const [documentSupports, setDocumentSupports] = useState<Readonly<Record<string, readonly TrafficValueLossEvidenceField[]>>>({})
  const [submitConfirmed, setSubmitConfirmed] = useState(false)
  const [approvalConfirmed, setApprovalConfirmed] = useState(false)
  const [approvalReason, setApprovalReason] = useState('')
  const [previewConfirmed, setPreviewConfirmed] = useState(false)
  const [previewDirty, setPreviewDirty] = useState(false)
  const previewInput = useRef<TrafficValueLossDraftInput | null>(null)
  const formRevision = useRef(0)
  const [localMessage, setLocalMessage] = useState<string | null>(null)
  const hydratedVersionId = useRef<string | null>(null)
  const keys = useRef<Partial<Record<'create' | 'submit' | 'approve' | 'reject', string>>>({})

  const canWrite = canUsePermission(session.user,'analysis_write',['admin','expert','case_manager'])
  const canApprove = canUsePermission(session.user,'analysis_approve',['admin','expert'])
  const readyDocuments = (documents.data?.documents ?? []).filter((document) => (
    document.status === 'ready' && document.hashVerified && document.sizeVerified && document.verifiedAt !== null
  ))
  const currentVersion = valueLoss.assessment?.currentVersion ?? null
  const currentApproved = valueLoss.currentApproved
  const vehicleGroup = VEHICLE_GROUPS[vehicleType]
  const usesWorkingHours = usesRealMarket && vehicleGroup === 'D'
  const catalog = valueLoss.catalog?.vehicleGroupCode === vehicleGroup ? valueLoss.catalog : null
  const selectedCatalogPart = catalog?.parts.find((part) =>
    part.stableRuleId === catalogQuery || part.label === catalogQuery,
  )
  const loadPartCatalog = valueLoss.loadCatalog
  const shownVersion = valueLoss.versions.find((version) => version.id === selectedVersionId) ?? currentVersion

  const stableKey = (kind: 'create' | 'submit' | 'approve' | 'reject') => {
    const existing = keys.current[kind]
    if (existing !== undefined) return existing
    if (globalThis.crypto?.randomUUID === undefined) throw new Error('Güvenli işlem kimliği üretilemiyor.')
    const created = globalThis.crypto.randomUUID()
    keys.current[kind] = created
    return created
  }
  const reloadCurrent = () => {
    keys.current = {}
    setLocalMessage(null)
    valueLoss.retry()
  }

  const hydrate = useCallback((version: TrafficValueLossVersionRecord) => {
    const input = version.input
    setEvaluatedOn(input.evaluatedOn)
    setHeavyStatus(input.heavyOrTotalDamage === null ? 'unknown' : input.heavyOrTotalDamage ? 'yes' : 'no')
    setMake(input.vehicle.make ?? '')
    setModel(input.vehicle.model ?? '')
    setVariant(input.vehicle.variant ?? '')
    setModelYear(input.vehicle.modelYear === null ? '' : String(input.vehicle.modelYear))
    setMileage(input.vehicle.mileage === null ? '' : String(input.vehicle.mileage))
    setUsageType(input.vehicle.usageType ?? '')
    setFaultPercent(input.faultRateBasisPoints === null ? '' : String(input.faultRateBasisPoints / 100))
    setPreValue(moneyInput(input.preAccidentMarketValueMinor))
    setPostValue(moneyInput(input.postRepairMarketValueMinor))
    if (input.realMarket != null) {
      if (input.realMarket.vehicleType !== null && input.realMarket.vehicleType in VEHICLE_GROUPS) {
        setVehicleType(input.realMarket.vehicleType as keyof typeof VEHICLE_GROUPS)
      }
      setCommercialOrRental(input.realMarket.commercialOrRental)
      setPreviousDamageCount(input.realMarket.previousDamageCount === null ? '' : String(input.realMarket.previousDamageCount))
      setPreValue(moneyInput(input.realMarket.marketValueMinor))
      setDamageAmount(moneyInput(input.realMarket.damageAmountMinor))
      setMileage(input.realMarket.usageValue === null ? '' : String(input.realMarket.usageValue))
      const provenance = input.realMarket.prefillProvenance
      setMarketValueReason(provenance.find((entry) => entry.field === 'marketValueMinor')?.overrideReason ?? '')
      setDamageAmountReason(provenance.find((entry) => entry.field === 'damageAmountMinor')?.overrideReason ?? '')
      setAntiqueStatus(input.realMarket.eligibilityFacts.antiqueOrCollector === null ? 'unknown' : input.realMarket.eligibilityFacts.antiqueOrCollector ? 'yes' : 'no')
      setPriorHeavyStatus(input.realMarket.eligibilityFacts.priorHeavyDamage === null ? 'unknown' : input.realMarket.eligibilityFacts.priorHeavyDamage ? 'yes' : 'no')
      setForeignPlate(input.realMarket.eligibilityFacts.foreignPlate)
      setForeignMarketVerified(input.realMarket.eligibilityFacts.foreignMarketEvidenceVerified)
      setRealMarketParts(input.realMarket.parts.map((part, index) => ({
        ...part,
        id: rowId('real-part'),
        label: version.evaluation.partBreakdown?.find((entry) => entry.stableRuleId === part.stableRuleId)?.sourceLabel
          ?? input.damageParts[index]?.partName ?? 'Kayıtlı parça',
      })))
    }
    setDamageParts(input.damageParts.length === 0 ? [emptyDamagePart()] : input.damageParts.map((part) => ({ ...part, id: rowId('part') })))
    const evidenceById = new Map(version.evidence.map((evidence) => [evidence.id, evidence]))
    setComparables(version.comparables.length === 0 ? defaultComparables(version.evaluation.calculationMethod === 'real_market_analysis') : version.comparables.map((comparable) => {
      const evidence = evidenceById.get(comparable.evidenceId)
      return {
        id: rowId(comparable.side === 'pre_accident' ? 'pre' : 'post'),
        side: comparable.side,
        amount: moneyInput(comparable.amountMinor),
        mileage: comparable.mileage === null ? '' : String(comparable.mileage),
        observedAt: comparable.observedAt,
        reference: evidence?.externalReference ?? '',
        verified: evidence?.verificationStatus === 'verified',
        conflict: evidence?.conflict === true,
        excluded: comparable.excluded,
        exclusionReason: comparable.exclusionReason ?? '',
      }
    }))
    const nextSupports: Record<string, readonly TrafficValueLossEvidenceField[]> = {}
    for (const evidence of version.evidence) {
      if (evidence.documentVersionId !== null) nextSupports[evidence.documentVersionId] = evidence.supports
    }
    setDocumentSupports(nextSupports)
    hydratedVersionId.current = version.id
  }, [])

  useEffect(() => {
    if (source !== 'api' || item.type !== 'Trafik' || !usesRealMarket) return
    void loadPartCatalog(VEHICLE_GROUPS[vehicleType]).catch(() => {
      // Hook hata durumunu kullanıcıya taşır; mock veya sabit katalog fallback'i yoktur.
    })
  }, [item.type, loadPartCatalog, source, vehicleType, usesRealMarket])

  useEffect(() => {
    if (currentVersion === null || hydratedVersionId.current === currentVersion.id) return
    hydrate(currentVersion)
    setSelectedVersionId(currentVersion.id)
  }, [currentVersion, hydrate])

  const updatePart = (id: string, patch: Partial<DamagePartDraft>) => {
    setDamageParts((items) => items.map((part) => part.id === id ? { ...part, ...patch } : part))
  }
  const updateRealMarketPart = (id: string, patch: Partial<RealMarketPartDraft>) => {
    setRealMarketParts((items) => {
      const selected = items.find((part) => part.id === id)
      return items.map((part) => part.id === id
        ? { ...part, ...patch }
        : part.stableRuleId === selected?.stableRuleId
          ? { ...part,
            ...(patch.priorPartState === undefined ? {} : { priorPartState: patch.priorPartState }),
            ...(patch.treatment === undefined ? {} : { treatment: patch.treatment }),
          }
          : part)
    })
  }
  const addCatalogPart = () => {
    const selected = selectedCatalogPart
    if (selected === undefined) {
      setLocalMessage('Parça kataloğundan geçerli bir kayıt seçin.')
      return
    }
    if (!selected.supportedOperations.includes(catalogOperation)) {
      setLocalMessage('Seçilen parça bu işlemi desteklemiyor.')
      return
    }
    if (realMarketParts.some((part) => part.stableRuleId === selected.stableRuleId
      && (part.operation === catalogOperation || (part.operation !== 'paint' && catalogOperation !== 'paint')))) {
      setLocalMessage('Bu parça için işlem zaten seçili. Değişim ve onarım birlikte seçilemez.')
      return
    }
    setPreviewConfirmed(false)
    setPreviewDirty(true)
    setRealMarketParts((items) => [...items, {
      id: rowId('real-part'),
      label: selected.label,
      stableRuleId: selected.stableRuleId,
      operation: catalogOperation,
      paintMode: catalogOperation === 'paint' ? 'full' : null,
      newPartPriceMinor: null,
      repairLaborMinor: null,
      partPriceAvailability: catalogOperation === 'repair' ? 'available' : 'unavailable',
      priorPartState: items.find((part) => part.stableRuleId === selected.stableRuleId)?.priorPartState ?? 'none',
      treatment: items.find((part) => part.stableRuleId === selected.stableRuleId)?.treatment ?? 'standard',
    }])
    setCatalogQuery('')
  }
  const updateComparable = (id: string, patch: Partial<ComparableDraft>) => {
    setComparables((items) => items.map((comparable) => comparable.id === id ? { ...comparable, ...patch } : comparable))
  }
  const toggleDocument = (documentVersionId: string) => {
    setDocumentSupports((current) => {
      const next = { ...current }
      if (next[documentVersionId] !== undefined) delete next[documentVersionId]
      else next[documentVersionId] = []
      return next
    })
  }
  const toggleSupport = (documentVersionId: string, support: TrafficValueLossEvidenceField) => {
    setDocumentSupports((current) => {
      const supports = current[documentVersionId] ?? []
      return {
        ...current,
        [documentVersionId]: supports.includes(support) ? supports.filter((item) => item !== support) : [...supports, support],
      }
    })
  }

  const comparableAverage = (side: ComparableDraft['side']): string => {
    const usage = nullableInteger(mileage)
    if (usage === null) return ''
    const evaluated = Date.parse(`${evaluatedOn}T00:00:00Z`)
    const amounts = comparables.filter((item) => {
      const comparableUsage = nullableInteger(item.mileage)
      const days = (evaluated - Date.parse(`${item.observedAt}T00:00:00Z`)) / 86_400_000
      return item.side === side && item.verified && !item.conflict && !item.excluded && item.amount.trim() !== ''
        && comparableUsage !== null && Math.abs(comparableUsage - usage) <= Math.max(1, Math.floor(usage * 0.1))
        && days >= 0 && days <= 30
    }).map((item) => moneyMinor(item.amount)).filter((value): value is number => value !== null && value > 0)
    if (amounts.length === 0) return ''
    const count = BigInt(amounts.length)
    const total = amounts.reduce((sum, value) => sum + BigInt(value), 0n)
    return moneyInput(Number((total + count / 2n) / count))
  }

  const buildInput = async (confirmedPreviewHash: string | null = null): Promise<TrafficValueLossDraftInput> => {
    const parsedParts: readonly TrafficValueLossDamagePartInput[] = usesRealMarket
      ? realMarketParts.map((part, index) => ({
        partCode: `DK_${index + 1}`,
        partName: part.label,
        repairAction: part.operation === 'replacement' ? 'replace' : part.operation === 'paint' ? 'paint' : 'repair',
        priorDamage: part.priorPartState === 'none' ? 'no' : 'yes',
      }))
      : damageParts.filter((part) => part.partCode.trim().length > 0 || part.partName.trim().length > 0)
    if (parsedParts.some((part) => part.partCode.trim().length === 0 || part.partName.trim().length === 0)) {
      throw new Error('Her hasar parçası için kod ve ad girilmelidir.')
    }
    const inputComparables: TrafficValueLossComparableInput[] = []
    const marketEvidence: TrafficValueLossEvidenceInput[] = []
    for (const comparable of comparables) {
      if (usesRealMarket && comparable.side !== 'pre_accident') continue
      const hasAnyValue = [comparable.amount, comparable.mileage, comparable.reference].some((value) => value.trim().length > 0)
      if (!hasAnyValue) continue
      const amountMinor = moneyMinor(comparable.amount)
      const comparableMileage = nullableInteger(comparable.mileage)
      const reference = comparable.reference.trim()
      if (comparable.excluded && comparable.exclusionReason.trim().length === 0) {
        throw new Error('Hesap dışı bırakılan emsal için gerekçe girin.')
      }
      if (amountMinor === null || comparableMileage === null || comparable.observedAt.length === 0
        || (!reference.startsWith('https://') && !reference.startsWith('ref:'))) {
        throw new Error(`Her emsal için tutar, ${usesWorkingHours ? 'çalışma saati' : 'kilometre'}, tarih ve güvenli https:// veya ref: kaynağı gereklidir.`)
      }
      const evidenceKey = `market-${comparable.id}`
      const sourceHash = await sha256Hex(JSON.stringify({
        side: comparable.side, amountMinor, mileage: comparableMileage, observedAt: comparable.observedAt, reference,
      }))
      marketEvidence.push({
        evidenceKey,
        sourceType: 'market_comparable' as const,
        documentId: null,
        documentVersionId: null,
        externalReference: reference,
        sourceHash,
        observedAt: comparable.observedAt,
        supports: [comparable.side === 'pre_accident' ? 'pre_accident_market_value' as const : 'post_repair_market_value' as const],
        verificationStatus: comparable.verified ? 'verified' as const : 'control_required' as const,
        conflict: comparable.conflict,
        notes: null,
      })
      inputComparables.push({
        comparableKey: `comparable-${comparable.id}`,
        side: comparable.side,
        amountMinor,
        mileage: comparableMileage,
        observedAt: comparable.observedAt,
        evidenceKey,
        excluded: comparable.excluded,
        exclusionReason: comparable.excluded ? comparable.exclusionReason.trim() : null,
      })
    }
    const manualFacts = {
      evaluatedOn, heavyStatus, make, model, variant, modelYear, mileage, usageType, faultPercent,
      preValue, postValue, damageParts: parsedParts, vehicleType, damageAmount,
      commercialOrRental, previousDamageCount, realMarketParts, antiqueStatus, priorHeavyStatus,
      foreignPlate, foreignMarketVerified,
    }
    const evidence: TrafficValueLossEvidenceInput[] = [{
      evidenceKey: 'manual-input',
      sourceType: 'expert_observation' as const,
      documentId: null,
      documentVersionId: null,
      externalReference: 'ref:user-entered-facts',
      sourceHash: await sha256Hex(JSON.stringify(manualFacts)),
      observedAt: evaluatedOn,
      supports: ['vehicle_identity', 'mileage', 'usage_type', 'damage_parts', 'prior_damage', 'fault_rate', 'heavy_damage_status'] as const,
      verificationStatus: 'control_required' as const,
      conflict: false,
      notes: 'Kullanıcı girdisi; belge kanıtı yerine geçmez.',
    }, ...readyDocuments.flatMap((document) => {
      const supports = documentSupports[document.id]
      if (supports === undefined || supports.length === 0) return []
      return [{
        evidenceKey: `document-${document.id}`,
        sourceType: 'document_version' as const,
        documentId: document.documentId,
        documentVersionId: document.id,
        externalReference: null,
        sourceHash: document.contentHash,
        observedAt: null,
        supports,
        verificationStatus: 'verified' as const,
        conflict: false,
        notes: null,
      }]
    }), ...marketEvidence]
    const fault = faultPercent.trim().length === 0 ? null : Math.round(Number(faultPercent) * 100)
    if (fault !== null && (!Number.isSafeInteger(fault) || fault < 0 || fault > 10_000)) {
      throw new Error('Kusur oranı 0 ile 100 arasında olmalıdır.')
    }
    const selectedMarketValue = moneyMinor(preValue)
    const selectedDamageAmount = moneyMinor(damageAmount)
    const caseDamageAmount = moneyMinor(String(item.estimatedDamage))
    if (usesRealMarket && selectedMarketValue !== null && marketValueReason.trim().length === 0) {
      throw new Error('Onaylı rayiç kaynağı bağlı değilse kullanıcı rayiç girişi için gerekçe zorunludur.')
    }
    if (usesRealMarket && selectedDamageAmount !== caseDamageAmount && damageAmountReason.trim().length === 0) {
      throw new Error('Dosya hasar tutarı değiştirildiğinde gerekçe zorunludur.')
    }
    return {
      evaluatedOn,
      heavyOrTotalDamage: heavyStatus === 'unknown' ? null : heavyStatus === 'yes',
      vehicle: {
        make: nullableText(make),
        model: nullableText(model),
        variant: nullableText(variant),
        modelYear: nullableInteger(modelYear),
        mileage: usesWorkingHours ? null : nullableInteger(mileage),
        usageType: nullableText(usageType),
      },
      faultRateBasisPoints: usesRealMarket ? null : fault,
      preAccidentMarketValueMinor: moneyMinor(preValue),
      postRepairMarketValueMinor: usesRealMarket ? null : moneyMinor(postValue),
      damageParts: parsedParts.map((part) => ({
        partCode: part.partCode,
        partName: part.partName,
        repairAction: part.repairAction,
        priorDamage: part.priorDamage,
      })),
      comparables: inputComparables,
      evidence,
      realMarket: usesRealMarket ? {
        vehicleType,
        vehicleGroupCode: VEHICLE_GROUPS[vehicleType],
        usageMetric: usesWorkingHours
          ? 'working_hours'
          : 'mileage',
        usageValue: nullableInteger(mileage),
        commercialOrRental,
        previousDamageCount: nullableInteger(previousDamageCount),
        marketValueMinor: selectedMarketValue,
        damageAmountMinor: selectedDamageAmount,
        parts: realMarketParts.map((part) => ({
          stableRuleId: part.stableRuleId,
          operation: part.operation,
          paintMode: part.paintMode,
          newPartPriceMinor: part.newPartPriceMinor,
          repairLaborMinor: part.repairLaborMinor,
          partPriceAvailability: part.partPriceAvailability,
          priorPartState: part.priorPartState,
          treatment: part.treatment,
        })),
        eligibilityFacts: {
          antiqueOrCollector: antiqueStatus === 'unknown' ? null : antiqueStatus === 'yes',
          priorHeavyDamage: priorHeavyStatus === 'unknown' ? null : priorHeavyStatus === 'yes',
          currentHeavyOrTotalDamage: heavyStatus === 'unknown' ? null : heavyStatus === 'yes',
          foreignPlate,
          foreignMarketEvidenceVerified: foreignPlate && foreignMarketVerified,
        },
        prefillProvenance: [
          {
            field: 'accidentDate',
            source: 'case',
            sourceRevisionId: null,
            originalValue: item.lossDate ?? null,
            newValue: item.lossDate ?? null,
            overrideReason: null,
          },
          {
            field: 'damageAmountMinor',
            source: 'user_input',
            sourceRevisionId: null,
            originalValue: caseDamageAmount,
            newValue: selectedDamageAmount,
            overrideReason: selectedDamageAmount === caseDamageAmount ? null : damageAmountReason.trim(),
          },
          {
            field: 'marketValueMinor',
            source: 'user_input',
            sourceRevisionId: null,
            originalValue: null,
            newValue: selectedMarketValue,
            overrideReason: selectedMarketValue === null ? null : marketValueReason.trim(),
          },
        ],
      } : null,
      ruleOverride: null,
      confirmedPreviewHash,
    }
  }

  const run = async (kind: 'create' | 'submit' | 'approve' | 'reject', operation: (key: string) => Promise<void>, success: string) => {
    setLocalMessage(null)
    try {
      await operation(stableKey(kind))
      delete keys.current[kind]
      setLocalMessage(success)
      setSubmitConfirmed(false)
      setApprovalConfirmed(false)
      setApprovalReason('')
    } catch (error) {
      if (!(error instanceof Error) || error.name === 'TrafficValueLossError') return
      setLocalMessage(error.message)
    }
  }

  if (item.type !== 'Trafik') {
    return <div className="document-module-state" role="status"><Scale /><strong>Kasko değer kaybı bu akışta desteklenmiyor</strong><span>Paket 33 yalnız 01.07.2026 Trafik değer kaybı çekirdeğini gerçek dosya detayına bağlar.</span></div>
  }
  if (!['ok', 'empty'].includes(valueLoss.status)) return <StateView status={valueLoss.status === 'idle' ? 'loading' : valueLoss.status} retry={reloadCurrent} />

  const documentStateMessage = documents.status === 'loading'
    ? 'Doğrulanmış belge metadata’sı yükleniyor…'
    : documents.status === 'unauthorized'
      ? 'Belge metadata’sı için oturum gerekli.'
      : documents.status === 'not_found'
        ? 'Dosya belge metadata erişim alanında bulunamadı.'
        : documents.status === 'unavailable'
        ? 'Belge metadata’sına ulaşılamadı; mock belge kullanılmadı.'
        : readyDocuments.length === 0
          ? 'Fiziksel olarak doğrulanmış belge sürümü yok. Taslak control_required kalabilir.'
          : `${readyDocuments.length} doğrulanmış belge sürümü kanıt olarak seçilebilir.`
  const activePreview = previewDirty ? null : valueLoss.previewResult
  const evaluation = activePreview?.evaluation ?? shownVersion?.evaluation ?? null
  const visibleComparables = usesRealMarket ? comparables.filter((part) => part.side === 'pre_accident') : comparables
  const invalidatePreview = () => { formRevision.current += 1; setPreviewDirty(true); setPreviewConfirmed(false) }

  return <section className="value-loss-workspace" aria-labelledby="traffic-value-loss-heading">
    <header className="value-loss-workspace__header">
      <div><span className="eyebrow">{usesRealMarket ? 'Yeni dönem hesaplama' : 'Piyasa değer farkı'}</span><h2 id="traffic-value-loss-heading">Trafik Değer Kaybı Çalışma Alanı</h2><p>{usesRealMarket ? 'Araç ve tutarları girin, değişen / onarılan / boyanan parçaları seçin ve sonucu önizleyin.' : 'Kaza öncesi ve onarım sonrası piyasa değerlerini kanıtlarıyla karşılaştırın.'}</p></div>
      <div className="value-loss-rule"><span>Hesap yöntemi</span><strong>{usesRealMarket ? '01.07.2026 Excel modülü' : 'Piyasa değer farkı'}</strong><small>Kaza tarihi: {item.lossDate ?? 'Girilmemiş'}</small></div>
    </header>

    <div className="value-loss-summary" aria-label="Değer kaybı güncel özet">
      <div><span>Sürüm</span><strong>{activePreview !== null ? 'Önizleme' : shownVersion === null ? 'Henüz yok' : `v${shownVersion.assessmentVersion}`}</strong></div>
      <div><span>Sonuç</span><strong>{evaluation === null ? '—' : STATUS_LABELS[evaluation.eligibilityStatus] ?? evaluation.eligibilityStatus}</strong></div>
      <div><span>{usesRealMarket ? 'Değer kaybı' : 'Brüt taslak'}</span><strong>{formatMoney(evaluation?.grossValueLossMinor ?? null)}</strong></div>
      <div><span>{usesRealMarket ? 'Geçerli emsal' : 'Kusur sonrası'}</span><strong>{usesRealMarket ? evaluation?.qualifyingPreComparableCount ?? '—' : formatMoney(evaluation?.faultAdjustedValueLossMinor ?? null)}</strong></div>
      <div><span>Kontrol bekleyen</span><strong>{evaluation?.uncertainties.length ?? '—'}</strong></div>
      <div><span>İnsan onayı</span><strong>{shownVersion === null ? 'Bekliyor' : STATUS_LABELS[shownVersion.status] ?? shownVersion.status}</strong></div>
    </div>

    <div className="value-loss-grid">
      <div className="value-loss-main" onChangeCapture={(event) => {
        if ((event.target as HTMLElement).closest('.value-loss-form-panel,.value-loss-parts,.value-loss-evidence,.value-loss-comparables')) invalidatePreview()
      }} onClickCapture={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('button') && target.closest('.value-loss-parts,.value-loss-comparables,.value-loss-average-actions')) invalidatePreview()
      }}>
        <section className="info-panel value-loss-form-panel">
          <header><div><h2>1. Uygunluk Kontrolü</h2><span>Durumu belirsiz alanları belgelerle doğrulayın</span></div><ShieldCheck size={16} /></header>
          <div className="value-loss-form-grid">
            {usesRealMarket && <><label className="form-field"><span>Antika / koleksiyon araç</span><select value={antiqueStatus} onChange={(event) => setAntiqueStatus(event.target.value as typeof antiqueStatus)}><option value="unknown">Kanıt bekleniyor</option><option value="no">Hayır</option><option value="yes">Evet</option></select></label>
            <label className="form-field"><span>Önceki ağır hasar</span><select value={priorHeavyStatus} onChange={(event) => setPriorHeavyStatus(event.target.value as typeof priorHeavyStatus)}><option value="unknown">Kanıt bekleniyor</option><option value="no">Hayır</option><option value="yes">Evet</option></select></label></>}
            <label className="form-field"><span>Ağır / tam hasar</span><select value={heavyStatus} onChange={(event) => setHeavyStatus(event.target.value as typeof heavyStatus)}><option value="unknown">Kanıt bekleniyor</option><option value="no">Hayır</option><option value="yes">Evet</option></select></label>
            {usesRealMarket && <label><input type="checkbox" checked={foreignPlate} onChange={(event) => setForeignPlate(event.target.checked)} /> Yabancı plaka</label>}
            {foreignPlate && <label><input type="checkbox" checked={foreignMarketVerified} onChange={(event) => setForeignMarketVerified(event.target.checked)} /> Yabancı ülke rayiç kanıtı doğrulandı</label>}
          </div>
        </section>

        <section className="info-panel value-loss-form-panel">
          <header><div><h2>2. Araç Bilgileri</h2><span>Araç yaşı kaza tarihine göre hesaplanır</span></div><Calculator size={16} /></header>
          <div className="value-loss-form-grid">
            <label className="form-field"><span>Değerlendirme tarihi</span><input type="date" value={evaluatedOn} onChange={(event) => setEvaluatedOn(event.target.value)} /></label>
            {!usesRealMarket && <label className="form-field"><span>Kusur oranı (%)</span><input type="number" min="0" max="100" step=".01" value={faultPercent} onChange={(event) => setFaultPercent(event.target.value)} /></label>}
            <label className="form-field"><span>Marka</span><input value={make} onChange={(event) => setMake(event.target.value)} /></label>
            <label className="form-field"><span>Model</span><input value={model} onChange={(event) => setModel(event.target.value)} /></label>
            <label className="form-field"><span>Varyant</span><input value={variant} onChange={(event) => setVariant(event.target.value)} /></label>
            <label className="form-field"><span>Model yılı</span><input type="number" min="1900" max="2200" value={modelYear} onChange={(event) => setModelYear(event.target.value)} /></label>
            <label className="form-field"><span>{usesWorkingHours ? 'Çalışma saati' : 'Kilometre'}</span><input type="number" min="0" value={mileage} onChange={(event) => setMileage(event.target.value)} /></label>
            <label className="form-field"><span>Kullanım şekli</span><input value={usageType} onChange={(event) => setUsageType(event.target.value)} placeholder="Hususi" /></label>
            {usesRealMarket && <label className="form-field"><span>Araç türü</span><select value={vehicleType} onChange={(event) => {
              const next = event.target.value as keyof typeof VEHICLE_GROUPS
              if (VEHICLE_GROUPS[next] !== vehicleGroup) {
                setRealMarketParts([])
                setCatalogQuery('')
                if ((VEHICLE_GROUPS[next] === 'D') !== (vehicleGroup === 'D')) { setMileage(''); setComparables(defaultComparables()) }
                setLocalMessage('Araç grubu değişti. Yeni gruba ait parçaları seçin.')
              }
              setVehicleType(next)
            }}>{Object.keys(VEHICLE_GROUPS).map((type) => <option key={type} value={type}>{type}</option>)}</select></label>}
          </div>
        </section>

        <section className="info-panel value-loss-form-panel">
          <header><div><h2>3. Rayiç ve Hasar Tutarı</h2><span>Tüm tutarları TL olarak girin</span></div><Scale size={16} /></header>
          <div className="value-loss-form-grid">
            <label className="form-field"><span>Kaza öncesi piyasa değeri</span><input type="number" min="0" step=".01" value={preValue} onChange={(event) => setPreValue(event.target.value)} /></label>
            {usesRealMarket && <><label className="form-field"><span>Rayiç giriş gerekçesi</span><input value={marketValueReason} onChange={(event) => setMarketValueReason(event.target.value)} placeholder="Rayiç kaynağı veya değerlendirme gerekçesi" /></label>
            <label className="form-field"><span>Onaylı/final hasar tutarı</span><input type="number" min="0" step=".01" value={damageAmount} onChange={(event) => setDamageAmount(event.target.value)} /></label>
            {moneyMinor(damageAmount) !== moneyMinor(String(item.estimatedDamage)) && <label className="form-field"><span>Hasar tutarı değişiklik gerekçesi</span><input value={damageAmountReason} onChange={(event) => setDamageAmountReason(event.target.value)} /></label>}</>}
            {!usesRealMarket && <label className="form-field"><span>Onarım sonrası piyasa değeri</span><input type="number" min="0" step=".01" value={postValue} onChange={(event) => setPostValue(event.target.value)} /></label>}
            <div className="value-loss-average-actions"><button className="button button--secondary" type="button" onClick={() => setPreValue(comparableAverage('pre_accident'))}>Önceki emsal ortalaması</button>{!usesRealMarket && <button className="button button--secondary" type="button" onClick={() => setPostValue(comparableAverage('post_repair'))}>Sonraki emsal ortalaması</button>}</div>
          </div>
        </section>

        {usesRealMarket && <><section className="info-panel value-loss-form-panel">
          <header><div><h2>4. Kullanım ve Hasar Geçmişi</h2><span>Kilometre alt sınır ilavesi otomatik uygulanır</span></div><Calculator size={16} /></header>
          <div className="value-loss-form-grid">
            <label><input type="checkbox" checked={commercialOrRental} onChange={(event) => setCommercialOrRental(event.target.checked)} /> Ticari veya kiralık kullanım</label>
            <label className="form-field"><span>Önceki hasar sayısı</span><input type="number" min="0" value={previousDamageCount} onChange={(event) => setPreviousDamageCount(event.target.value)} /></label>
          </div>
        </section>

        <section className="info-panel value-loss-parts">
          <header><div><h2>5. Parça ve İşlemler</h2><span>Parçayı seçip değişim, onarım veya boya ekleyin. Onarım bedelleri iskontosuz ve KDV hariç olmalıdır.</span></div></header>
          <div className="value-loss-catalog-search">
            <input
              list="value-loss-part-catalog"
              value={catalogQuery}
              onChange={(event) => {
                const query = event.target.value
                setCatalogQuery(query)
                const selected = catalog?.parts.find((part) => part.stableRuleId === query || part.label === query)
                const firstSupported = selected?.supportedOperations[0]
                if (firstSupported !== undefined) setCatalogOperation(firstSupported)
              }}
              placeholder="Parça ara…"
              aria-label="Parça kataloğunda ara"
            />
            <datalist id="value-loss-part-catalog">{catalog?.parts.map((part) => <option key={part.stableRuleId} value={part.label} />)}</datalist>
            <select
              aria-label="Katalog işlemi"
              value={catalogOperation}
              disabled={selectedCatalogPart === undefined}
              onChange={(event) => setCatalogOperation(event.target.value as TrafficValueLossRealMarketPartInput['operation'])}
            >
              {(selectedCatalogPart?.supportedOperations ?? []).map((operation) => (
                <option key={operation} value={operation}>
                  {operation === 'replacement' ? 'Değişim' : operation === 'repair' ? 'Onarım' : 'Boya'}
                </option>
              ))}
            </select>
            <button className="button button--secondary" type="button" disabled={selectedCatalogPart === undefined} onClick={addCatalogPart}><CirclePlus size={14} /> Katalogdan Ekle</button>
          </div>
          {realMarketParts.length === 0 && <p className="value-loss-help">Henüz parça seçilmedi.</p>}
          {(['replacement', 'repair', 'paint'] as const).filter((operation) => realMarketParts.some((part) => part.operation === operation)).map((operation) => <div key={operation}>
            <h3>{operation === 'replacement' ? 'Değişen Parçalar' : operation === 'repair' ? 'Onarılan Parçalar' : 'Boyanan Parçalar'}</h3>
            <div className="value-loss-parts__rows">{realMarketParts.filter((part) => part.operation === operation).map((part) => {
              const catalogPart = catalog?.parts.find((item) => item.stableRuleId === part.stableRuleId)
              return <div className="value-loss-part-row value-loss-part-card" key={part.id}>
                <strong>{catalogPart?.label ?? part.label}</strong>
                {operation === 'repair' && <>
                  <select aria-label="Parça fiyatı durumu" value={part.partPriceAvailability} onChange={(event) => updateRealMarketPart(part.id, { partPriceAvailability: event.target.value as RealMarketPartDraft['partPriceAvailability'] })}><option value="available">Parça fiyatı var</option><option value="unavailable">Bedel tespit edilemiyor (ağır onarım)</option></select>
                  {part.partPriceAvailability === 'available' && <><input aria-label="Yeni parça fiyatı" type="number" min="0" step=".01" placeholder="Parça fiyatı TL" value={part.newPartPriceMinor === null ? '' : part.newPartPriceMinor / 100} onChange={(event) => updateRealMarketPart(part.id, { newPartPriceMinor: moneyMinor(event.target.value) })} />
                  <input aria-label="Onarım işçiliği" type="number" min="0" step=".01" placeholder="İşçilik TL" value={part.repairLaborMinor === null ? '' : part.repairLaborMinor / 100} onChange={(event) => updateRealMarketPart(part.id, { repairLaborMinor: moneyMinor(event.target.value) })} /></>}
                </>}
                {operation === 'paint' && <select aria-label="Boya türü" value={part.paintMode ?? 'full'} onChange={(event) => updateRealMarketPart(part.id, { paintMode: event.target.value as 'full' | 'local' })}><option value="full">Tam boya</option><option value="local">Lokal boya</option></select>}
                <select aria-label="Parçanın önceki durumu" value={part.priorPartState} onChange={(event) => updateRealMarketPart(part.id, { priorPartState: event.target.value as RealMarketPartDraft['priorPartState'] })}><option value="none">Önceki hasar / onarım yok</option><option value="previously_damaged">Önceden hasarlı</option><option value="previously_repaired_detachable">Önceden onarılmış, sökülebilir</option><option value="previously_repaired_welded">Önceden onarılmış, kaynaklı</option></select>
                <select aria-label="Parça değerlendirmesi" value={part.treatment} onChange={(event) => updateRealMarketPart(part.id, { treatment: event.target.value as RealMarketPartDraft['treatment'] })}><option value="standard">Standart değerlendirme</option><option value="accessory">Aksesuar (katsayı uygulanmaz)</option><option value="paintless_repair">Boyasız onarım (katsayı uygulanmaz)</option><option value="plastic_or_unpainted">Plastik / boyasız panel (katsayı uygulanmaz)</option>{vehicleGroup === 'Ç' && <option value="superstructure">Üst yapı (katsayı uygulanmaz)</option>}</select>
                <small>Katsayı: {operation === 'replacement' ? catalogPart?.coefficients.replacement : operation === 'paint' ? `${catalogPart?.coefficients.paint?.full}/${catalogPart?.coefficients.paint?.local}` : `${catalogPart?.coefficients.repair?.light}/${catalogPart?.coefficients.repair?.medium}/${catalogPart?.coefficients.repair?.heavy}`}</small>
                <button className="icon-button" type="button" aria-label="Katalog parçasını kaldır" onClick={() => setRealMarketParts((items) => items.filter((item) => item.id !== part.id))}><Trash2 size={14} /></button>
              </div>
            })}</div>
          </div>)}
        </section></>}

        {!usesRealMarket && <section className="info-panel value-loss-parts">
          <header><div><h2>Hasarlı Parça ve İşlemler</h2><span>Önceki hasar belirsizliği ayrıca gösterilir</span></div><button className="button button--secondary" type="button" onClick={() => setDamageParts((items) => [...items, emptyDamagePart()])}><CirclePlus size={14} /> Parça Ekle</button></header>
          <div className="value-loss-parts__rows">{damageParts.map((part) => <div className="value-loss-part-row" key={part.id}>
            <input aria-label="Parça kodu" placeholder="SOL_CAMURLUK" value={part.partCode} onChange={(event) => updatePart(part.id, { partCode: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '_') })} />
            <input aria-label="Parça adı" placeholder="Sol çamurluk" value={part.partName} onChange={(event) => updatePart(part.id, { partName: event.target.value })} />
            <select aria-label="Onarım işlemi" value={part.repairAction} onChange={(event) => updatePart(part.id, { repairAction: event.target.value as DamagePartDraft['repairAction'] })}><option value="repair_paint">Onarım + boya</option><option value="replace_paint">Değişim + boya</option><option value="paint">Boya</option><option value="replace">Değişim</option><option value="paintless_repair">Boyasız onarım</option></select>
            <select aria-label="Önceki hasar" value={part.priorDamage} onChange={(event) => updatePart(part.id, { priorDamage: event.target.value as DamagePartDraft['priorDamage'] })}><option value="unknown">Önceki hasar belirsiz</option><option value="no">Önceki hasar yok</option><option value="yes">Önceki hasar var</option></select>
            <button className="icon-button" type="button" aria-label="Parçayı kaldır" disabled={damageParts.length === 1} onClick={() => setDamageParts((items) => items.filter((item) => item.id !== part.id))}><Trash2 size={14} /></button>
          </div>)}</div>
        </section>}

        <section className="info-panel value-loss-evidence">
          <header><div><h2>Doğrulanmış Belge Kanıtları</h2><span>{documentStateMessage}</span></div><FileCheck2 size={16} /></header>
          {readyDocuments.length === 0 ? <p>{documentStateMessage}</p> : <div className="value-loss-document-list">{readyDocuments.map((document) => {
            const selected = documentSupports[document.id] !== undefined
            return <article key={document.id}><label><input type="checkbox" checked={selected} onChange={() => toggleDocument(document.id)} /><span><strong>{DOCUMENT_LABELS[document.documentType] ?? document.documentType}</strong><small>{document.displayName} · v{document.versionNumber} · fiziksel doğrulandı</small></span></label>
              {selected && <div className="value-loss-supports">{SUPPORT_OPTIONS.map((support) => <label key={support.value}><input type="checkbox" checked={(documentSupports[document.id] ?? []).includes(support.value)} onChange={() => toggleSupport(document.id, support.value)} />{support.value === 'mileage' && usesWorkingHours ? 'Çalışma saati' : support.label}</label>)}</div>}
            </article>
          })}</div>}
        </section>

        <section className="info-panel value-loss-comparables">
          <header><div><h2>Piyasa Emsalleri</h2><span>{usesRealMarket ? 'Kaza öncesi rayiç için en az 3 doğrulanmış emsal' : 'Her taraf için en az 3 doğrulanmış emsal'} · son 30 gün · ±%10 {usesWorkingHours ? 'çalışma saati' : 'km'}</span></div><div><button className="button button--secondary" type="button" onClick={() => setComparables((items) => [...items, emptyComparable('pre_accident')])}>{usesRealMarket ? 'Emsal Ekle' : 'Önce Ekle'}</button>{!usesRealMarket && <button className="button button--secondary" type="button" onClick={() => setComparables((items) => [...items, emptyComparable('post_repair')])}>Sonra Ekle</button>}</div></header>
          <div className="table-scroll"><table className="data-table value-loss-comparable-table"><thead><tr><th>Taraf</th><th>Tutar TL</th><th>{usesWorkingHours ? 'Saat' : 'KM'}</th><th>Tarih</th><th>Kaynak</th><th>Kontrol</th><th /></tr></thead><tbody>{visibleComparables.map((comparable) => <tr key={comparable.id}>
            <td>{usesRealMarket ? 'Kaza öncesi' : <select aria-label="Emsal tarafı" value={comparable.side} onChange={(event) => updateComparable(comparable.id, { side: event.target.value as ComparableDraft['side'] })}><option value="pre_accident">Kaza öncesi</option><option value="post_repair">Onarım sonrası</option></select>}</td>
            <td><input aria-label="Emsal tutarı" type="number" min="0" step=".01" value={comparable.amount} onChange={(event) => updateComparable(comparable.id, { amount: event.target.value })} /></td>
            <td><input aria-label={usesWorkingHours ? 'Emsal çalışma saati' : 'Emsal kilometresi'} type="number" min="0" value={comparable.mileage} onChange={(event) => updateComparable(comparable.id, { mileage: event.target.value })} /></td>
            <td><input aria-label="Emsal tarihi" type="date" value={comparable.observedAt} onChange={(event) => updateComparable(comparable.id, { observedAt: event.target.value })} /></td>
            <td><input aria-label="Emsal kaynağı" value={comparable.reference} placeholder="https://… veya ref:…" onChange={(event) => updateComparable(comparable.id, { reference: event.target.value })} /></td>
            <td><label><input type="checkbox" checked={comparable.verified} onChange={(event) => updateComparable(comparable.id, { verified: event.target.checked })} /> Doğrulandı</label><label><input type="checkbox" checked={comparable.conflict} onChange={(event) => updateComparable(comparable.id, { conflict: event.target.checked })} /> Çelişkili</label><label><input type="checkbox" checked={comparable.excluded} onChange={(event) => updateComparable(comparable.id, { excluded: event.target.checked })} /> Hesap dışı</label>{comparable.excluded && <input aria-label="Emsal dışlama gerekçesi" placeholder="Dışlama gerekçesi" value={comparable.exclusionReason} maxLength={500} onChange={(event) => updateComparable(comparable.id, { exclusionReason: event.target.value })} />}</td>
            <td><button className="icon-button" type="button" aria-label="Emsali kaldır" onClick={() => setComparables((items) => items.filter((item) => item.id !== comparable.id))}><Trash2 size={14} /></button></td>
          </tr>)}</tbody></table></div>
        </section>

        <div className="value-loss-form-actions">
          <span>Sonucu önizleyin, kontrol ettikten sonra taslak olarak kaydedin.</span>
          <button className="button button--secondary" type="button" disabled={!canWrite || valueLoss.busy} onClick={() => void (async () => {
            try {
              const revision = formRevision.current
              setPreviewDirty(true)
              const input = await buildInput()
              await valueLoss.preview(input)
              previewInput.current = input
              setPreviewDirty(revision !== formRevision.current)
              setPreviewConfirmed(false)
              setLocalMessage('Hesap önizlemesi üretildi; dökümü inceleyip açıkça onaylayın.')
            } catch (error) {
              if (error instanceof Error && error.name !== 'TrafficValueLossError') setLocalMessage(error.message)
            }
          })()}>{valueLoss.busy ? <LoaderCircle className="spin" size={14} /> : <Calculator size={14} />} Önizleme Oluştur</button>
          {valueLoss.previewResult !== null && previewDirty && <span role="status">Girdiler değişti. Güncel sonuç için yeniden önizleme oluşturun.</span>}
          {activePreview !== null && <>
            <strong>Hesaplanan değer kaybı: {formatMoney(activePreview.evaluation.finalResultMinor ?? activePreview.evaluation.grossValueLossMinor)}</strong>
            <label><input type="checkbox" checked={previewConfirmed} onChange={(event) => setPreviewConfirmed(event.target.checked)} /> Önizleme girdilerini, kanıtları ve hesap dökümünü inceledim.</label>
            <button className="button button--primary" type="button" disabled={!canWrite || !previewConfirmed || valueLoss.busy} onClick={() => void run('create', async (key) => {
              const input = await buildInput()
              if (JSON.stringify(input) !== JSON.stringify(previewInput.current)) {
                invalidatePreview()
                throw new Error('Girdiler değişti. Yeniden önizleme oluşturun.')
              }
              await valueLoss.createVersion({ ...input, confirmedPreviewHash: activePreview.previewHash }, key)
              invalidatePreview()
            }, 'Yeni hesaplama taslağı ve sürümü oluşturuldu.')}>Onaylanan Önizlemeyi Sürümle</button>
          </>}
        </div>
        <TrafficValueLossReportPanel
          caseId={item.caseId}
          source={source}
          version={shownVersion}
          assessmentVersion={valueLoss.assessment?.version ?? 0}
          port={reportPort}
        />
      </div>

      <aside className="value-loss-side">
        <section className="info-panel value-loss-result">
          <header><h2>Hesap Dökümü</h2>{activePreview !== null ? <span>Önizleme</span> : shownVersion && <span className={`status-pill ${statusClass(shownVersion.status)}`}>{STATUS_LABELS[shownVersion.status] ?? shownVersion.status}</span>}</header>
          {evaluation === null ? <p>Girdileri ve kanıtları ekleyip önizleme oluşturun.</p> : <>
            <dl><div><dt>{usesRealMarket ? 'Değer kaybı' : 'Brüt değer farkı'}</dt><dd>{formatMoney(evaluation.grossValueLossMinor)}</dd></div>
              {evaluation.calculationMethod === 'real_market_analysis' ? <>
                <div><dt>Araç yaşı katsayısı</dt><dd>{evaluation.ageCoefficient?.decimal ?? '—'}</dd></div>
                <div><dt>Kullanım katsayısı</dt><dd>{evaluation.usageCoefficient?.decimal ?? '—'}</dd></div>
                <div><dt>Genel çarpan</dt><dd>{evaluation.generalModifiers?.multiplier.decimal ?? '—'}</dd></div>
                <div><dt>Yuvarlama öncesi</dt><dd>{formatMoney(evaluation.rawResultMinor == null ? null : Number(evaluation.rawResultMinor.decimal))}</dd></div>
                <div><dt>Rayiç %30 tavanı</dt><dd>{formatMoney(evaluation.capMinor == null ? null : Number(evaluation.capMinor.decimal))}</dd></div>
              </> : <><div><dt>Kusur sonrası taslak</dt><dd>{formatMoney(evaluation.faultAdjustedValueLossMinor)}</dd></div><div><dt>Sonraki emsal</dt><dd>{evaluation.qualifyingPostComparableCount}</dd></div></>}
              <div><dt>Geçerli emsal</dt><dd>{evaluation.qualifyingPreComparableCount}</dd></div><div><dt>Yuvarlama</dt><dd>{evaluation.roundingRule === 'ceil_500_try' ? '500 TL’ye yukarı' : 'Kuruşa yuvarlama'}</dd></div></dl>
            {evaluation.partBreakdown && <ul className="value-loss-reasoning">{evaluation.partBreakdown.map((part) => <li key={`${part.stableRuleId}-${part.operation}`}>{part.sourceLabel}: {part.coefficient.decimal}{!part.included && ' (hesap dışı)'}</li>)}</ul>}
            <details><summary>Hesaplama yöntemi ve kaynak</summary><ul className="value-loss-reasoning">{evaluation.reasoning.map((reason) => <li key={reason}>{reason}</li>)}</ul>{evaluation.ruleSources.map((sourceItem) => sourceItem.url === undefined
              ? <div key={sourceItem.code}><strong>{sourceItem.title}</strong><span>{sourceItem.locator}</span></div>
              : <a key={sourceItem.code} href={sourceItem.url} target="_blank" rel="noreferrer"><strong>{sourceItem.title}</strong><span>{sourceItem.locator}</span></a>)}</details>
          </>}
        </section>

        <section className="info-panel value-loss-uncertainties">
          <header><h2>Kontrol Bekleyenler</h2><span>{evaluation?.uncertainties.length ?? '—'}</span></header>
          {evaluation === null ? <p>Önizleme henüz oluşturulmadı.</p> : evaluation.uncertainties.length === 0 ? <p className="text-success"><CheckCircle2 size={14} /> Bloklayan belirsizlik yok.</p> : <ul>{evaluation.uncertainties.map((uncertainty, index) => <li key={`${uncertainty.code}-${uncertainty.field}-${index}`}><AlertTriangle size={14} /><div><span>{uncertainty.reason}</span></div></li>)}</ul>}
        </section>

        <section className="info-panel value-loss-approval">
          <header><h2>Taslak ve İnsan Onayı</h2><ShieldCheck size={16} /></header>
          {currentApproved !== null && currentVersion?.id !== currentApproved.id && <p>Mevcut onaylı revision v{currentApproved.assessmentVersion} salt okunur tutuluyor; bu taslak onaylanana kadar kapanışta kullanılmaya devam eder.</p>}
          {currentVersion === null ? <p>Önce hesaplama taslağı oluşturun.</p> : currentVersion.status === 'draft' ? <>
            <label><input type="checkbox" checked={submitConfirmed} onChange={(event) => setSubmitConfirmed(event.target.checked)} /> Taslağı ve kanıt özetini inceledim; insan onayına gönderiyorum.</label>
            <button className="button button--primary button--block" type="button" disabled={!canWrite || !submitConfirmed || valueLoss.busy || !currentVersion.evaluation.canSubmitForApproval} onClick={() => void run('submit', valueLoss.submit, 'Taslak insan onayına gönderildi.')}>Onaya Gönder</button>
            {!currentVersion.evaluation.canSubmitForApproval && <small>Bloklayan belirsizlikler çözülmeden submit yapılamaz.</small>}
          </> : currentVersion.status === 'control_required' ? <p>Belirsizlikler çözülmeden onaya gönderilemez. Yeni sürüm oluşturun.</p> : currentVersion.status === 'awaiting_approval' ? canApprove ? <>
            <label><input type="checkbox" checked={approvalConfirmed} onChange={(event) => setApprovalConfirmed(event.target.checked)} /> Kanıtları ve hesaplama taslağını insan olarak inceledim.</label>
            <label className="form-field"><span>Onay / red gerekçesi</span><textarea value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} maxLength={500} /></label>
            <div className="value-loss-approval__actions"><button className="button button--primary" type="button" disabled={!approvalConfirmed || valueLoss.busy} onClick={() => void run('approve', (key) => valueLoss.approve(nullableText(approvalReason), key), 'Değer kaybı taslağı insan onayıyla kesinleştirildi.')}>İnsan Onayı Ver</button><button className="button button--danger" type="button" disabled={approvalReason.trim().length === 0 || valueLoss.busy} onClick={() => void run('reject', (key) => valueLoss.reject(approvalReason.trim(), key), 'Taslak gerekçeli olarak reddedildi.')}>Reddet</button></div>
          </> : <p>Eksper veya yönetici insan onayı bekleniyor.</p> : <div className="value-loss-approval__final"><strong>{currentVersion.humanApprovalStatus === 'approved' ? 'İnsan onaylı sonuç' : 'İnsan tarafından reddedildi'}</strong><span>{currentVersion.approvalReason ?? 'Gerekçe girilmedi.'}</span><small>{currentVersion.approvedAt ?? '—'}</small></div>}
        </section>

        <section className="info-panel value-loss-history">
          <header><h2>Sürüm Geçmişi</h2><History size={16} /></header>
          {valueLoss.versions.length === 0 ? <p>Henüz sürüm yok.</p> : <ol>{valueLoss.versions.map((version) => <li key={version.id}><button type="button" className={shownVersion?.id === version.id ? 'is-active' : ''} onClick={() => setSelectedVersionId(version.id)}><span><strong>Hesap v{version.assessmentVersion}</strong><small>{new Date(version.createdAt).toLocaleString('tr-TR')}</small></span><span className={`status-pill ${statusClass(version.status)}`}>{STATUS_LABELS[version.status] ?? version.status}</span></button></li>)}</ol>}
          {shownVersion !== null && currentVersion !== null && shownVersion.id !== currentVersion.id && <button className="button button--secondary button--block" type="button" onClick={() => setSelectedVersionId(currentVersion.id)}>Güncel Sürüme Dön</button>}
          {currentVersion !== null && <button className="button button--secondary button--block" type="button" onClick={() => hydrate(currentVersion)}>Güncel Sürümü Forma Al</button>}
        </section>
      </aside>
    </div>

    {(localMessage ?? valueLoss.errorMessage) && <div className={`case-form-alert ${(localMessage ?? valueLoss.errorMessage)?.includes('oluşturuldu') || (localMessage ?? '').includes('gönderildi') || (localMessage ?? '').includes('kesinleştirildi') ? 'case-form-alert--success' : 'case-form-alert--error'}`} role="status"><AlertTriangle size={16} /><span>{localMessage ?? valueLoss.errorMessage}</span>{valueLoss.status === 'conflict' && <button className="button button--secondary" type="button" onClick={reloadCurrent}>Güncel Veriyi Yükle</button>}</div>}
  </section>
}
