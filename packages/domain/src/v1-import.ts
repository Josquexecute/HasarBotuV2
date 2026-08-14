import { parsePlateNumber, plateSearchKey, type PlateNumber } from './plate-number.js'
import { CASE_TYPES, type CaseType } from './case-type.js'

/**
 * V1 -> V2 aktarim saf (DB'siz, dosya-sistemsiz) domain mantigi.
 *
 * V1 kaynagi (`_HASARBOTU/takip.json`) READ-ONLY'dir; bu dosya hicbir zaman
 * yazmaz/siler. Burasi yalniz: (a) plaka-klasor adini ayristirir, (b) V1
 * `claimType`'i V2 `CaseType`'a esler ('unknown' AYRI, tahmin edilen bir
 * CaseType DEGIL), (c) V1'in uc farkli "kapali mi" sinyalini (klasor-konumu,
 * `caseIdentity.isClosedFolder`, `status.kapaliMi`) celiskisiz/celiskili
 * olarak birlestirir, (d) bir V1 alaniyla V2'de zaten var olan bir alani
 * karsilastirip guvenli-backfill/celiski/no-op karari verir. DB sorgusu,
 * dosya okuma, hash hesaplama BURADA YOKTUR -- store.ts'in isidir.
 */

/** V1'in kendi klasor-adi kurali: plaka + istege bagli " - <ek>" (AGENTS.md, ayni plaka ikinci dosya). */
export interface V1PlateFolderName {
  readonly plate: PlateNumber
  readonly suffix: string | null
}

const FOLDER_SUFFIX_PATTERN = / - (.+)$/u

/**
 * `parsePlateNumber` bilerek TOLERANSLIDIR (yabanci/kisisellestirilmis plaka
 * serbest-metin girisi icin) -- katı Turk segment deseniyle eslesmese bile
 * normalize edilmis bir "canonical" ile basarili doner. Klasor-adi
 * SINIFLANDIRMASI icin bu yeterli DEGIL ("DEĞER KAYBI" gibi plaka-olmayan
 * bir klasor adi da boylece "basarili" sayilirdi). Bu yuzden sonuc EK olarak
 * katı "İL KOD RAKAM" 3-parca seklini karsilamali.
 */
const STRICT_CANONICAL_SHAPE = /^\d{2} [A-Z]{1,3} \d{2,4}$/u

/**
 * Klasor adini ayristirir. Sonek varsa (` - 2`, ` - AGIR HASARLI` gibi) once
 * kirpilip kalan kisim `parsePlateNumber` ile dogrulanir -- plaka dogrulama
 * mantigi TEKRAR YAZILMAZ, mevcut/test edilmis fonksiyon kullanilir; sonuc
 * EK olarak katı Turk plaka seklini karsilamiyorsa (yani yalniz toleransli
 * fallback ile "basarili" olduysa) yine de `null` doner. Plaka kismi
 * gecerli degilse (Unicode/format sapmasi, tanimsiz kisaltma, "DEĞER KAYBI"
 * gibi plaka-olmayan klasor adlari) `null` doner -- TAHMIN edilerek bir
 * plakaya zorlanmaz, cagiran taraf bunu `unparseable_folder_name` olarak
 * isaretlemelidir.
 */
export function parseV1PlateFolderName(folderName: string): V1PlateFolderName | null {
  const trimmed = folderName.trim()
  const match = FOLDER_SUFFIX_PATTERN.exec(trimmed)
  const platePart = match === null ? trimmed : trimmed.slice(0, match.index)
  const suffix = match === null ? null : match[1].trim()
  const parsed = parsePlateNumber(platePart)
  if (!parsed.ok) return null
  if (!STRICT_CANONICAL_SHAPE.test(parsed.value)) return null
  return { plate: parsed.value, suffix: suffix !== null && suffix.length > 0 ? suffix : null }
}

export type V1ClaimType = CaseType | 'unknown'

export type V1ClaimTypeFilenameEvidenceKind =
  | 'k_ruhsat'
  | 'm_ruhsat'
  | 's_ruhsat'
  | 'kasko_claim_policy'
  | 'kasko_policy_context'
  | 'm_traffic_policy'
  | 'traffic_policy_context'
  | 'ktt_context'
  | 'accident_report_context'
  | 'statement_context'

export type V1ClaimTypeEvidenceDecisionReason =
  | 'k_ruhsat'
  | 'm_ruhsat'
  | 'kasko_policy'
  | 'm_traffic_policy'
  | 'sidecar_claim_type'
  | 'sidecar_corroborated_over_conflicting_ruhsat'
  | 'conflicting_k_m_evidence'
  | 'sidecar_filename_evidence_conflict'
  | 'conflicting_claim_document_evidence'
  | 'no_deterministic_evidence'

