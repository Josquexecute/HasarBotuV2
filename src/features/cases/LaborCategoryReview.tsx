import { Layers, TriangleAlert } from 'lucide-react'
import { LABOR_ALLOCATION_CATEGORIES } from '@hasarbotu/domain'
import {
  CATEGORY_LABELS,
  effectiveCategoryAmounts,
  formatMinor,
  parseCategoryMinor,
  sharePercent,
  type CategoryAmounts,
  type CategoryDraftEntry,
  type CategoryLine,
} from './laborCategoryRules.js'

/**
 * Paket 64 — işçilik DAĞITIM KATEGORİSİ (branş) inceleme ve düzeltme.
 *
 * Bu panel operasyon türü ekseninden ayrıdır: burada "iş neydi" değil "işi
 * hangi branş yaptı" sorusu cevaplanır. AI dağılımı üretir, kullanıcı yalnız
 * inceler ve gerekirse düzeltir.
 *
 * Panel HİÇBİR koşulda kendi kategori değeri türetmez: kalan farkı bir
 * kategoriye aktarmaz, eksik provenance'ı sıfır dağılım gibi çizmez ve
 * sunucunun çelişki kararının yerine kendi hesabını koymaz.
 */
export interface LaborCategoryReviewProps {
  readonly line: CategoryLine
  /** Uygulanacak işçilik tutarı; kategori toplamı buna eşit olmak zorundadır. */
  readonly appliedLaborAmountMinor: number
  readonly draft: CategoryDraftEntry | undefined
  readonly onChange: (category: string, value: string) => void
}

export function LaborCategoryReview({
  line,
  appliedLaborAmountMinor,
  draft,
  onChange,
}: LaborCategoryReviewProps) {
  const allocation = line.categoryAllocation

  /*
   * Kategori provenance'ı yoksa panel BOŞ dağılım çizmez ve otomatik değer
   * üretmez. Eski çalıştırmalarda ya da kullanıcı işçilik tutarını değiştirip
   * modelin önerisini geçersiz kıldığında girişi insan yapar.
   */
  if (allocation === null) {
    return (
      <div className="allocation-category allocation-category--manual">
        <strong>
          <TriangleAlert size={12} aria-hidden="true" />
          {' '}Manuel kategori girişi gerekli
        </strong>
        <span>
          Bu satır için doğrulanmış kategori dağılımı yok. Sistem eski öneriyi
          ölçekleyerek dağılım üretmez; branş dağılımını uzman girer.
        </span>
      </div>
    )
  }

  const effective = effectiveCategoryAmounts(line, draft)
  const effectiveTotal = effective === null
    ? null
    : effective.reduce((sum, item) => sum + item.amountMinor, 0)
  const totalMatches = effectiveTotal === appliedLaborAmountMinor
  const modified = effective !== null && LABOR_ALLOCATION_CATEGORIES.some((category) => {
    const proposed = allocation.amounts.find((item) => item.category === category)?.amountMinor ?? 0
    const applied = effective.find((item) => item.category === category)?.amountMinor ?? 0
    return proposed !== applied
  })

  return (
    <div className="allocation-category">
      <strong className="allocation-category__title">
        <Layers size={12} aria-hidden="true" />
        {' '}İşçilik dağıtım kategorileri (branş)
      </strong>

      <div className="allocation-category__grid">
        {LABOR_ALLOCATION_CATEGORIES.map((category) => {
          const proposed = allocation.amounts
            .find((item) => item.category === category)?.amountMinor ?? 0
          const value = draft?.[category] ?? (proposed / 100).toFixed(2)
          const invalid = parseCategoryMinor(value) === null
          return (
            <label
              key={category}
              className={invalid
                ? 'allocation-category__field allocation-category__field--invalid'
                : 'allocation-category__field'}
            >
              <span>{CATEGORY_LABELS[category]}</span>
              <input
                aria-label={`${CATEGORY_LABELS[category]} kategorisi satır ${line.lineOrdinal}`}
                inputMode="decimal"
                value={value}
                onChange={(event) => onChange(category, event.target.value)}
              />
              {/* Önerilen ve uygulanan YAN YANA durur; öneri kaybolmaz. */}
              <small>AI: {formatMinor(proposed)}</small>
            </label>
          )
        })}
      </div>

      <div className="allocation-category__totals">
        <span>İşçilik toplamı: {formatMinor(appliedLaborAmountMinor)}</span>
        <span className={totalMatches ? undefined : 'allocation-category__mismatch'}>
          Kategori toplamı: {effectiveTotal === null ? 'geçersiz giriş' : formatMinor(effectiveTotal)}
        </span>
        {!totalMatches && (
          <strong className="allocation-category__mismatch">
            Toplam eşleşmiyor; uygulama engellendi. Fark otomatik dağıtılmaz.
          </strong>
        )}
        {modified && totalMatches && (
          <strong className="allocation-category__modified">
            Kategori dağılımı kullanıcı tarafından değiştirildi
          </strong>
        )}
      </div>

      {/*
       * Gerekçe ve kanıt satırın ORTAK alanlarıdır: model kategori başına ayrı
       * gerekçe üretmez, çünkü sekiz ayrı gerekçe istemek çıktıyı şişirir ve
       * doğruluk kazandırmaz.
       */}
      <p className="allocation-category__reasoning">{line.reasoning}</p>
      <span className="allocation-category__meta">
        Kategori güveni %{(allocation.confidence * 100).toFixed(0)}
        {line.controlRequired ? ' · Kontrol gerekli' : ''}
        {line.evidenceRefs.length > 0 ? ` · Kanıt: ${line.evidenceRefs.join(', ')}` : ''}
      </span>
      {allocation.conflictCodes.length > 0 && (
        <span className="allocation-category__codes">
          Sunucu çelişki kodları: {allocation.conflictCodes.join(', ')}
        </span>
      )}
      {line.missingEvidenceCodes.length > 0 && (
        <span className="allocation-category__codes">
          Eksik kanıt: {line.missingEvidenceCodes.join(', ')}
        </span>
      )}

      {/*
       * Kıyas görünümü PAY üzerinden yapılır: aynı işin daha pahalıya
       * yapılması çelişki değildir, işin branşlar arasında kayması çelişkidir.
       * Referans yoksa "yok" yazılır; sıfır dağılım çizilmez.
       */}
      <div className="allocation-category__comparison">
        <ComparisonRow label="AI önerisi" amounts={allocation.amounts} />
        <ComparisonRow label="Baseline" amounts={allocation.baselineAmounts} />
        <ComparisonRow label="Onaylı geçmiş" amounts={allocation.historyAmounts} />
      </div>
    </div>
  )
}

function ComparisonRow({
  label,
  amounts,
}: {
  readonly label: string
  readonly amounts: CategoryAmounts | null
}) {
  if (amounts === null) {
    return (
      <span className="allocation-category__comparison-row">
        <em>{label}:</em> yok
      </span>
    )
  }
  const parts = LABOR_ALLOCATION_CATEGORIES
    .map((category) => ({ category, share: sharePercent(amounts, category) }))
    .filter((item) => item.share !== null && item.share > 0)
    .map((item) => `${CATEGORY_LABELS[item.category]} %${(item.share as number).toFixed(0)}`)
  return (
    <span className="allocation-category__comparison-row">
      <em>{label}:</em> {parts.length === 0 ? 'pay hesaplanamıyor' : parts.join(' · ')}
    </span>
  )
}
