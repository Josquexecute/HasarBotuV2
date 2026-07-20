/*
 * Paket 64 ara dilim — kategori dağılımı kalıcılaştırma (HB-2026-078).
 *
 * AI artık satır bazında İŞÇİLİK DAĞITIM KATEGORİSİ üretiyor. Bu migration
 * hem ÖNERİLEN hem UYGULANAN kategori dağılımını saklar ve ikisini AYRI
 * tutar: kullanıcı bir tutarı değiştirdiyse modelin ilk değeri kaybolmaz.
 *
 * Geriye dönük uyumluluk: alanlar NULL kabul eder. Eski kayıtlarda gerçek
 * kategori provenance'ı YOKTUR ve bu kayıtlar sessizce "kategori dağılımı
 * varmış" gibi yeniden yorumlanmaz; uygulama katmanı NULL provenance'ı
 * fiziksel Excel yazımına uygun SAYMAZ.
 *
 * Immutability: her iki tablo da 0031/0034'teki guard trigger'ları taşır ve
 * append-only kalır; bu migration yalnız sütun ekler.
 */
const CATEGORIES = [
  'bodywork', 'mechanical', 'electrical', 'upholstery_lock',
  'glass', 'calibration', 'repair', 'paint',
]

const asArray = `ARRAY[${CATEGORIES.map((value) => `'${value}'`).join(',')}]::text[]`

/** Sekiz anahtar TAM olmalı, fazlası olmamalı, değerler negatif olmayan tam sayı. */
function categoryShapeValid(column) {
  const numeric = CATEGORIES
    .map((category) => `(jsonb_typeof(${column}->'${category}')='number'`
      + ` AND (${column}->>'${category}') ~ '^[0-9]+$')`)
    .join(' AND ')
  return `(
    jsonb_typeof(${column})='object'
    AND ${column} ?& ${asArray}
    AND (${column} - ${asArray}) = '{}'::jsonb
    AND ${numeric}
  )`
}

/** Sekiz kategori toplamı; SQL tarafında da doğrulanır. */
function categorySum(column) {
  return CATEGORIES.map((category) => `(${column}->>'${category}')::bigint`).join(' + ')
}

export function up(pgm) {
  pgm.sql(`
    -- ── Önerilen kategori dağılımı (AI çıktısı).
    ALTER TABLE labor_allocation_line_suggestions
      ADD COLUMN proposed_category_amounts jsonb,
      ADD COLUMN category_schema_version text,
      ADD COLUMN category_confidence numeric(5,4),
      ADD COLUMN category_conflict_codes text[] NOT NULL DEFAULT '{}';

    ALTER TABLE labor_allocation_line_suggestions
      ADD CONSTRAINT labor_allocation_line_suggestions_category_valid CHECK (
        -- Eski kayıtlarda kategori provenance'ı YOKTUR; hepsi birlikte null olur.
        (
          proposed_category_amounts IS NULL
          AND category_schema_version IS NULL
          AND category_confidence IS NULL
          AND category_conflict_codes = '{}'::text[]
        )
        OR
        (
          proposed_category_amounts IS NOT NULL
          AND category_schema_version='labor-category-allocation/1.0.0'
          AND category_confidence BETWEEN 0 AND 1
          AND ${categoryShapeValid('proposed_category_amounts')}
          -- Toplam YALNIZ işçilik tutarına eşittir; parça bedeli karışmaz.
          AND (${categorySum('proposed_category_amounts')}) = source_labor_amount_minor
        )
      );

    -- ── Uygulanan kategori dağılımı (kullanıcı onayından sonra).
    ALTER TABLE labor_allocation_applied_lines
      ADD COLUMN proposed_category_amounts jsonb,
      ADD COLUMN applied_category_amounts jsonb,
      ADD COLUMN category_modified boolean,
      ADD COLUMN category_schema_version text;

    ALTER TABLE labor_allocation_applied_lines
      ADD CONSTRAINT labor_allocation_applied_lines_category_valid CHECK (
        (
          proposed_category_amounts IS NULL
          AND applied_category_amounts IS NULL
          AND category_modified IS NULL
          AND category_schema_version IS NULL
        )
        OR
        (
          proposed_category_amounts IS NOT NULL
          AND applied_category_amounts IS NOT NULL
          AND category_modified IS NOT NULL
          AND category_schema_version='labor-category-allocation/1.0.0'
          AND ${categoryShapeValid('proposed_category_amounts')}
          AND ${categoryShapeValid('applied_category_amounts')}
          -- Önerilen toplam öneri satırının, uygulanan toplam UYGULANAN
          -- satırın işçilik tutarına eşit olmalıdır. Bu kural veritabanı
          -- seviyesinde durur: uygulama katmanı atlansa bile tutarsız
          -- dağılım yazılamaz.
          AND (${categorySum('proposed_category_amounts')}) = suggested_labor_amount_minor
          AND (${categorySum('applied_category_amounts')}) = applied_labor_amount_minor
          -- category_modified bayrağı GERÇEĞİ söylemek zorundadır.
          AND category_modified = (proposed_category_amounts <> applied_category_amounts)
        )
      );

    -- Approved category history yalnız TAMAMLANMIŞ uygulamalardan okunur;
    -- bu indeks o sorgunun erişim yolunu sabitler.
    CREATE INDEX labor_allocation_applied_lines_category_idx
      ON labor_allocation_applied_lines (organization_id,application_id)
      WHERE applied_category_amounts IS NOT NULL;
  `)
}

export function down(pgm) {
  pgm.sql(`
    DROP INDEX labor_allocation_applied_lines_category_idx;

    ALTER TABLE labor_allocation_applied_lines
      DROP CONSTRAINT labor_allocation_applied_lines_category_valid,
      DROP COLUMN category_schema_version,
      DROP COLUMN category_modified,
      DROP COLUMN applied_category_amounts,
      DROP COLUMN proposed_category_amounts;

    ALTER TABLE labor_allocation_line_suggestions
      DROP CONSTRAINT labor_allocation_line_suggestions_category_valid,
      DROP COLUMN category_conflict_codes,
      DROP COLUMN category_confidence,
      DROP COLUMN category_schema_version,
      DROP COLUMN proposed_category_amounts;
  `)
}