export interface V1ClaimTypeEvidenceDecision {
  readonly state: 'resolved' | 'human_required'
  readonly caseType: CaseType | null
  readonly reason: V1ClaimTypeEvidenceDecisionReason
  readonly sidecarClaimType: V1ClaimType
  readonly evidenceKinds: readonly V1ClaimTypeFilenameEvidenceKind[]
}

export const V1_IDENTITY_VERSION = 'v1-source-identity/1.0.0' as const

export type V1SourceIdentityMaterialResult =
  | {
      readonly ok: true
      readonly kind: 'case_key_created_at'
      readonly version: typeof V1_IDENTITY_VERSION
      /** Hash girdisidir; log/audit/UI'ya ham olarak yazilmaz. */
      readonly material: string
    }
  | {
      readonly ok: false
      readonly reason: 'case_key_missing' | 'created_at_missing_or_invalid'
    }

function canonicalIdentityPart(value: string): string {
  return value.trim().normalize('NFC')
}

/**
 * Gercek V1 envanterinde `caseKey` tek basina benzersiz degildir (ayni plaka
 * icin tekrar eder). Buna karsilik `caseKey + metadata.createdAt` 150/150
 * kaynakta tekildir ve klasor yolu/tasi-ma durumu icermez. Bu fonksiyon hash
 * URETMEZ; yalniz versiyonlu kanonik materyali olusturur.
 */
export function buildV1SourceIdentityMaterial(input: {
  readonly caseKey: string | null | undefined
  readonly createdAt: string | null | undefined
}): V1SourceIdentityMaterialResult {
  const caseKey = canonicalIdentityPart(input.caseKey ?? '')
  if (caseKey.length === 0) return { ok: false, reason: 'case_key_missing' }
  const createdAt = canonicalIdentityPart(input.createdAt ?? '')
  if (createdAt.length === 0 || !Number.isFinite(Date.parse(createdAt))) {
    return { ok: false, reason: 'created_at_missing_or_invalid' }
  }
  return {
    ok: true,
    kind: 'case_key_created_at',
    version: V1_IDENTITY_VERSION,
    material: JSON.stringify([V1_IDENTITY_VERSION, caseKey, new Date(createdAt).toISOString()]),
  }
}

export type V1StableItemType = 'case' | 'field' | 'note' | 'task' | 'vehicle_profile' | 'closure' | 'follow_up'

/**
 * Note/task metni identity'ye girmez: ayni metinli iki mesru oge, V1 native
 * ID'leri farkliysa birbirine dedupe edilmez. Klasor yolu hicbir zaman girdi
 * degildir.
 */
export function buildV1StableItemIdentityMaterial(
  stableSourceIdentity: string,
  itemType: V1StableItemType,
  nativeItemId: string,
): string | null {
  const source = canonicalIdentityPart(stableSourceIdentity)
  const itemId = canonicalIdentityPart(nativeItemId)
  if (source.length === 0 || itemId.length === 0) return null
  return JSON.stringify([V1_IDENTITY_VERSION, source, itemType, itemId])
}

/** Exact-unique user/service resolution icin ortak, locale-aware anahtar. */
export function normalizeV1ResolutionName(value: string): string {
  return value.trim().normalize('NFC').toLocaleLowerCase('tr-TR').replace(/\s+/gu, ' ')
}

/**
 * V1 `claimType` metnini V2 `CaseType`'a esler. Bos/tanimsiz/"unknown" HER
 * ZAMAN `'unknown'` doner -- asla varsayilan olarak 'traffic' veya 'casco'
 * SECILMEZ (AI tahmini yasak ilkesiyle ayni, bkz. document-requirements.ts
 * recourseStatus='unknown' davranisi).
 */
export function mapV1ClaimType(rawClaimType: unknown): V1ClaimType {
  if (typeof rawClaimType !== 'string') return 'unknown'
  const normalized = rawClaimType.trim().toLowerCase()
  if (normalized === 'trafik') return 'traffic'
  if (normalized === 'kasko') return 'casco'
  return 'unknown'
}

/**
 * Ruhsat kaniti dosya adindan okunur; uzanti, buyuk/kucuk harf, Turkce
 * karakter ve bosluk/tire/alt-cizgi farklari karari degistirmez. Sonuc
 * yalniz ASCII harf/rakamdan olusur ve log/provenance'a ham dosya adi yerine
 * kanonik siniflandirma yapabilmek icin kullanilir.
 */
export function normalizeV1ClaimTypeEvidenceFilename(filename: string): string {
  const basename = filename.trim().replace(/\.[^.]+$/u, '')
  return basename
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/gu, 'i')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]/gu, '')
}

