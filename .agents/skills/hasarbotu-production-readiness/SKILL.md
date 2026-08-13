---
name: hasarbotu-production-readiness
description: HasarBotu'nun release/cutover veya gerçek müşteri işlemi öncesinde kod, şema, deploy, servis, storage, AI, güvenlik, test ve operasyon kanıtlarını bağımsız production-readiness denetimine tabi tutmak için kullan.
---

# HasarBotu Production Readiness

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `docs/PROJECT_STATUS.md` başını, `docs/DECISION_LOG.md` içindeki en yeni readiness/release/cutover kararlarını ve `docs/SYSTEM_PRODUCT_INVENTORY_REPORT.md` dosyasını oku.
- `docs/DEPLOYMENT_AND_OPERATIONS_PLAN.md`, Windows runbook'u, `docs/SECURITY_AND_AI_POLICY.md`, `docs/TESTING_AND_ACCEPTANCE.md` ve ilgili package/deploy kaynaklarını incele.

## Denetim yöntemi

- Varsayılanı salt-okunur audit say. Bir blocker bulunca düzeltme, migration, deploy, servis restart veya veri apply yapma; ayrı yetki olmadan “hazır hale getirmeye” çalışma.
- Kanıtı şu başlıklarda topla: source/HEAD/worktree, dependency/lockfile, migration HEAD, production config varlığı, deployed artifact hash'i, servis state/identity, DB health, storage root/freshness, auth/RBAC/tenant, secret/redaction, AI egress, backup/recovery politikası ve açık ürün riskleri.
- Güncel runtime/code kanıtını eski plan ve eski test sayısından üstün tut. `PROJECT_STATUS.md` içindeki tarihsel alt bölümleri en üst güncel kayıtla karıştırma.
- Production secret, connection string, kullanıcı/PII, tam storage yolu, e-posta/workbook içeriği veya admin-only kanıt yolunu gösterme; secret değerini asla çıktılamama kuralını uygula.
- Production readiness'i tek bir unit/build sonucuna indirgeme. Gerçek PostgreSQL, browser/Electron, Windows service, deployed byte identity, File Agent auth/freshness ve kritik workflow kanıtlarını ayrı değerlendir.

Her remediation veya production mutation için yeni immutable preview/plan ve açık onay gerekir. Audit yetkisi apply yetkisi değildir.

## Gate sonucu

- Her maddeyi `PASS | FAIL | BLOCKED | UNRUN | NOT_APPLICABLE` olarak ve güncel kanıtıyla kaydet.
- Önceden bilinen/deferred risk ile yeni blocker'ı ayır; workaround ve kullanıcı etkisini kanıt varsa yaz.
- Kod gate'leri için `$hasarbotu-test-gate`; DB için `$hasarbotu-postgres`; servis/release için ilgili skill'i uygula.
- Fresh checkout veya isolated install kanıtı isteniyorsa temiz, production dışı ortamda çalıştır; mevcut kullanıcı değişikliklerini taşıma.
- Sonuçta net `READY`, `NOT READY` veya `CONDITIONALLY READY` de; şartları ve tek sonraki adımı listele. UNRUN kritik gate varken koşulsuz READY deme.
