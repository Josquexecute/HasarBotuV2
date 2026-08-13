---
name: hasarbotu-api-e2e
description: HasarBotu Fastify API akışlarını gerçek test PostgreSQL'i, HTTP veya app.inject, auth/RBAC, tenant izolasyonu, idempotency ve audit ile uçtan uca doğrulamak için kullan.
---

# HasarBotu API E2E

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `docs/API_RUNTIME_FOUNDATION.md`, `docs/DATABASE_OPERATIONS.md`, `docs/TESTING_AND_ACCEPTANCE.md` ve ilgili güncel karar kaydını oku.
- İlgili `packages/contracts/src/v1/`, `services/api/src/<modül>/`, migration ve `services/api/test/` dosyalarını incele.

## Test tasarımı

- Dış HTTP sözleşmesini contracts/Zod kaynağından al; route veya payload tahmin etme.
- Production DB kullanma. `TEST_DATABASE_URL` adının `_test` ile bittiğini ve testin şema reset etkisini doğrula.
- Secret değerini asla çıktılamama kuralını uygula; connection string, token ve cookie değerini de gösterme. Log ve assertion mesajlarında PII, tam yol veya body sızıntısı bırakma.
- Başarılı yolu tek başına yeterli sayma. 401/403/404, yabancı organization, resource ownership, closed-case, validation, optimistic conflict, idempotent replay, retry ve güvenli 5xx yollarını kapsa.
- Mutation testinde DB state'i, append-only provenance ve audit'i doğrudan sorguyla doğrula; yalnız HTTP 2xx'e güvenme.
- `app.inject` hızlı E2E için uygundur; transport/cookie/loopback davranışı önemliyse gerçek TCP testi ekle. Production servisine istek gönderme.

## Doğrulama

1. Hedef test dosyasını `npm run test --workspace @hasarbotu/api -- <test-adı>` ile çalıştır.
2. Contracts veya domain değiştiyse ilgili workspace testlerini çalıştır.
3. Migration varsa `$hasarbotu-postgres` test kapısını uygula.
4. `npm run typecheck` ve `npm run lint` çalıştır; geniş etki varsa root `npm test` ve `npm run build` çalıştır.
5. Test sayısı, skip, gerçek PostgreSQL kullanımı ve başarısızlıkları ayrı raporla; DB kapısı skip ise PASS deme.
