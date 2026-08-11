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
