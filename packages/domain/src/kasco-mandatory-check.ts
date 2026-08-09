import type { CaseType } from './case-type.js'

/**
 * Zorunlu Kasko Kontrolu (paketleme oncesi yeni zorunlu ozellik). Her Kasko
 * dosyasinda sabit 7 kontrol; Trafik dosyasinda uygulanmaz. Saf ve
 * deterministiktir: database/HTTP/sistem saati/AI kullanmaz -- diger tum
 * requirement motorlariyla (evaluateDocumentRequirements,
 * evaluateClosureRequirements) ayni pure-evaluator desenidir; "needs_review"
 * durumu STORE EDILMEZ, kaynak belge surumu her degerlendirmede taze
 * karsilastirilir.
 */

export const KASCO_MANDATORY_CHECK_CODES = [
  'driver_registration_owner_match',
  'driver_license_restriction_codes',
  'policyholder_registration_owner_match',
  'occupation_information',
  'equivalent_parts_clause',
  'service_deductible_clause',
  'market_value_general_deductible',
] as const
export type KascoMandatoryCheckCode = (typeof KASCO_MANDATORY_CHECK_CODES)[number]

/** same/different/unknown: kimlik karsilastirmasi. present/absent/unclear: belge/kloz varligi. */
export const KASCO_CHECK_RESULT_VALUES = ['same', 'different', 'present', 'absent', 'unclear', 'unknown'] as const
export type KascoCheckResult = (typeof KASCO_CHECK_RESULT_VALUES)[number]

const COMPARISON_RESULTS = ['same', 'different', 'unknown'] as const
const PRESENCE_RESULTS = ['present', 'absent', 'unclear'] as const
/** Kesin (evidence zorunlu) sonuclar: "belirsiz" degil, gercek bir bulgu. */
export const KASCO_DEFINITIVE_RESULTS = ['same', 'different', 'present', 'absent'] as const
/** control_required'a duser: kanit yetersiz veya karsilastirma yapilamadi. */
export const KASCO_NEEDS_INPUT_RESULTS = ['unclear', 'unknown'] as const

export type KascoCheckKind = 'comparison' | 'presence'

export interface KascoMandatoryCheckDefinition {
  readonly code: KascoMandatoryCheckCode
  readonly kind: KascoCheckKind
  readonly validResults: readonly KascoCheckResult[]
  readonly labelTr: string
  readonly descriptionTr: string
}

/**
 * 7 kontrolun sabit tanimi. Sira kullanicinin istedigi sirayla korunur.
 * `labelTr`/`descriptionTr` tek kaynaktir; UI ve e-posta/uyari metinleri
 * rakip adlandirma uretmemek icin buradan okur (DOCUMENT_REQUIREMENT_LABELS
 * ile ayni ilke).
 */