/** Yalniz dosya ADINI siniflandirir; dosya icerigi okunmaz. */
export function classifyV1ClaimTypeEvidenceFilename(filename: string): V1ClaimTypeFilenameEvidenceKind | null {
  const normalized = normalizeV1ClaimTypeEvidenceFilename(filename)
  if (normalized.startsWith('kruhsat')) return 'k_ruhsat'
  if (normalized.startsWith('mruhsat')) return 'm_ruhsat'
  if (normalized.startsWith('sruhsat')) return 's_ruhsat'
  if (normalized.includes('kasko') && normalized.includes('police')) return 'kasko_policy_context'
  if (normalized.startsWith('m') && normalized.includes('trafik') && normalized.includes('police')) return 'm_traffic_policy'
  if (normalized.includes('trafik') && normalized.includes('police')) return 'traffic_policy_context'
  if (normalized.includes('ktt')) return 'ktt_context'
  if (normalized.includes('zabit')) return 'accident_report_context'
  if (normalized.includes('beyan')) return 'statement_context'
  return null
}

/**
 * Dogrulanmis domain kurali:
 * - K Ruhsat => Kasko
 * - M Ruhsat => Trafik
 * - S Ruhsat tek basina karar DEGILDIR
 * - K + M fail-closed insan kararidir.
 * - Acik Kasko policesi Kasko'yu, `M Trafik Policesi` Trafik'i destekler.
 * - Genel Trafik policesi, KTT, Zabit ve Beyan Kasko rucu dosyasinda da
 *   bulunabildigi icin TEK BASINA claim type belirlemez.
 * - Sidecar ile yalniz bir ruhsat etiketi celisiyorsa, sidecar ayni yonde
 *   bagimsiz claim-specific belgeyle desteklenmedikce fail-closed kalir.
 *
 * K/M yoksa bilinen sidecar tipi kullanilir; sidecar da unknown ise cagiran
 * taraf mevcut-case/provenance/numara gibi DIGER deterministik kanitlari
 * inceleyebilir. Bu fonksiyon o kanitlari tahmin etmez.
 */
export function decideV1ClaimTypeFromEvidence(input: {
  readonly sidecarClaimType: V1ClaimType
  readonly evidenceKinds: readonly V1ClaimTypeFilenameEvidenceKind[]
}): V1ClaimTypeEvidenceDecision {
  const kinds = [...new Set(input.evidenceKinds)].sort()
  const hasK = kinds.includes('k_ruhsat')
  const hasM = kinds.includes('m_ruhsat')
  if (hasK && hasM) {
    return {
      state: 'human_required', caseType: null, reason: 'conflicting_k_m_evidence',
      sidecarClaimType: input.sidecarClaimType, evidenceKinds: kinds,
    }
  }
  const hasCascoPolicy = kinds.includes('kasko_claim_policy')
  const hasMTrafficPolicy = kinds.includes('m_traffic_policy')
  if (hasCascoPolicy && hasMTrafficPolicy) {
    return {
      state: 'human_required', caseType: null, reason: 'conflicting_claim_document_evidence',
      sidecarClaimType: input.sidecarClaimType, evidenceKinds: kinds,
    }
  }
  const cascoSupported = hasK || hasCascoPolicy
  const trafficSupported = hasM || hasMTrafficPolicy
  if (input.sidecarClaimType === 'traffic' && hasK && !hasM && hasMTrafficPolicy && !hasCascoPolicy) {
    return {
      state: 'resolved', caseType: 'traffic', reason: 'sidecar_corroborated_over_conflicting_ruhsat',
      sidecarClaimType: input.sidecarClaimType, evidenceKinds: kinds,
    }
  }
  if (input.sidecarClaimType === 'casco' && hasM && !hasK && hasCascoPolicy && !hasMTrafficPolicy) {
    return {
      state: 'resolved', caseType: 'casco', reason: 'sidecar_corroborated_over_conflicting_ruhsat',
      sidecarClaimType: input.sidecarClaimType, evidenceKinds: kinds,
    }
  }
  if (cascoSupported && trafficSupported) {
    return {
      state: 'human_required', caseType: null, reason: 'conflicting_claim_document_evidence',
      sidecarClaimType: input.sidecarClaimType, evidenceKinds: kinds,
    }
  }
  const filenameCaseType: CaseType | null = cascoSupported ? 'casco' : trafficSupported ? 'traffic' : null
  if (filenameCaseType !== null && input.sidecarClaimType !== 'unknown' && input.sidecarClaimType !== filenameCaseType) {
    return {
      state: 'human_required', caseType: null, reason: 'sidecar_filename_evidence_conflict',
      sidecarClaimType: input.sidecarClaimType, evidenceKinds: kinds,
    }
  }
  if (filenameCaseType !== null) {
    return {
      state: 'resolved', caseType: filenameCaseType,
      reason: hasCascoPolicy ? 'kasko_policy' : hasMTrafficPolicy ? 'm_traffic_policy' : hasK ? 'k_ruhsat' : 'm_ruhsat',
      sidecarClaimType: input.sidecarClaimType, evidenceKinds: kinds,
    }
  }
  if (input.sidecarClaimType !== 'unknown') {
    return {
      state: 'resolved', caseType: input.sidecarClaimType, reason: 'sidecar_claim_type',
      sidecarClaimType: input.sidecarClaimType, evidenceKinds: kinds,
    }
  }
  return {
    state: 'human_required', caseType: null, reason: 'no_deterministic_evidence',
    sidecarClaimType: input.sidecarClaimType, evidenceKinds: kinds,
  }
}

