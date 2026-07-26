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
  }
}

function defaultComparables(): readonly ComparableDraft[] {
  return [
    emptyComparable('pre_accident'), emptyComparable('pre_accident'), emptyComparable('pre_accident'),
    emptyComparable('post_repair'), emptyComparable('post_repair'), emptyComparable('post_repair'),
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
  const [comparables, setComparables] = useState<readonly ComparableDraft[]>(defaultComparables)
  const [documentSupports, setDocumentSupports] = useState<Readonly<Record<string, readonly TrafficValueLossEvidenceField[]>>>({})
  const [submitConfirmed, setSubmitConfirmed] = useState(false)
  const [approvalConfirmed, setApprovalConfirmed] = useState(false)
  const [approvalReason, setApprovalReason] = useState('')
  const [previewConfirmed, setPreviewConfirmed] = useState(false)
  const [localMessage, setLocalMessage] = useState<string | null>(null)
  const hydratedVersionId = useRef<string | null>(null)
  const keys = useRef<Partial<Record<'create' | 'submit' | 'approve' | 'reject', string>>>({})

  const roles = session.user?.roles ?? []
  const canWrite = roles.some((role) => ['admin', 'expert', 'case_manager'].includes(role))
  const canApprove = roles.some((role) => ['admin', 'expert'].includes(role))
  const readyDocuments = (documents.data?.documents ?? []).filter((document) => (
    document.status === 'ready' && document.hashVerified && document.sizeVerified && document.verifiedAt !== null
  ))
  const currentVersion = valueLoss.assessment?.currentVersion ?? null
  const currentApproved = valueLoss.currentApproved
  const selectedCatalogPart = valueLoss.catalog?.parts.find((part) =>
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
      setAntiqueStatus(input.realMarket.eligibilityFacts.antiqueOrCollector === null ? 'unknown' : input.realMarket.eligibilityFacts.antiqueOrCollector ? 'yes' : 'no')
      setPriorHeavyStatus(input.realMarket.eligibilityFacts.priorHeavyDamage === null ? 'unknown' : input.realMarket.eligibilityFacts.priorHeavyDamage ? 'yes' : 'no')
      setForeignPlate(input.realMarket.eligibilityFacts.foreignPlate)
      setForeignMarketVerified(input.realMarket.eligibilityFacts.foreignMarketEvidenceVerified)
      setRealMarketParts(input.realMarket.parts.map((part) => ({ ...part, id: rowId('real-part') })))
    }
    setDamageParts(input.damageParts.length === 0 ? [emptyDamagePart()] : input.damageParts.map((part) => ({ ...part, id: rowId('part') })))
    const evidenceById = new Map(version.evidence.map((evidence) => [evidence.id, evidence]))
    setComparables(version.comparables.length === 0 ? defaultComparables() : version.comparables.map((comparable) => {
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
    if (source !== 'api' || item.type !== 'Trafik') return
    void loadPartCatalog(VEHICLE_GROUPS[vehicleType]).catch(() => {
      // Hook hata durumunu kullanıcıya taşır; mock veya sabit katalog fallback'i yoktur.
    })
  }, [item.type, loadPartCatalog, source, vehicleType])

  useEffect(() => {
    if (currentVersion === null || hydratedVersionId.current === currentVersion.id) return
    hydrate(currentVersion)
    setSelectedVersionId(currentVersion.id)
  }, [currentVersion, hydrate])

  const updatePart = (id: string, patch: Partial<DamagePartDraft>) => {
    setDamageParts((items) => items.map((part) => part.id === id ? { ...part, ...patch } : part))
  }
  const updateRealMarketPart = (id: string, patch: Partial<RealMarketPartDraft>) => {
    setRealMarketParts((items) => items.map((part) => part.id === id ? { ...part, ...patch } : part))
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
    setRealMarketParts((items) => [...items, {
      id: rowId('real-part'),
      stableRuleId: selected.stableRuleId,
      operation: catalogOperation,
      paintMode: catalogOperation === 'paint' ? 'full' : null,
      newPartPriceMinor: null,
      repairLaborMinor: null,
      partPriceAvailability: 'unavailable',
      priorPartState: 'none',
      treatment: 'standard',
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
    const amounts = comparables.filter((item) => item.side === side).map((item) => Number(item.amount)).filter((value) => Number.isFinite(value) && value >= 0)
    if (amounts.length === 0) return ''
    return String(Math.round((amounts.reduce((sum, value) => sum + value, 0) / amounts.length) * 100) / 100)
  }

  const buildInput = async (confirmedPreviewHash: string | null = null): Promise<TrafficValueLossDraftInput> => {
    const parsedParts = damageParts.filter((part) => part.partCode.trim().length > 0 || part.partName.trim().length > 0)
    if (parsedParts.some((part) => part.partCode.trim().length === 0 || part.partName.trim().length === 0)) {
      throw new Error('Her hasar parçası için kod ve ad girilmelidir.')
    }
    const inputComparables: TrafficValueLossComparableInput[] = []
    const marketEvidence: TrafficValueLossEvidenceInput[] = []
    for (const comparable of comparables) {
      const hasAnyValue = [comparable.amount, comparable.mileage, comparable.reference].some((value) => value.trim().length > 0)
      if (!hasAnyValue) continue
      const amountMinor = moneyMinor(comparable.amount)
      const comparableMileage = nullableInteger(comparable.mileage)
      const reference = comparable.reference.trim()
      if (amountMinor === null || comparableMileage === null || comparable.observedAt.length === 0
        || (!reference.startsWith('https://') && !reference.startsWith('ref:'))) {
        throw new Error('Her emsal için tutar, kilometre, tarih ve güvenli https:// veya ref: kaynağı gereklidir.')
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
        excluded: false,
        exclusionReason: null,
      })
    }
    const manualFacts = {
      evaluatedOn, heavyStatus, make, model, variant, modelYear, mileage, usageType, faultPercent,
      preValue, postValue, damageParts: parsedParts,
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
    if (selectedMarketValue !== null && marketValueReason.trim().length === 0) {
      throw new Error('Onaylı rayiç kaynağı bağlı değilse kullanıcı rayiç girişi için gerekçe zorunludur.')
    }
    if (selectedDamageAmount !== caseDamageAmount && damageAmountReason.trim().length === 0) {
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
        mileage: nullableInteger(mileage),
        usageType: nullableText(usageType),
      },
      faultRateBasisPoints: fault,
      preAccidentMarketValueMinor: moneyMinor(preValue),
      postRepairMarketValueMinor: moneyMinor(postValue),
      damageParts: parsedParts.map((part) => ({
        partCode: part.partCode,
        partName: part.partName,
        repairAction: part.repairAction,
        priorDamage: part.priorDamage,
      })),
      comparables: inputComparables,
      evidence,
      realMarket: {
        vehicleType,
        vehicleGroupCode: VEHICLE_GROUPS[vehicleType],
        usageMetric: vehicleType === 'İŞ MAKİNESİ' || vehicleType === 'TARIM MAKİNESİ'
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
      },
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

  return <section className="value-loss-workspace" aria-labelledby="traffic-value-loss-heading">
    <header className="value-loss-workspace__header">
      <div><span className="eyebrow">Paket 34 · gerçek API</span><h2 id="traffic-value-loss-heading">Trafik Değer Kaybı Çalışma Alanı</h2><p>Girdi ve kanıtlar sürümlenir; insan onaylı sürüm kullanıcı önizlemesiyle nihai rapora dönüştürülür.</p></div>
      <div className="value-loss-rule"><span>Kural sürümü</span><strong>{currentVersion?.ruleVersion ?? '2026.07.01.1'}</strong><small>Yürürlük 01.07.2026</small></div>
    </header>

    <div className="value-loss-summary" aria-label="Değer kaybı güncel özet">
      <div><span>Assessment</span><strong>{valueLoss.assessment === null ? 'Henüz yok' : `v${valueLoss.assessment.version}`}</strong></div>
      <div><span>Sonuç</span><strong>{shownVersion === null ? '—' : STATUS_LABELS[shownVersion.evaluation.eligibilityStatus] ?? shownVersion.evaluation.eligibilityStatus}</strong></div>
      <div><span>Brüt taslak</span><strong>{formatMoney(shownVersion?.evaluation.grossValueLossMinor ?? null)}</strong></div>
      <div><span>Kusur sonrası</span><strong>{formatMoney(shownVersion?.evaluation.faultAdjustedValueLossMinor ?? null)}</strong></div>
      <div><span>Belirsizlik</span><strong>{shownVersion?.evaluation.uncertainties.length ?? 0}</strong></div>
      <div><span>İnsan onayı</span><strong>{shownVersion === null ? 'Bekliyor' : STATUS_LABELS[shownVersion.status] ?? shownVersion.status}</strong></div>
    </div>

    <div className="value-loss-grid">
      <div className="value-loss-main">
        <section className="info-panel value-loss-form-panel">
          <header><div><h2>1. Uygunluk ve Kanıt Kontrolü</h2><span>Eksik veya belirsiz kanıt eligible sonuç üretmez</span></div><ShieldCheck size={16} /></header>
          <div className="value-loss-form-grid">
            <label className="form-field"><span>Antika / koleksiyon araç</span><select value={antiqueStatus} onChange={(event) => setAntiqueStatus(event.target.value as typeof antiqueStatus)}><option value="unknown">Kanıt bekleniyor</option><option value="no">Hayır</option><option value="yes">Evet</option></select></label>
            <label className="form-field"><span>Önceki ağır hasar</span><select value={priorHeavyStatus} onChange={(event) => setPriorHeavyStatus(event.target.value as typeof priorHeavyStatus)}><option value="unknown">Kanıt bekleniyor</option><option value="no">Hayır</option><option value="yes">Evet</option></select></label>
            <label className="form-field"><span>Mevcut ağır / tam hasar</span><select value={heavyStatus} onChange={(event) => setHeavyStatus(event.target.value as typeof heavyStatus)}><option value="unknown">Kanıt bekleniyor</option><option value="no">Hayır</option><option value="yes">Evet</option></select></label>
            <label><input type="checkbox" checked={foreignPlate} onChange={(event) => setForeignPlate(event.target.checked)} /> Yabancı plaka</label>
            {foreignPlate && <label><input type="checkbox" checked={foreignMarketVerified} onChange={(event) => setForeignMarketVerified(event.target.checked)} /> Yabancı ülke rayiç kanıtı doğrulandı</label>}
          </div>
        </section>

        <section className="info-panel value-loss-form-panel">
          <header><div><h2>2. Araç Bilgileri</h2><span>Kaza tarihine göre immutable kural sürümü seçilir</span></div><Calculator size={16} /></header>
          <div className="value-loss-form-grid">
            <label className="form-field"><span>Değerlendirme tarihi</span><input type="date" value={evaluatedOn} onChange={(event) => setEvaluatedOn(event.target.value)} /></label>
            <label className="form-field"><span>Ağır / tam hasar</span><select value={heavyStatus} onChange={(event) => setHeavyStatus(event.target.value as typeof heavyStatus)}><option value="unknown">Belirsiz</option><option value="no">Hayır</option><option value="yes">Evet</option></select></label>
            <label className="form-field"><span>Kusur oranı (%)</span><input type="number" min="0" max="100" step=".01" value={faultPercent} onChange={(event) => setFaultPercent(event.target.value)} /></label>
            <label className="form-field"><span>Marka</span><input value={make} onChange={(event) => setMake(event.target.value)} /></label>
            <label className="form-field"><span>Model</span><input value={model} onChange={(event) => setModel(event.target.value)} /></label>
            <label className="form-field"><span>Varyant</span><input value={variant} onChange={(event) => setVariant(event.target.value)} /></label>
            <label className="form-field"><span>Model yılı</span><input type="number" min="1900" max="2200" value={modelYear} onChange={(event) => setModelYear(event.target.value)} /></label>
            <label className="form-field"><span>Kilometre</span><input type="number" min="0" value={mileage} onChange={(event) => setMileage(event.target.value)} /></label>
            <label className="form-field"><span>Kullanım şekli</span><input value={usageType} onChange={(event) => setUsageType(event.target.value)} placeholder="Hususi" /></label>
            <label className="form-field"><span>Araç türü</span><select value={vehicleType} onChange={(event) => setVehicleType(event.target.value as keyof typeof VEHICLE_GROUPS)}>{Object.keys(VEHICLE_GROUPS).map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            <label className="form-field"><span>Parça tablo grubu</span><input value={VEHICLE_GROUPS[vehicleType]} readOnly /></label>
          </div>
        </section>

        <section className="info-panel value-loss-form-panel">
          <header><div><h2>3. Rayiç ve Hasar Tutarı</h2><span>Para alanları TL; API minor-unit olarak saklar</span></div><Scale size={16} /></header>
          <div className="value-loss-form-grid">
            <label className="form-field"><span>Kaza öncesi piyasa değeri</span><input type="number" min="0" step=".01" value={preValue} onChange={(event) => setPreValue(event.target.value)} /></label>
            <label className="form-field"><span>Rayiç giriş gerekçesi</span><input value={marketValueReason} onChange={(event) => setMarketValueReason(event.target.value)} placeholder="Onaylı rayiç revision referansı veya manuel gerekçe" /></label>
            <label className="form-field"><span>Onaylı/final hasar tutarı</span><input type="number" min="0" step=".01" value={damageAmount} onChange={(event) => setDamageAmount(event.target.value)} /></label>
            <label className="form-field"><span>Hasar tutarı değişiklik gerekçesi</span><input value={damageAmountReason} onChange={(event) => setDamageAmountReason(event.target.value)} /></label>
            <label className="form-field"><span>Onarım sonrası piyasa değeri</span><input type="number" min="0" step=".01" value={postValue} onChange={(event) => setPostValue(event.target.value)} /></label>
            <div className="value-loss-average-actions"><button className="button button--secondary" type="button" onClick={() => setPreValue(comparableAverage('pre_accident'))}>Önceki emsal ortalaması</button><button className="button button--secondary" type="button" onClick={() => setPostValue(comparableAverage('post_repair'))}>Sonraki emsal ortalaması</button></div>
          </div>
        </section>

        <section className="info-panel value-loss-form-panel">
          <header><div><h2>4. Genel Değerlendirme Parametreleri</h2><span>Kullanım, ticari/kiralık ve önceki hasar modifiyerleri</span></div><Calculator size={16} /></header>
          <div className="value-loss-form-grid">
            <label><input type="checkbox" checked={commercialOrRental} onChange={(event) => setCommercialOrRental(event.target.checked)} /> Ticari veya kiralık kullanım</label>
            <label className="form-field"><span>Önceki hasar sayısı</span><input type="number" min="0" value={previousDamageCount} onChange={(event) => setPreviousDamageCount(event.target.value)} /></label>
          </div>
        </section>

        <section className="info-panel value-loss-parts">
          <header><div><h2>Parça Kataloğu</h2><span>Yalnız {VEHICLE_GROUPS[vehicleType]} grubunun desteklediği operasyonlar</span></div></header>
          <div className="value-loss-average-actions">
            <input
              list="value-loss-part-catalog"
              value={catalogQuery}
              onChange={(event) => {
                const query = event.target.value
                setCatalogQuery(query)
                const selected = valueLoss.catalog?.parts.find((part) => part.stableRuleId === query || part.label === query)
                const firstSupported = selected?.supportedOperations[0]
                if (firstSupported !== undefined) setCatalogOperation(firstSupported)
              }}
              placeholder="Parça ara…"
              aria-label="Parça kataloğunda ara"
            />
            <datalist id="value-loss-part-catalog">{valueLoss.catalog?.parts.map((part) => <option key={part.stableRuleId} value={part.label} />)}</datalist>
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
            <button className="button button--secondary" type="button" onClick={addCatalogPart}><CirclePlus size={14} /> Katalogdan Ekle</button>
          </div>
          {(['replacement', 'repair', 'paint'] as const).map((operation, sectionIndex) => <div key={operation}>
            <h3>{sectionIndex + 5}. {operation === 'replacement' ? 'Değişen Parçalar' : operation === 'repair' ? 'Onarılan Parçalar' : 'Boyanan Parçalar'}</h3>
            <div className="value-loss-parts__rows">{realMarketParts.filter((part) => part.operation === operation).map((part) => {
              const catalogPart = valueLoss.catalog?.parts.find((item) => item.stableRuleId === part.stableRuleId)
              return <div className="value-loss-part-row" key={part.id}>
                <strong>{catalogPart?.label ?? part.stableRuleId}</strong>
                {operation === 'repair' && <>
                  <select aria-label="Parça fiyatı durumu" value={part.partPriceAvailability} onChange={(event) => updateRealMarketPart(part.id, { partPriceAvailability: event.target.value as RealMarketPartDraft['partPriceAvailability'] })}><option value="available">Parça fiyatı var</option><option value="unavailable">Parça fiyatı yok / heavy</option></select>
                  <input aria-label="Yeni parça fiyatı" type="number" min="0" placeholder="Parça fiyatı TL" value={part.newPartPriceMinor === null ? '' : part.newPartPriceMinor / 100} onChange={(event) => updateRealMarketPart(part.id, { newPartPriceMinor: moneyMinor(event.target.value) })} />
                  <input aria-label="Onarım işçiliği" type="number" min="0" placeholder="İşçilik TL" value={part.repairLaborMinor === null ? '' : part.repairLaborMinor / 100} onChange={(event) => updateRealMarketPart(part.id, { repairLaborMinor: moneyMinor(event.target.value) })} />
                </>}
                {operation === 'paint' && <select aria-label="Boya türü" value={part.paintMode ?? 'full'} onChange={(event) => updateRealMarketPart(part.id, { paintMode: event.target.value as 'full' | 'local' })}><option value="full">Tam boya</option><option value="local">Lokal boya</option></select>}
                <small>Katsayı: {operation === 'replacement' ? catalogPart?.coefficients.replacement : operation === 'paint' ? `${catalogPart?.coefficients.paint?.full}/${catalogPart?.coefficients.paint?.local}` : `${catalogPart?.coefficients.repair?.light}/${catalogPart?.coefficients.repair?.medium}/${catalogPart?.coefficients.repair?.heavy}`}</small>
                <button className="icon-button" type="button" aria-label="Katalog parçasını kaldır" onClick={() => setRealMarketParts((items) => items.filter((item) => item.id !== part.id))}><Trash2 size={14} /></button>
              </div>
            })}</div>
          </div>)}
        </section>

        <section className="info-panel value-loss-parts">
          <header><div><h2>Hasarlı Parça ve İşlemler</h2><span>Önceki hasar belirsizliği ayrıca gösterilir</span></div><button className="button button--secondary" type="button" onClick={() => setDamageParts((items) => [...items, emptyDamagePart()])}><CirclePlus size={14} /> Parça Ekle</button></header>
          <div className="value-loss-parts__rows">{damageParts.map((part) => <div className="value-loss-part-row" key={part.id}>
            <input aria-label="Parça kodu" placeholder="SOL_CAMURLUK" value={part.partCode} onChange={(event) => updatePart(part.id, { partCode: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '_') })} />
            <input aria-label="Parça adı" placeholder="Sol çamurluk" value={part.partName} onChange={(event) => updatePart(part.id, { partName: event.target.value })} />
            <select aria-label="Onarım işlemi" value={part.repairAction} onChange={(event) => updatePart(part.id, { repairAction: event.target.value as DamagePartDraft['repairAction'] })}><option value="repair_paint">Onarım + boya</option><option value="replace_paint">Değişim + boya</option><option value="paint">Boya</option><option value="replace">Değişim</option><option value="paintless_repair">Boyasız onarım</option></select>
            <select aria-label="Önceki hasar" value={part.priorDamage} onChange={(event) => updatePart(part.id, { priorDamage: event.target.value as DamagePartDraft['priorDamage'] })}><option value="unknown">Önceki hasar belirsiz</option><option value="no">Önceki hasar yok</option><option value="yes">Önceki hasar var</option></select>
            <button className="icon-button" type="button" aria-label="Parçayı kaldır" disabled={damageParts.length === 1} onClick={() => setDamageParts((items) => items.filter((item) => item.id !== part.id))}><Trash2 size={14} /></button>
          </div>)}</div>
        </section>

        <section className="info-panel value-loss-evidence">
          <header><div><h2>Doğrulanmış Belge Kanıtları</h2><span>{documentStateMessage}</span></div><FileCheck2 size={16} /></header>
          {readyDocuments.length === 0 ? <p>{documentStateMessage}</p> : <div className="value-loss-document-list">{readyDocuments.map((document) => {
            const selected = documentSupports[document.id] !== undefined
            return <article key={document.id}><label><input type="checkbox" checked={selected} onChange={() => toggleDocument(document.id)} /><span><strong>{DOCUMENT_LABELS[document.documentType] ?? document.documentType}</strong><small>{document.displayName} · v{document.versionNumber} · fiziksel doğrulandı</small></span></label>
              {selected && <div className="value-loss-supports">{SUPPORT_OPTIONS.map((support) => <label key={support.value}><input type="checkbox" checked={(documentSupports[document.id] ?? []).includes(support.value)} onChange={() => toggleSupport(document.id, support.value)} />{support.label}</label>)}</div>}
            </article>
          })}</div>}
        </section>

        <section className="info-panel value-loss-comparables">
          <header><div><h2>Piyasa Emsalleri</h2><span>Her taraf için en az 3 doğrulanmış emsal · son 30 gün · ±%10 km ofis politikası</span></div><div><button className="button button--secondary" type="button" onClick={() => setComparables((items) => [...items, emptyComparable('pre_accident')])}>Önce Ekle</button><button className="button button--secondary" type="button" onClick={() => setComparables((items) => [...items, emptyComparable('post_repair')])}>Sonra Ekle</button></div></header>
          <div className="table-scroll"><table className="data-table value-loss-comparable-table"><thead><tr><th>Taraf</th><th>Tutar TL</th><th>KM</th><th>Tarih</th><th>Kaynak</th><th>Kontrol</th><th /></tr></thead><tbody>{comparables.map((comparable) => <tr key={comparable.id}>
            <td><select aria-label="Emsal tarafı" value={comparable.side} onChange={(event) => updateComparable(comparable.id, { side: event.target.value as ComparableDraft['side'] })}><option value="pre_accident">Kaza öncesi</option><option value="post_repair">Onarım sonrası</option></select></td>
            <td><input aria-label="Emsal tutarı" type="number" min="0" step=".01" value={comparable.amount} onChange={(event) => updateComparable(comparable.id, { amount: event.target.value })} /></td>
            <td><input aria-label="Emsal kilometresi" type="number" min="0" value={comparable.mileage} onChange={(event) => updateComparable(comparable.id, { mileage: event.target.value })} /></td>
            <td><input aria-label="Emsal tarihi" type="date" value={comparable.observedAt} onChange={(event) => updateComparable(comparable.id, { observedAt: event.target.value })} /></td>
            <td><input aria-label="Emsal kaynağı" value={comparable.reference} placeholder="https://… veya ref:…" onChange={(event) => updateComparable(comparable.id, { reference: event.target.value })} /></td>
            <td><label><input type="checkbox" checked={comparable.verified} onChange={(event) => updateComparable(comparable.id, { verified: event.target.checked })} /> Doğrulandı</label><label><input type="checkbox" checked={comparable.conflict} onChange={(event) => updateComparable(comparable.id, { conflict: event.target.checked })} /> Çelişkili</label></td>
            <td><button className="icon-button" type="button" aria-label="Emsali kaldır" onClick={() => setComparables((items) => items.filter((item) => item.id !== comparable.id))}><Trash2 size={14} /></button></td>
          </tr>)}</tbody></table></div>
        </section>

        <div className="value-loss-form-actions">
          <span>8. Hesap Dökümü · Önizleme veri yazmaz; onaylanan önizleme yeni immutable revision üretir.</span>
          <button className="button button--secondary" type="button" disabled={!canWrite || valueLoss.busy} onClick={() => void (async () => {
            try {
              await valueLoss.preview(await buildInput())
              setPreviewConfirmed(false)
              setLocalMessage('Hesap önizlemesi üretildi; dökümü inceleyip açıkça onaylayın.')
            } catch (error) {
              if (error instanceof Error && error.name !== 'TrafficValueLossError') setLocalMessage(error.message)
            }
          })()}>{valueLoss.busy ? <LoaderCircle className="spin" size={14} /> : <Calculator size={14} />} Önizleme Oluştur</button>
          {valueLoss.previewResult !== null && <>
            <span>Ham: {valueLoss.previewResult.evaluation.rawResultMinor?.decimal ?? '—'} minor · %30 tavan: {valueLoss.previewResult.evaluation.capMinor?.decimal ?? '—'} · capped: {valueLoss.previewResult.evaluation.cappedResultMinor?.decimal ?? '—'} · 500 TRY ceiling: {formatMoney(valueLoss.previewResult.evaluation.roundingResultMinor ?? null)} · nihai: {formatMoney(valueLoss.previewResult.evaluation.finalResultMinor ?? null)}</span>
            <label><input type="checkbox" checked={previewConfirmed} onChange={(event) => setPreviewConfirmed(event.target.checked)} /> Önizleme girdilerini, kanıtları ve hesap dökümünü inceledim.</label>
            <button className="button button--primary" type="button" disabled={!canWrite || !previewConfirmed || valueLoss.busy} onClick={() => void run('create', async (key) => valueLoss.createVersion(await buildInput(valueLoss.previewResult?.previewHash ?? null), key), 'Yeni hesaplama taslağı ve sürümü oluşturuldu.')}>Onaylanan Önizlemeyi Sürümle</button>
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
          <header><h2>8. Hesap Dökümü</h2>{shownVersion && <span className={`status-pill ${statusClass(shownVersion.status)}`}>{STATUS_LABELS[shownVersion.status] ?? shownVersion.status}</span>}</header>
          {shownVersion === null ? <p>Henüz sürümlü taslak yok. Girdileri ve kanıtları ekleyip hesaplayın.</p> : <>
            <dl><div><dt>Brüt değer farkı</dt><dd>{formatMoney(shownVersion.evaluation.grossValueLossMinor)}</dd></div><div><dt>Kusur sonrası taslak</dt><dd>{formatMoney(shownVersion.evaluation.faultAdjustedValueLossMinor)}</dd></div><div><dt>Önceki emsal</dt><dd>{shownVersion.evaluation.qualifyingPreComparableCount}</dd></div><div><dt>Sonraki emsal</dt><dd>{shownVersion.evaluation.qualifyingPostComparableCount}</dd></div><div><dt>Yuvarlama</dt><dd>{shownVersion.evaluation.roundingRule}</dd></div></dl>
            <ul className="value-loss-reasoning">{shownVersion.evaluation.reasoning.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            <details><summary>9. Sürüm ve Kaynak</summary>{shownVersion.evaluation.ruleSources.map((sourceItem) => sourceItem.url === undefined
              ? <div key={sourceItem.code}><strong>{sourceItem.title}</strong><span>{sourceItem.locator}</span></div>
              : <a key={sourceItem.code} href={sourceItem.url} target="_blank" rel="noreferrer"><strong>{sourceItem.title}</strong><span>{sourceItem.locator}</span></a>)}</details>
          </>}
        </section>

        <section className="info-panel value-loss-uncertainties">
          <header><h2>Belirsizlik İncelemesi</h2><span>{shownVersion?.evaluation.uncertainties.length ?? 0}</span></header>
          {shownVersion === null || shownVersion.evaluation.uncertainties.length === 0 ? <p className="text-success"><CheckCircle2 size={14} /> Bloklayan belirsizlik yok.</p> : <ul>{shownVersion.evaluation.uncertainties.map((uncertainty) => <li key={`${uncertainty.code}-${uncertainty.field}`}><AlertTriangle size={14} /><div><strong>{uncertainty.code}</strong><span>{uncertainty.reason}</span><small>{uncertainty.field}</small></div></li>)}</ul>}
        </section>

        <section className="info-panel value-loss-approval">
          <header><h2>10. Submit ve İnsan Onayı</h2><ShieldCheck size={16} /></header>
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
