/*
 * Paket 63 — çoklu Excel profil seçimi (HB-2026-070).
 *
 * Üç ekleme:
 *
 * 1. Profil DURUMU. Pasifleştirilen profil YENİ projeksiyonda seçilemez ama
 *    eski kayıtlarda okunabilir kalmalıdır; bu yüzden satır silinmez, aggregate
 *    üzerinde durum tutulur. Durum sürümlü değildir: pasifleştirme profilin
 *    içeriğini değiştirmez, yalnız kullanılabilirliğini değiştirir.
 *
 * 2. HEDEF SAYFA. Yazımın hangi Excel sayfasına yapılacağı sürümlü profil
 *    bilgisidir.
 *
 * 3. KİMLİK DOĞRULAMA KURALLARI. Yazmadan önce dosyanın gerçekten bu vakaya
 *    ait olduğunu doğrulamak için hangi kimliklerin aranacağı. Bilerek yalnız
 *    "ne doğrulanacak" tutulur, "nerede bulunacak" DEĞİL: gerçek şablon
 *    okunmadan hücre koordinatı uydurmak yanlış güven yaratır. Geometri şablon
 *    ilk kez okunduğunda modele girer.
 *
 * Bu paket de hiçbir dosyaya yazmaz.
 */
const IDENTITY_CHECK_KEYS = `ARRAY['plate','officeNumber']::text[]`

export function up(pgm) {
  pgm.sql(`
    ALTER TABLE labor_excel_profiles
      ADD COLUMN status text NOT NULL DEFAULT 'active',
      ADD COLUMN deactivated_at timestamptz,
      ADD COLUMN deactivated_by_user_id uuid,
      ADD COLUMN status_reason text;

    ALTER TABLE labor_excel_profiles
      ADD CONSTRAINT labor_excel_profiles_deactivated_by_fk
        FOREIGN KEY (organization_id,deactivated_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      -- Durum ile pasifleştirme kaydı BİRLİKTE tutarlı olmalıdır: "pasif ama
      -- kim/ne zaman bilinmiyor" ya da "aktif ama pasifleştirilmiş" olamaz.
      ADD CONSTRAINT labor_excel_profiles_status_valid CHECK (
        (status='active' AND deactivated_at IS NULL
          AND deactivated_by_user_id IS NULL AND status_reason IS NULL)
        OR
        (status='inactive' AND deactivated_at IS NOT NULL
          AND deactivated_by_user_id IS NOT NULL
          AND char_length(status_reason) BETWEEN 1 AND 500
          AND status_reason ~ '[^[:space:]]' AND status_reason !~ '[[:cntrl:]]')
      );

    CREATE INDEX labor_excel_profiles_active_idx
      ON labor_excel_profiles (organization_id,status);

    ALTER TABLE labor_excel_profile_versions
      ADD COLUMN target_sheet text,
      ADD COLUMN identity_checks jsonb NOT NULL
        DEFAULT '{"plate":false,"officeNumber":false}'::jsonb;

    ALTER TABLE labor_excel_profile_versions
      ADD CONSTRAINT labor_excel_profile_versions_target_sheet_valid CHECK (
        target_sheet IS NULL
        OR (
          char_length(target_sheet) BETWEEN 1 AND 31
          AND target_sheet ~ '[^[:space:]]'
          AND target_sheet !~ '[[:cntrl:]]'
          -- Excel sayfa adı bu karakterleri taşıyamaz.
          AND target_sheet !~ '[:\\\\/?*\\[\\]]'
        )
      ),
      -- Kural kümesi TAM olmalı ve fazla anahtar taşımamalıdır; değerler
      -- boolean'dır. (CHECK içinde subquery kullanılamaz.)
      ADD CONSTRAINT labor_excel_profile_versions_identity_checks_valid CHECK (
        jsonb_typeof(identity_checks)='object'
        AND identity_checks ?& ${IDENTITY_CHECK_KEYS}
        AND (identity_checks - ${IDENTITY_CHECK_KEYS}) = '{}'::jsonb
        AND jsonb_typeof(identity_checks->'plate')='boolean'
        AND jsonb_typeof(identity_checks->'officeNumber')='boolean'
      );

    -- Aggregate guard'ı durum alanlarını serbest bırakır ama kimliği hâlâ
    -- korur. Tetikleyici yeniden yazılır çünkü gövdesi değişmiyor: kimlik
    -- kontrolü zaten yalnız organization/creator/created_at üzerindedir.
  `)
}

export function down(pgm) {
  pgm.sql(`
    ALTER TABLE labor_excel_profile_versions
      DROP CONSTRAINT labor_excel_profile_versions_identity_checks_valid,
      DROP CONSTRAINT labor_excel_profile_versions_target_sheet_valid,
      DROP COLUMN identity_checks,
      DROP COLUMN target_sheet;

    DROP INDEX labor_excel_profiles_active_idx;
    ALTER TABLE labor_excel_profiles
      DROP CONSTRAINT labor_excel_profiles_status_valid,
      DROP CONSTRAINT labor_excel_profiles_deactivated_by_fk,
      DROP COLUMN status_reason,
      DROP COLUMN deactivated_by_user_id,
      DROP COLUMN deactivated_at,
      DROP COLUMN status;
  `)
}
