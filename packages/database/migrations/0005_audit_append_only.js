/**
 * Paket 11 — merkezi audit altyapisi sertlestirmesi.
 *
 * Mevcut `audit_events` tablosu (0002) temel alinir; PARALEL bir audit sistemi
 * kurulmaz. Bu migration yalniz:
 *  - Append-only'yi VERITABANI seviyesinde zorlar: UPDATE/DELETE bir trigger ile
 *    reddedilir (uygulama politikasina ek olarak savunma katmani). INSERT serbest.
 *  - Kiracı kapsamli sorgu ve varlik aramasi icin indeks ekler.
 *
 * Not: TRUNCATE ve tablo-sahibi DDL'i bu triggerlarla engellenmez; normal API
 * yalniz parametreli INSERT/SELECT calistirdigi icin bu yeterli savunmadir.
 */
export const shorthands = undefined

export function up(pgm) {
  pgm.createIndex('audit_events', ['organization_id', 'occurred_at'])
  pgm.createIndex('audit_events', ['organization_id', 'resource_type', 'resource_id'])

  pgm.createFunction(
    'audit_events_prevent_mutation',
    [],
    { returns: 'trigger', language: 'plpgsql' },
    `BEGIN
       RAISE EXCEPTION 'audit_events is append-only: % is not permitted', TG_OP
         USING ERRCODE = 'restrict_violation';
     END;`,
  )

  pgm.createTrigger('audit_events', 'audit_events_no_update', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'audit_events_prevent_mutation',
  })
  pgm.createTrigger('audit_events', 'audit_events_no_delete', {
    when: 'BEFORE',
    operation: 'DELETE',
    level: 'ROW',
    function: 'audit_events_prevent_mutation',
  })
}

export function down(pgm) {
  // Yalniz gelistirme/test ortami icindir.
  pgm.dropTrigger('audit_events', 'audit_events_no_delete')
  pgm.dropTrigger('audit_events', 'audit_events_no_update')
  pgm.dropFunction('audit_events_prevent_mutation', [])
  pgm.dropIndex('audit_events', ['organization_id', 'resource_type', 'resource_id'])
  pgm.dropIndex('audit_events', ['organization_id', 'occurred_at'])
}