export interface V1ClosedStateSignals {
  /** Fiziksel klasor "KAPALI ..." adli bir ust-klasorun altinda mi (en guvenilir sinyal, dosya sisteminin kendisi). */
  readonly physicallyUnderKapali: boolean
  /** `caseIdentity.isClosedFolder` (V1'de bazen klasor tasindiginda guncellenmiyor, bkz. gercek ornek). */
  readonly isClosedFolderFlag: boolean | null
  /** `status.kapaliMi` (V1 uygulamasinin kendi kapanis eylemini yansitir). */
  readonly kapaliMi: boolean | null
}

export interface V1ClosedStateResult {
  readonly closed: boolean
  /** Uc sinyal ayni sonuca varmiyorsa true -- cagiran taraf bunu kullaniciya gorunur kilmalidir, sessizce cozulmez. */
  readonly conflicting: boolean
  readonly signals: V1ClosedStateSignals
}

/**
 * Uc "kapali mi" sinyalini birlestirir. Fiziksel klasor konumu EN GUVENILIR
 * kabul edilir (dosya sisteminin kendisi, uygulama-durumu degil); `kapaliMi`
 * ikincil (uygulamanin kendi kapanis eylemi); `isClosedFolderFlag` en dusuk
 * oncelikli (gercek ornekte klasor tasindiginda guncellenmedigi gozlendi).
 * Sinyaller AYRISIRSA `conflicting:true` doner -- kapali/acik TAHMIN edilip
 * sessizce secilmez, cagiran taraf `control_required` olarak isaretlemelidir.
 */
export function deriveV1ClosedState(signals: V1ClosedStateSignals): V1ClosedStateResult {
  const votes = [signals.physicallyUnderKapali, signals.kapaliMi, signals.isClosedFolderFlag]
    .filter((value): value is boolean => value !== null)
  const closedVotes = votes.filter((value) => value).length
  const openVotes = votes.length - closedVotes
  const conflicting = closedVotes > 0 && openVotes > 0
  // Fiziksel konum > kapaliMi > isClosedFolderFlag onceligiyle karar verilir;
  // celiski varsa yine de EN GUVENILIR sinyale gore karar uretilir (import
  // durmaz) ama `conflicting:true` insanin gozden gecirmesi icin isaretlenir.
  const closed = signals.physicallyUnderKapali
    ?? signals.kapaliMi
    ?? signals.isClosedFolderFlag
    ?? false
  return { closed, conflicting, signals }
}

export type V1FieldBackfillDecision =
  | { readonly kind: 'no_source_value' }
  | { readonly kind: 'already_matches' }
  | { readonly kind: 'safe_backfill'; readonly value: string }
  | { readonly kind: 'conflict'; readonly currentValue: string; readonly sourceValue: string }

/**
 * Bir V1 alaniyla V2'de HALIHAZIRDA olan (veya bos olan) bir alani
 * karsilastirir. V2 alani BOS/null ise ve V1'de gercek bir deger varsa
 * `safe_backfill` -- kullanicinin V2'de SONRADAN girdigi bir deger asla
 * KOR EZILMEZ: V2 alani doluysa ve V1 degerinden FARKLIYSA `conflict`
 * doner, otomatik uygulanmaz.
 */
export function decideV1FieldBackfill(
  currentV2Value: string | null | undefined,
  sourceV1Value: string | null | undefined,
): V1FieldBackfillDecision {
  const source = sourceV1Value === null || sourceV1Value === undefined ? '' : sourceV1Value.trim()
  const current = currentV2Value === null || currentV2Value === undefined ? '' : currentV2Value.trim()
  if (source.length === 0) return { kind: 'no_source_value' }
  if (current.length === 0) return { kind: 'safe_backfill', value: source }
  if (current === source) return { kind: 'already_matches' }
  return { kind: 'conflict', currentValue: current, sourceValue: source }
}

/** V1 klasor-adindan turetilen arama anahtari -- V2 `plate_normalized` ile birebir karsilastirilabilir. */
export function v1FolderPlateSearchKey(folderPlate: PlateNumber): string {
  return plateSearchKey(folderPlate)
}

export { CASE_TYPES }
