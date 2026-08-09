/**
 * Zorunlu Kasko Kontrolu gate'i (paketleme oncesi yeni zorunlu ozellik).
 *
 * Her Kasko dosyasinda 7 sabit kontrol: surucu<->ruhsat sahibi, ehliyet 12.
 * alan kod/kisitlamalari, police sahibi/sigortali<->ruhsat sahibi, meslek
 * bilgisi, esdeger parca klozu, servis muafiyeti, rayic bedeli uzerinden
 * genel muafiyet. Evidence-first: kesin sonuc (same/different/present/
 * absent) daima bir document_version kanitina baglanmalidir -- "police
 * tamami okunmadan kloz yok" sonucu CHECK kisitiyla engellenir (yalniz
 * unclear/unknown kanitsiz kalabilir). Kaynak belgenin surumu degisirse
 * (documents.current_version_id artik confirmed_evidence_document_version_id
 * ile eslesmez) needs_review durumu APP KATMANINDA (pure evaluator, bu
 * depodaki diger tum requirement motorlariyla ayni desen -- bkz.
 * evaluateClosureRequirements/evaluateDocumentRequirements) taze
 * hesaplanir; bu tabloda ayrica bir "needs_review" kolonu STORE EDILMEZ.
 *
 * Onay gecmisi append-only ayri tabloda tutulur (audit/history/provenance).
 */
export const shorthands = undefined

const CHECK_CODES = `(
  'driver_registration_owner_match',
  'driver_license_restriction_codes',
  'policyholder_registration_owner_match',
  'occupation_information',
  'equivalent_parts_clause',
  'service_deductible_clause',
  'market_value_general_deductible'
)`
const RESULT_VALUES = "('same','different','present','absent','unclear','unknown')"
const DEFINITIVE_RESULTS = "('same','different','present','absent')"

const EXCERPT_CHECK = (column) => `${column} IS NULL OR (length(btrim(${column})) BETWEEN 1 AND 1000 AND ${column} !~ '[[:cntrl:]]')`

