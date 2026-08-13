---
name: hasarbotu-postgres
description: HasarBotu V2 PostgreSQL şeması, migration'ları, sorguları, transaction'ları, test veritabanı ve production DB operasyonlarını güvenle incelemek veya değiştirmek için kullan.
---

# HasarBotu PostgreSQL

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `docs/DATABASE_OPERATIONS.md`, `docs/PROJECT_STATUS.md` ve ilgili en yeni `docs/DECISION_LOG.md` kaydını oku.
- `packages/database/package.json`, `packages/database/src/`, `packages/database/migrations/` ve ilgili API store/test dosyalarını incele.

## Uygulama

- Migration dosyalarını kanonik şema kaynağı say; tablo/kolon/HEAD numarası tahmin etme.
- Her sorguda organization kapsamı, RBAC/resource ownership, parametrik SQL, optimistic concurrency ve append-only guard etkisini kontrol et.
- Yeni şema değişikliğini sıralı, deterministik, transaction-safe ve ileri düzeltilebilir migration olarak tasarla. Production'da veri kayıplı down yolunu çözüm sayma.
- Entegrasyon testini yalnız adı `_test` ile biten `TEST_DATABASE_URL` üzerinde çalıştır. Test şema resetinin production'a erişemediğini doğrula.
- Credential veya connection string değerini hiçbir komutta görünür kılma; secret değerini asla çıktılamama kuralını uygula.

Production migration veya veri mutation'ında preflight → immutable plan/önizleme → açık onay → taze `pgmigrations`/veri kontrolü → apply → bağımsız sorgu doğrulaması → audit sırasını uygula. Onaysız `migrate:up`, `migrate:down`, DDL/DML veya production seed çalıştırma.

## Doğrulama

1. İlgili domain/contracts/API testlerini çalıştır.
2. Test DB'de migration ileri, tekrar, gerekiyorsa rollback-sonrası-yeniden-ileri davranışını kanıtla.
3. `npm run test --workspace @hasarbotu/database` çalıştır; gerçek PostgreSQL bloğu skip olduysa açıkça UNRUN yaz.
4. Kapsama göre `npm run typecheck`, `npm run lint`, API E2E ve root `npm test` kapılarını çalıştır.
5. Satır sayısı, constraint, tenant izolasyonu, idempotency ve audit sonuçlarını güvenli özetlerle doğrula.