export const KASCO_MANDATORY_CHECK_DEFINITIONS: Readonly<Record<KascoMandatoryCheckCode, KascoMandatoryCheckDefinition>> = {
  driver_registration_owner_match: {
    code: 'driver_registration_owner_match', kind: 'comparison', validResults: COMPARISON_RESULTS,
    labelTr: 'Sürücü ↔ ruhsat sahibi',
    descriptionTr: 'Hasar anındaki sürücü ile araç ruhsatındaki sahip aynı kişi mi?',
  },
  driver_license_restriction_codes: {
    code: 'driver_license_restriction_codes', kind: 'presence', validResults: PRESENCE_RESULTS,
    labelTr: 'Ehliyet 12. alan kod/kısıtlamaları',
    descriptionTr: 'Sürücü ehliyetinin 12. alanında kayıtlı kod/kısıtlama var mı; varsa tümü kayıt altına alınmalıdır.',
  },
  policyholder_registration_owner_match: {
    code: 'policyholder_registration_owner_match', kind: 'comparison', validResults: COMPARISON_RESULTS,
    labelTr: 'Poliçe sahibi/sigortalı ↔ ruhsat sahibi',
    descriptionTr: 'Poliçedeki sigortalı/poliçe sahibi ile araç ruhsatındaki sahip aynı kişi mi?',
  },
  occupation_information: {
    code: 'occupation_information', kind: 'presence', validResults: PRESENCE_RESULTS,
    labelTr: 'Meslek bilgisi',
    descriptionTr: 'Sürücü/sigortalının meslek bilgisi belgelerde kayıtlı ve doğrulanmış mı?',
  },
  equivalent_parts_clause: {
    code: 'equivalent_parts_clause', kind: 'presence', validResults: PRESENCE_RESULTS,
    labelTr: 'Eşdeğer parça klozu',
    descriptionTr: 'Poliçede eşdeğer/muadil parça kullanımına ilişkin bir kloz var mı?',
  },
  service_deductible_clause: {
    code: 'service_deductible_clause', kind: 'presence', validResults: PRESENCE_RESULTS,
    labelTr: 'Servis muafiyeti',
    descriptionTr: 'Poliçede anlaşmasız/yetkisiz servis kullanımına bağlı bir muafiyet/tenzil kloz var mı?',
  },
  market_value_general_deductible: {
    code: 'market_value_general_deductible', kind: 'presence', validResults: PRESENCE_RESULTS,
    labelTr: 'Rayiç bedeli üzerinden genel muafiyet',
    descriptionTr: 'Poliçede rayiç/piyasa bedeli üzerinden hesaplanan genel bir muafiyet var mı?',
  },
}

export function isKascoMandatoryCheckCode(value: string): value is KascoMandatoryCheckCode {
  return (KASCO_MANDATORY_CHECK_CODES as readonly string[]).includes(value)
}

export function isValidResultForCheck(code: KascoMandatoryCheckCode, result: KascoCheckResult): boolean {
  return KASCO_MANDATORY_CHECK_DEFINITIONS[code].validResults.includes(result)
}

/** Gate degerlendirmesi yalniz Kasko dosyasinda calisir. */
export function isKascoMandatoryCheckApplicable(caseType: CaseType): boolean {
  return caseType === 'casco'
}

/** Tek bir kontrolun DB'den okunan ham gercekleri. */
export interface KascoMandatoryCheckFact {
  readonly checkCode: KascoMandatoryCheckCode
  readonly confirmedResult: KascoCheckResult | null
  readonly confirmedEvidenceDocumentId: string | null
  readonly confirmedEvidenceDocumentVersionId: string | null
  readonly confirmedAt: string | null
  readonly confirmedByUserId: string | null
  readonly aiSuggestedResult: KascoCheckResult | null
  readonly aiSuggestedAt: string | null
  /** Kanit belgesinin BU KONTROL onaylandigi andaki surumu, o belgenin
   * dosyadaki GUNCEL surumuyle (documents.current_version_id) karsilastirilir. */
  readonly evidenceDocumentCurrentVersionId: string | null
}

export const KASCO_CHECK_DERIVED_STATUSES = ['not_applicable', 'missing', 'control_required', 'needs_review', 'resolved'] as const
export type KascoCheckDerivedStatus = (typeof KASCO_CHECK_DERIVED_STATUSES)[number]

export interface KascoMandatoryCheckEvaluation {
  readonly checkCode: KascoMandatoryCheckCode
  readonly status: KascoCheckDerivedStatus
  readonly reason: string
  readonly confirmedResult: KascoCheckResult | null
  readonly requiresHumanReview: boolean
}