export function up(pgm) {
  pgm.createTable('kasco_mandatory_checks', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    check_code: { type: 'text', notNull: true },
    version: { type: 'integer', notNull: true, default: 1 },

    ai_suggested_result: { type: 'text' },
    ai_confidence_basis_points: { type: 'integer' },
    ai_evidence_document_id: { type: 'uuid' },
    ai_evidence_document_version_id: { type: 'uuid' },
    ai_evidence_page: { type: 'integer' },
    ai_evidence_section: { type: 'text' },
    ai_evidence_excerpt: { type: 'text' },
    ai_generated_at: { type: 'timestamptz' },

    confirmed_result: { type: 'text' },
    confirmed_evidence_document_id: { type: 'uuid' },
    confirmed_evidence_document_version_id: { type: 'uuid' },
    confirmed_evidence_page: { type: 'integer' },
    confirmed_evidence_section: { type: 'text' },
    confirmed_evidence_excerpt: { type: 'text' },
    confirmed_reason: { type: 'text' },
    confirmed_by_user_id: { type: 'uuid', references: 'users', onDelete: 'RESTRICT' },
    confirmed_at: { type: 'timestamptz' },

    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_id_org_case_unique', { unique: ['id', 'organization_id', 'case_id'] })
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_case_code_unique', { unique: ['organization_id', 'case_id', 'check_code'] })
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_case_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id'], references: 'cases (organization_id, id)', onDelete: 'CASCADE' },
  })
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_ai_document_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id', 'ai_evidence_document_id'], references: 'documents (organization_id, case_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_ai_document_version_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id', 'ai_evidence_document_version_id'], references: 'document_versions (organization_id, case_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_confirmed_document_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id', 'confirmed_evidence_document_id'], references: 'documents (organization_id, case_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_confirmed_document_version_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id', 'confirmed_evidence_document_version_id'], references: 'document_versions (organization_id, case_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_code_valid', { check: `check_code IN ${CHECK_CODES}` })
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_version_positive', { check: 'version >= 1' })
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_ai_result_valid', { check: `ai_suggested_result IS NULL OR ai_suggested_result IN ${RESULT_VALUES}` })
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_ai_confidence_valid', { check: 'ai_confidence_basis_points IS NULL OR ai_confidence_basis_points BETWEEN 0 AND 10000' })
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_ai_page_positive', { check: 'ai_evidence_page IS NULL OR ai_evidence_page >= 1' })
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_ai_excerpt_valid', { check: EXCERPT_CHECK('ai_evidence_excerpt') })
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_confirmed_result_valid', { check: `confirmed_result IS NULL OR confirmed_result IN ${RESULT_VALUES}` })
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_confirmed_page_positive', { check: 'confirmed_evidence_page IS NULL OR confirmed_evidence_page >= 1' })
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_confirmed_excerpt_valid', { check: EXCERPT_CHECK('confirmed_evidence_excerpt') })
  // Onay alanlari hep-birlikte-ya-da-hic: kismi (yalniz result, actor yok
  // gibi) bir "onaylanmis" durum asla olusamaz.
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_confirmation_all_or_nothing', {
    check: `(confirmed_result IS NULL AND confirmed_by_user_id IS NULL AND confirmed_at IS NULL)
      OR (confirmed_result IS NOT NULL AND confirmed_by_user_id IS NOT NULL AND confirmed_at IS NOT NULL)`,
  })
  // "Police tamami okunmadan kloz yok sonucu verme": kesin bir sonuc
  // (same/different/present/absent) daima somut bir kanit-belge surumune
  // baglanmis olmalidir; yalniz unclear/unknown kanitsiz kalabilir.
  pgm.addConstraint('kasco_mandatory_checks', 'kasco_mandatory_checks_definitive_requires_evidence', {
    check: `confirmed_result IS NULL OR confirmed_result NOT IN ${DEFINITIVE_RESULTS} OR confirmed_evidence_document_version_id IS NOT NULL`,
  })
  pgm.createIndex('kasco_mandatory_checks', ['organization_id', 'case_id', 'updated_at'])

  pgm.createTable('kasco_mandatory_check_confirmations', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    case_id: { type: 'uuid', notNull: true },
    check_id: { type: 'uuid', notNull: true },
    check_code: { type: 'text', notNull: true },
    confirmed_result: { type: 'text', notNull: true },
    evidence_document_id: { type: 'uuid' },
    evidence_document_version_id: { type: 'uuid' },
    evidence_page: { type: 'integer' },
    evidence_section: { type: 'text' },
    evidence_excerpt: { type: 'text' },
    reason: { type: 'text' },
    ai_suggested_result_at_time: { type: 'text' },
    previous_confirmed_result: { type: 'text' },
    confirmed_by_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    request_id: { type: 'text' },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('kasco_mandatory_check_confirmations', 'kasco_mandatory_check_confirmations_check_fk', {
    foreignKeys: { columns: ['check_id', 'organization_id', 'case_id'], references: 'kasco_mandatory_checks (id, organization_id, case_id)', onDelete: 'CASCADE' },
  })
  pgm.addConstraint('kasco_mandatory_check_confirmations', 'kasco_mandatory_check_confirmations_case_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id'], references: 'cases (organization_id, id)', onDelete: 'CASCADE' },
  })
  pgm.addConstraint('kasco_mandatory_check_confirmations', 'kasco_mandatory_check_confirmations_document_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id', 'evidence_document_id'], references: 'documents (organization_id, case_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('kasco_mandatory_check_confirmations', 'kasco_mandatory_check_confirmations_document_version_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id', 'evidence_document_version_id'], references: 'document_versions (organization_id, case_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('kasco_mandatory_check_confirmations', 'kasco_mandatory_check_confirmations_code_valid', { check: `check_code IN ${CHECK_CODES}` })
  pgm.addConstraint('kasco_mandatory_check_confirmations', 'kasco_mandatory_check_confirmations_result_valid', { check: `confirmed_result IN ${RESULT_VALUES}` })
  pgm.addConstraint('kasco_mandatory_check_confirmations', 'kasco_mandatory_check_confirmations_ai_result_valid', { check: `ai_suggested_result_at_time IS NULL OR ai_suggested_result_at_time IN ${RESULT_VALUES}` })
  pgm.addConstraint('kasco_mandatory_check_confirmations', 'kasco_mandatory_check_confirmations_previous_result_valid', { check: `previous_confirmed_result IS NULL OR previous_confirmed_result IN ${RESULT_VALUES}` })
  pgm.addConstraint('kasco_mandatory_check_confirmations', 'kasco_mandatory_check_confirmations_page_positive', { check: 'evidence_page IS NULL OR evidence_page >= 1' })
  pgm.addConstraint('kasco_mandatory_check_confirmations', 'kasco_mandatory_check_confirmations_excerpt_valid', { check: EXCERPT_CHECK('evidence_excerpt') })
  pgm.addConstraint('kasco_mandatory_check_confirmations', 'kasco_mandatory_check_confirmations_definitive_requires_evidence', {
    check: `confirmed_result NOT IN ${DEFINITIVE_RESULTS} OR evidence_document_version_id IS NOT NULL`,
  })
  pgm.createIndex('kasco_mandatory_check_confirmations', ['organization_id', 'case_id', 'check_code', 'occurred_at'])

  // append_only_guard fonksiyonu migration 0006'da zaten tanimli; ayni
  // fonksiyon burada YENIDEN KULLANILIR (paralel bir korumasiz kopya
  // olusturulmaz).
  pgm.createTrigger('kasco_mandatory_check_confirmations', 'kasco_mandatory_check_confirmations_no_update', {
    when: 'BEFORE', operation: 'UPDATE', level: 'ROW', function: 'append_only_guard',
  })
  pgm.createTrigger('kasco_mandatory_check_confirmations', 'kasco_mandatory_check_confirmations_no_delete', {
    when: 'BEFORE', operation: 'DELETE', level: 'ROW', function: 'append_only_guard',
  })
}

export function down(pgm) {
  // Yalniz gelistirme/test ortami icindir.
  pgm.dropTrigger('kasco_mandatory_check_confirmations', 'kasco_mandatory_check_confirmations_no_delete')
  pgm.dropTrigger('kasco_mandatory_check_confirmations', 'kasco_mandatory_check_confirmations_no_update')
  pgm.dropTable('kasco_mandatory_check_confirmations')
  pgm.dropTable('kasco_mandatory_checks')
}
