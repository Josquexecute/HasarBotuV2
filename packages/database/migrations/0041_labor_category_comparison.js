/*
 * Paket 64 — kategori karşılaştırma anlık görüntüsü (HB-2026-079).
 *
 * Sunucu, öneriyi baseline ve approved history kategori dağılımlarıyla
 * karşılaştırıp çelişki kodunu ZORLUYOR. Ne var ki kod tek başına "iki kaynak
 * ayrışıyor" der; kullanıcının kararı için NEYİN ayrıştığı gerekir.
 *
 * Karşılaştırılan vektörler öneriyle birlikte immutable saklanır. Sonradan
 * yeniden hesaplamak yanlış olurdu: geçmiş havuzu ve baseline zamanla değişir,
 * ve o zaman ekranda gösterilen kıyas ile kodun dayandığı kıyas farklı olurdu.
 *
 * Her iki alan da NULL kabul eder ve NULL "referans yoktu" demektir; sıfır
 * dağılım DEĞİLDİR. Uygulama katmanı bu ikisini birbirine çevirmez.
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

export function up(pgm) {
  pgm.sql(`
    ALTER TABLE labor_allocation_line_suggestions
      ADD COLUMN baseline_category_amounts jsonb,
      ADD COLUMN history_category_amounts jsonb;

    ALTER TABLE labor_allocation_line_suggestions
      ADD CONSTRAINT labor_allocation_line_suggestions_comparison_valid CHECK (
        (baseline_category_amounts IS NULL
          OR ${categoryShapeValid('baseline_category_amounts')})
        AND (history_category_amounts IS NULL
          OR ${categoryShapeValid('history_category_amounts')})
        -- Kıyas ancak ÖNERİ varsa anlamlıdır; öneri yokken kıyas saklanamaz.
        AND (
          proposed_category_amounts IS NOT NULL
          OR (baseline_category_amounts IS NULL AND history_category_amounts IS NULL)
        )
      );
  `)
}

export function down(pgm) {
  pgm.sql(`
    ALTER TABLE labor_allocation_line_suggestions
      DROP CONSTRAINT labor_allocation_line_suggestions_comparison_valid,
      DROP COLUMN history_category_amounts,
      DROP COLUMN baseline_category_amounts;
  `)
}
