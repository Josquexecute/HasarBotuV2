/**
 * Paket 09 — dosya yazma destegi: ofis numarasi sayaci ve idempotency kayitlari.
 *
 * - office_counters: firma+yil bazinda monoton sayac. Numara atama ayni
 *   transaction icinde UPSERT ... RETURNING ile yapilir; iptal/silinme
 *   durumunda numara ASLA yeniden dagitilmaz (HB-2026-008 G14).
 * - idempotency_keys: kritik POST komutlarinin tekrar korumasi; ayni anahtar
 *   ayni govdeyle geldiginde saklanan yanit aynen dondurulur.
 */
export const shorthands = undefined

export function up(pgm) {
  pgm.createTable('office_counters', {
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    office_year: { type: 'integer', notNull: true },
    last_sequence: { type: 'integer', notNull: true, default: 0 },
  })
  pgm.addConstraint('office_counters', 'office_counters_pk', {
    primaryKey: ['organization_id', 'office_year'],
  })
  pgm.addConstraint('office_counters', 'office_counters_year_range', {
    check: 'office_year BETWEEN 2000 AND 9999',
  })
  pgm.addConstraint('office_counters', 'office_counters_sequence_nonnegative', {
    check: 'last_sequence >= 0',
  })

  pgm.createTable('idempotency_keys', {
    id: { type: 'uuid', primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations', onDelete: 'RESTRICT' },
    scope: { type: 'text', notNull: true },
    idem_key: { type: 'text', notNull: true },
    request_hash: { type: 'text', notNull: true },
    response_status: { type: 'integer', notNull: true },
    response_body: { type: 'jsonb', notNull: true },
    case_id: { type: 'uuid', references: 'cases', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  })
  pgm.addConstraint('idempotency_keys', 'idempotency_keys_unique', {
    unique: ['organization_id', 'scope', 'idem_key'],
  })
}

export function down(pgm) {
  // Yalniz gelistirme/test ortami icindir.
  pgm.dropTable('idempotency_keys')
  pgm.dropTable('office_counters')
}
