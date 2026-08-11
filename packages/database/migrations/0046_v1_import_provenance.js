/**
 * V1 -> V2 aktarim provenance/idempotency kaydi (paketleme sonrasi kritik
 * kusur duzeltmesi -- V1 gercek plaka klasorlerindeki `_HASARBOTU/takip.json`
 * verisi V2'ye hic tasinmiyordu, HB-2026-198 sonrasi bulundu).
 *
 * V1 kaynagi (takip.json/HASARBOTU_TAKIP_OZETI.txt) READ-ONLY'dir; bu tablo
 * V2 tarafinda ne olusturuldugunun/nereden geldiginin kalici izidir. Ayni
 * kaynak-klasor + ayni oge (case/alan/not/gorev) ikinci kez calistirildiginda
 * store once bu tabloyu sorgular -- benzersizlik kisiti duplicate satir
 * olusmasini DB seviyesinde de imkansiz kilar.
 *
 * Bir kez yazilan kayit degismez (append-only, digger tum audit/provenance
 * tablolariyla ayni ilke) -- bir celiskinin sonradan cozulmesi YENI bir kayit
 * demektir, mevcut olanin degistirilmesi degil.
 */
export const shorthands = undefined

const ITEM_TYPES = "('case','field_backfill','note','task','vehicle_profile')"
const TARGET_TYPES = "('case','case_note','case_task','case_vehicle_profile','none')"
const STATUSES = "('created','backfilled','skipped_existing','conflict','unknown_type','unparseable')"
const SOURCE_FILE_KINDS = "('takip_json','takip_ozeti_txt')"

export function up(pgm) {
  pgm.createTable('v1_import_records', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    // Yeni case olusturulmadan once (ör. 'conflict'/'unparseable') null olabilir.
    case_id: { type: 'uuid' },
    // Mutlak yol DEGIL: yapilandirilan V1 kok dizinine gore goreli yol
    // (ör. "2026/Temmuz 2026/34BKU210") -- storage_roots ile ayni ilke.
    source_relative_path: { type: 'text', notNull: true },
    source_file_kind: { type: 'text', notNull: true },
    source_file_hash: { type: 'text', notNull: true },
    source_schema_version: { type: 'integer' },
    source_write_id: { type: 'text' },
    source_revision: { type: 'integer' },
    item_type: { type: 'text', notNull: true },
    // 'case'/'vehicle_profile' icin sabit deger, 'field_backfill' icin
    // "field:<ad>", 'note'/'task' icin V1'in kendi id'si -- benzersizlik
    // kisitinin her item_type icin ayni sekilde calismasi icin HEP dolu.
    source_item_id: { type: 'text', notNull: true },
    target_type: { type: 'text', notNull: true },
    target_id: { type: 'uuid' },
    status: { type: 'text', notNull: true },
    // Conflict durumunda V1/V2 degerlerinin karsilastirmasi.
    field_diffs: { type: 'jsonb' },
    // V2'de henuz birinci-sinif kolonu olmayan V1 alanlari (ör. portalChecklist,
    // aiHelperContext, vehicleContext) kaybolmasin diye oldugu gibi saklanir.
    raw_snapshot: { type: 'jsonb' },
    imported_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    imported_by_user_id: { type: 'uuid', references: 'users', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('v1_import_records', 'v1_import_records_case_tenant_fk', {
    foreignKeys: { columns: ['organization_id', 'case_id'], references: 'cases (organization_id, id)', onDelete: 'RESTRICT' },
  })
  pgm.addConstraint('v1_import_records', 'v1_import_records_item_type_valid', { check: `item_type IN ${ITEM_TYPES}` })
  pgm.addConstraint('v1_import_records', 'v1_import_records_target_type_valid', { check: `target_type IN ${TARGET_TYPES}` })
  pgm.addConstraint('v1_import_records', 'v1_import_records_status_valid', { check: `status IN ${STATUSES}` })
  pgm.addConstraint('v1_import_records', 'v1_import_records_source_file_kind_valid', { check: `source_file_kind IN ${SOURCE_FILE_KINDS}` })
  pgm.addConstraint('v1_import_records', 'v1_import_records_hash_shape', { check: "source_file_hash ~ '^[0-9a-f]{64}$'" })
  // Idempotency: ayni kaynak klasor + ayni ogeyi ikinci kez calistirmak DB
  // seviyesinde de yeni bir satir olusturamaz.
  pgm.addConstraint('v1_import_records', 'v1_import_records_idempotency_unique', {
    unique: ['organization_id', 'source_relative_path', 'item_type', 'source_item_id'],
  })
  pgm.createIndex('v1_import_records', ['organization_id', 'case_id'])
  pgm.createIndex('v1_import_records', ['organization_id', 'status'])

  // append_only_guard fonksiyonu migration 0006'da zaten tanimli; ayni
  // fonksiyon burada YENIDEN KULLANILIR (paralel korumasiz kopya olusturulmaz).
  pgm.createTrigger('v1_import_records', 'v1_import_records_no_update', {
    when: 'BEFORE', operation: 'UPDATE', level: 'ROW', function: 'append_only_guard',
  })
  pgm.createTrigger('v1_import_records', 'v1_import_records_no_delete', {
    when: 'BEFORE', operation: 'DELETE', level: 'ROW', function: 'append_only_guard',
  })
}

export function down(pgm) {
  pgm.dropTrigger('v1_import_records', 'v1_import_records_no_delete')
  pgm.dropTrigger('v1_import_records', 'v1_import_records_no_update')
  pgm.dropTable('v1_import_records')
}
