import { auditActionLabel, PERMISSION_DEFINITIONS, type AuditEvent } from '@hasarbotu/contracts'

const fields: Record<string, string> = {
  caseType: 'Dosya türü', workflowStage: 'İş akışı aşaması', lifecycleStatus: 'Dosya durumu',
  followUpDate: 'Takip tarihi', responsibleUserId: 'Dosya sorumlusu', expertUserId: 'Eksper',
  serviceId: 'Servis', insurerId: 'Sigorta şirketi', lossDate: 'Hasar tarihi', notificationDate: 'İhbar tarihi',
  transmission: 'Vites', displayName: 'Kullanıcı adı', roles: 'Roller', status: 'Hesap durumu',
  folderPath: 'Klasör konumu', storageRootKey: 'Depolama alanı',
  name: 'Ad', isActive: 'Etkinlik durumu', plate: 'Plaka', notificationFormNumber: 'İhbar numarası',
  insurerClaimNumber: 'Hasar numarası', serviceDetails: 'Servis iletişim bilgileri', serviceRevision: 'Servis bilgileri',
  ...Object.fromEntries(PERMISSION_DEFINITIONS.map(item => [item.code, item.label])),
}
const values: Record<string, string> = {
  admin: 'Yönetici', expert: 'Eksper', case_manager: 'Dosya sorumlusu', secretary: 'Sekreter', accounting: 'Muhasebe', read_only: 'Okuyucu',
  traffic: 'Trafik', casco: 'Kasko', open: 'Açık', closed: 'Kapalı', archived: 'Arşivde',
  active: 'Etkin', pending: 'Onay bekliyor', disabled: 'Devre dışı', manual: 'Manuel', automatic: 'Otomatik',
  new_notification: 'Yeni ihbar', inspection_pending: 'Ekspertiz bekliyor', reporting: 'Rapor hazırlanıyor',
  closing_documents: 'Kapanış evrakları', completed: 'Tamamlandı',
}
const sensitive = /pass(word|wd)?|secret|token|cookie|authorization|session|api[_-]?key|credential|hash|otp|cvv|private[_-]?key|policy[_-]?(text|body|raw|content)|raw[_-]?text|full[_-]?text|\b(content|body|text|note|notes)\b/i
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export function auditFieldLabel(field: string): string { return fields[field] ?? values[field] ?? 'Diğer alan' }
export function auditValue(value: unknown): string {
  if (value === undefined) return 'Kaydedilmemiş'
  if (value === null || value === '') return 'Boş'
  if (value === '[redacted]') return 'Gizlendi'
  if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır'
  if (Array.isArray(value)) return value.length ? value.slice(0, 50).map(auditValue).join(', ') : 'Yok'
  if (object(value)) return 'Yapılandırma değeri'
  return (values[String(value)] ?? String(value)).slice(0, 512)
}
export function auditLabel(item: AuditEvent): string {
  if (item.action.startsWith('file_operation.') && ['move_case_workspace', 'rename_case_workspace'].includes(String(item.details.operationType))) {
    return auditActionLabel(item.action).replace('Klasör işlemi:', item.details.operationType === 'move_case_workspace' ? 'Klasör taşıma:' : 'Klasör yeniden adlandırma:')
  }
  if (item.action === 'access.viewed' && typeof item.details.route === 'string') {
    if (item.details.route.endsWith('/download')) return 'Belge indirildi'
    if (item.details.route.endsWith('/export')) return 'Dosya verileri dışa aktarıldı'
    if (item.entityType === 'case') return 'Dosya görüntülendi'
  }
  return auditActionLabel(item.action)
}
export interface AuditChange { field: string; before: string; after: string }
export function auditChanges(details: Record<string, unknown>): AuditChange[] {
  const changes: AuditChange[] = []
  function compare(before: Record<string, unknown>, after: Record<string, unknown>, prefix = '', depth = 0) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (changes.length >= 50) break
      const a = before[key], b = after[key], label = [prefix, auditFieldLabel(key)].filter(Boolean).join(' · ')
      if (JSON.stringify(a) === JSON.stringify(b) || sensitive.test(key)) continue
      if (depth < 3 && object(a) && object(b)) compare(a, b, label, depth + 1)
      else changes.push({ field: label, before: auditValue(a), after: auditValue(b) })
    }
  }
  if (object(details.before) && object(details.after)) compare(details.before, details.after)
  else if (object(details.previous) && object(details.current)) compare(details.previous, details.current)
  else if (object(details.source) && object(details.destination)) compare({ folderPath: details.source.relativePath, storageRootKey: details.source.storageRootKey }, { folderPath: details.destination.relativePath, storageRootKey: details.destination.storageRootKey })
  for (const [field, oldKey, newKey] of [['roles', 'previousRoles', 'newRoles'], ['status', 'fromStatus', 'toStatus'], ['caseType', 'previousCaseType', 'caseType'], ['name', 'previousName', 'name']] as const) {
    if (Object.hasOwn(details, oldKey) && Object.hasOwn(details, newKey) && JSON.stringify(details[oldKey]) !== JSON.stringify(details[newKey])) changes.push({ field: auditFieldLabel(field), before: auditValue(details[oldKey]), after: auditValue(details[newKey]) })
  }
  return changes
}
export function safeTechnicalRecord(value: unknown, depth = 0): unknown {
  if (depth > 7) return '[sınırlandı]'
  if (Array.isArray(value)) return value.slice(0, 50).map(item => safeTechnicalRecord(item, depth + 1))
  if (object(value)) return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [key, sensitive.test(key) ? '[redacted]' : safeTechnicalRecord(item, depth + 1)]))
  return typeof value === 'string' ? value.slice(0, 2048) : value
}
export interface AuditGroup { item: AuditEvent; items: AuditEvent[] }
/** Only matching successful read/transport events on this page are grouped, within a minute. */
export function groupAuditEvents(items: AuditEvent[], enabled: boolean): AuditGroup[] {
  const groups: AuditGroup[] = [], byKey = new Map<string, AuditGroup>()
  for (const item of items) {
    const eligible = enabled && ['access.viewed', 'request.completed'].includes(item.action)
      && !(typeof item.details.statusCode === 'number' && item.details.statusCode >= 400)
    const key = JSON.stringify([item.action, item.actorUserId, item.entityType, item.entityId, item.details.method, item.details.route, item.details.statusCode])
    const previous = eligible ? byKey.get(key) : undefined
    if (previous && Math.abs(Date.parse(previous.item.occurredAt) - Date.parse(item.occurredAt)) <= 60_000) previous.items.push(item)
    else { const group = { item, items: [item] }; groups.push(group); if (eligible) byKey.set(key, group) }
  }
  return groups
}