function evaluateSingleCheck(fact: KascoMandatoryCheckFact): KascoMandatoryCheckEvaluation {
  const { checkCode, confirmedResult } = fact
  if (confirmedResult === null) {
    return {
      checkCode, status: 'missing', reason: 'Kontrol henüz kaydedilmedi.',
      confirmedResult: null, requiresHumanReview: true,
    }
  }
  if ((KASCO_NEEDS_INPUT_RESULTS as readonly string[]).includes(confirmedResult)) {
    return {
      checkCode, status: 'control_required',
      reason: confirmedResult === 'unclear' ? 'Belge veya bulgu belirsiz; ek inceleme gerekir.' : 'Karşılaştırma yapılamadı; kaynak yetersiz veya çelişkili.',
      confirmedResult, requiresHumanReview: true,
    }
  }
  // Kesin sonuc (same/different/present/absent) -- kaynak belgenin GUNCEL
  // surumuyle onaylandigi surum artik eslesmiyorsa (belge yeni bir surume
  // tasindi) bulgular gecerliligini yitirir, tekrar incelenmelidir.
  if (
    fact.confirmedEvidenceDocumentVersionId !== null
    && fact.evidenceDocumentCurrentVersionId !== null
    && fact.confirmedEvidenceDocumentVersionId !== fact.evidenceDocumentCurrentVersionId
  ) {
    return {
      checkCode, status: 'needs_review',
      reason: 'Kanıt belgesinin daha yeni bir sürümü yüklendi; bulgu yeniden doğrulanmalıdır.',
      confirmedResult, requiresHumanReview: true,
    }
  }
  return {
    checkCode, status: 'resolved',
    reason: confirmedResult === 'same' || confirmedResult === 'present'
      ? 'Kontrol kanıtlı olarak doğrulandı.'
      : 'Kontrol kanıtlı olarak tamamlandı; bulgu ayrıca operasyonel değerlendirme gerektirebilir.',
    confirmedResult, requiresHumanReview: false,
  }
}

export interface KascoMandatoryCheckGateEvaluation {
  readonly version: '2026.08.09.1'
  readonly applicable: boolean
  readonly checks: readonly KascoMandatoryCheckEvaluation[]
  readonly missingCount: number
  readonly controlRequiredCount: number
  readonly needsReviewCount: number
  readonly resolvedCount: number
  /** Kapanis requirement item'i icin: eksik/control_required/needs_review varsa true. */
  readonly incomplete: boolean
}

/**
 * Tam gate degerlendirmesi. Trafik dosyasinda `applicable=false` ve tum
 * kontroller `not_applicable` doner (kapanisi hicbir zaman engellemez).
 * Kasko'da facts 7 kontrolun HEPSINI icermelidir (eksik kontrol kodu
 * `missing` olarak GEREKMEZ -- caller her 7 kod icin bir fact saglamalidir;
 * saglamazsa bu fonksiyon eksik kodu tamamlamaz, caller sorumludur).
 */
export function evaluateKascoMandatoryCheckGate(
  caseType: CaseType,
  facts: readonly KascoMandatoryCheckFact[],
): KascoMandatoryCheckGateEvaluation {
  const applicable = isKascoMandatoryCheckApplicable(caseType)
  if (!applicable) {
    const checks = KASCO_MANDATORY_CHECK_CODES.map((code): KascoMandatoryCheckEvaluation => ({
      checkCode: code, status: 'not_applicable', reason: 'Trafik dosyasında Zorunlu Kasko Kontrolü uygulanmaz.',
      confirmedResult: null, requiresHumanReview: false,
    }))
    return { version: '2026.08.09.1', applicable: false, checks, missingCount: 0, controlRequiredCount: 0, needsReviewCount: 0, resolvedCount: 0, incomplete: false }
  }
  const byCode = new Map(facts.map((fact) => [fact.checkCode, fact]))
  const checks = KASCO_MANDATORY_CHECK_CODES.map((code): KascoMandatoryCheckEvaluation => {
    const fact = byCode.get(code)
    if (fact === undefined) {
      return { checkCode: code, status: 'missing', reason: 'Kontrol henüz kaydedilmedi.', confirmedResult: null, requiresHumanReview: true }
    }
    return evaluateSingleCheck(fact)
  })
  const missingCount = checks.filter((item) => item.status === 'missing').length
  const controlRequiredCount = checks.filter((item) => item.status === 'control_required').length
  const needsReviewCount = checks.filter((item) => item.status === 'needs_review').length
  const resolvedCount = checks.filter((item) => item.status === 'resolved').length
  return {
    version: '2026.08.09.1', applicable: true, checks, missingCount, controlRequiredCount, needsReviewCount, resolvedCount,
    incomplete: missingCount + controlRequiredCount + needsReviewCount > 0,
  }
}
