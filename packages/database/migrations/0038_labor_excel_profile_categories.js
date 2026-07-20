/*
 * Paket 64 — Excel profil eşlemesini DAĞITIM KATEGORİSİ eksenine taşır
 * (HB-2026-072).
 *
 * Gerçek şablon keşfi, 0035'teki eşlemenin YANLIŞ EKSENDE olduğunu gösterdi:
 * Excel sütunları işçilik BRANŞIDIR (kaporta, mekanik, elektrik...), kanonik
 * operasyon türü ise işlemin ne olduğudur (onarım, değişim, sökme-takma).
 * `remove_install` hem kaporta hem mekanik altında olabilir; `replace` bir
 * işçilik sütunu değildir.
 *
 * Eski satırlar SESSİZCE YENİDEN YORUMLANMAZ ve dönüştürülmez:
 * - `labor-excel-profile/1.0.0` sürümleri operasyon türü anahtarlarıyla
 *   OLDUĞU GİBİ kalır ve okunabilir.
 * - `labor-excel-profile/2.0.0` sürümleri kategori anahtarları taşır.
 * - Fiziksel yazım yalnız 2.0.0 ile yapılır; bu kural uygulama katmanında
 *   `isProfileWritable` ile tek noktadan zorlanır.
 *
 * CHECK kısıtı bu yüzden sürüme göre DALLANIR.
 */
const OPERATION_TYPES = [
  'repair', 'replace', 'remove_install', 'paint',
  'consumable', 'calibration', 'related_operation', 'other',
]
const CATEGORIES = [
  'bodywork', 'mechanical', 'electrical', 'upholstery_lock',
  'glass', 'calibration', 'repair', 'paint',
]

const asArray = (values) => `ARRAY[${values.map((value) => `'${value}'`).join(',')}]::text[]`
const complete = (values) => `mapping ?& ${asArray(values)}`
const noExtras = (values) => `(mapping - ${asArray(values)}) = '{}'::jsonb`
const valuesValid = (values) => values
  .map((value) => `(jsonb_typeof(mapping->'${value}') IN ('string','null'))`)
  .join(' AND ')

export function up(pgm) {
  pgm.sql(`
    -- 0035'teki tek-sürümlü kısıt kaldırılır; yerine sürüme göre dallanan
    -- kısıt gelir. Mevcut satırlar 1.0.0 dalını sağladığı için dönüşüm YOK.
    ALTER TABLE labor_excel_profile_versions
      DROP CONSTRAINT labor_excel_profile_versions_valid;

    ALTER TABLE labor_excel_profile_versions
      ADD CONSTRAINT labor_excel_profile_versions_valid CHECK (
        schema_version IN ('labor-excel-profile/1.0.0','labor-excel-profile/2.0.0')
        AND profile_version>=1
        AND char_length(name) BETWEEN 1 AND 80
        AND name ~ '[^[:space:]]'
        AND name !~ '[[:cntrl:]]'
        AND jsonb_typeof(columns)='array'
        AND jsonb_array_length(columns) BETWEEN 1 AND 24
        AND jsonb_typeof(mapping)='object'
        AND (
          (
            schema_version='labor-excel-profile/1.0.0'
            AND ${complete(OPERATION_TYPES)}
            AND ${noExtras(OPERATION_TYPES)}
            AND ${valuesValid(OPERATION_TYPES)}
          )
          OR
          (
            schema_version='labor-excel-profile/2.0.0'
            AND ${complete(CATEGORIES)}
            AND ${noExtras(CATEGORIES)}
            AND ${valuesValid(CATEGORIES)}
          )
        )
        AND (
          (profile_version=1 AND previous_version_id IS NULL AND revision_reason IS NULL)
          OR
          (profile_version>1 AND previous_version_id IS NOT NULL
            AND char_length(revision_reason) BETWEEN 1 AND 500
            AND revision_reason ~ '[^[:space:]]' AND revision_reason !~ '[[:cntrl:]]')
        )
      );
  `)
}

export function down(pgm) {
  pgm.sql(`
    -- Geri alırken 2.0.0 satırları eski kısıtı sağlayamaz; bu yüzden önce
    -- onların varlığı kontrol edilir ve varsa geri alma REDDEDİLİR. Sessiz
    -- veri kaybı yerine açık hata verilir.
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM labor_excel_profile_versions
         WHERE schema_version='labor-excel-profile/2.0.0'
      ) THEN
        RAISE EXCEPTION 'cannot roll back: category-axis profile versions exist'
          USING ERRCODE='restrict_violation';
      END IF;
    END $$;

    ALTER TABLE labor_excel_profile_versions
      DROP CONSTRAINT labor_excel_profile_versions_valid;

    ALTER TABLE labor_excel_profile_versions
      ADD CONSTRAINT labor_excel_profile_versions_valid CHECK (
        schema_version='labor-excel-profile/1.0.0'
        AND profile_version>=1
        AND char_length(name) BETWEEN 1 AND 80
        AND name ~ '[^[:space:]]'
        AND name !~ '[[:cntrl:]]'
        AND jsonb_typeof(columns)='array'
        AND jsonb_array_length(columns) BETWEEN 1 AND 24
        AND jsonb_typeof(mapping)='object'
        AND ${complete(OPERATION_TYPES)}
        AND ${noExtras(OPERATION_TYPES)}
        AND ${valuesValid(OPERATION_TYPES)}
        AND (
          (profile_version=1 AND previous_version_id IS NULL AND revision_reason IS NULL)
          OR
          (profile_version>1 AND previous_version_id IS NOT NULL
            AND char_length(revision_reason) BETWEEN 1 AND 500
            AND revision_reason ~ '[^[:space:]]' AND revision_reason !~ '[[:cntrl:]]')
        )
      );
  `)
}
