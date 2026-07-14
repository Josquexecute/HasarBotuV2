/**
 * Paket 18 — aktif referanslar ve case cekirdegi tarih/eksper alanlari.
 *
 * Mevcut kayitlar bozulmaz: yeni case alanlari nullable, referans aktiflik
 * alanlari mevcut satirlar icin true varsayilir. Tarihler PostgreSQL `date`
 * olarak saklanir; saat/timezone tasimaz.
 */
export const shorthands = undefined

export function up(pgm) {
  pgm.addColumns('service_centers', {
    is_active: { type: 'boolean', notNull: true, default: true },
  })
  pgm.addColumns('insurers', {
    is_active: { type: 'boolean', notNull: true, default: true },
  })
  pgm.addColumns('cases', {
    expert_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    loss_date: { type: 'date' },
    notification_date: { type: 'date' },
  })
  pgm.createIndex('cases', 'expert_user_id')
  pgm.createIndex('cases', 'loss_date')
  pgm.createIndex('cases', 'notification_date')
  pgm.addConstraint('cases', 'cases_notification_not_after_loss', {
    check: 'notification_date IS NULL OR loss_date IS NULL OR notification_date >= loss_date',
  })
}

export function down(pgm) {
  // Yalniz gelistirme/test ortami icindir.
  pgm.dropConstraint('cases', 'cases_notification_not_after_loss')
  pgm.dropIndex('cases', 'notification_date')
  pgm.dropIndex('cases', 'loss_date')
  pgm.dropIndex('cases', 'expert_user_id')
  pgm.dropColumns('cases', ['expert_user_id', 'loss_date', 'notification_date'])
  pgm.dropColumns('insurers', ['is_active'])
  pgm.dropColumns('service_centers', ['is_active'])
}
