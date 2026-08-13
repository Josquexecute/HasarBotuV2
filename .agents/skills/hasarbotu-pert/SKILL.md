---
name: hasarbotu-pert
description: HasarBotu PERT/ağır hasar assessment, sürümleme, AI önerisi, eksper kanaati, merkez/sigorta kararı, API/UI ve audit akışlarını incelemek veya değiştirmek için kullan.
---

# HasarBotu PERT

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `docs/DECISIONS.md`, `docs/DOMAIN_RULES.md` PERT bölümü, `docs/PROJECT_STATUS.md` ve ilgili güncel kararı oku.
- `packages/domain/src/pert-assessment.ts`, contracts PERT modülü, `services/api/src/pert/`, migration `0030_pert_assessment_core.js`, UI ve testleri incele.

## Sınırlar

- AI önerisi, eksper kanaati ve merkez/sigorta kararını farklı alan, aktör ve zaman damgalarıyla ayrı tut.
- State transition ve rol/lifecycle guard'larını güncel domain/contracts kaynağından al; durum veya geçiş uydurma.
- Eksik evidence, rayiç/onarım/sovtaj belirsizliği veya optimistic conflict'i kontrol gerektiren durum olarak koru; varsayılan nihai sonuç üretme.
- AI, eksper veya merkez yerine karar veremez. Nihai kanaat/karar için yetkili insan, açık onay ve gerekçe/provenance zorunludur.
- Güncel üründe kapanış PERT'ten bağımsızsa bu davranışı kendiliğinden bağlama; ayrı ürün kararı olmadan closure gate ekleme.
- Müşteri/evidence içeriği, tam yol, ham AI çıktısı ve secret değerini asla çıktılamama kuralını uygula.

PERT kanaati veya merkez kararı production mutation'ıdır: read-only workspace/kanıt önizlemesi → açık onay → taze case/version/permission kontrolü → apply → history/audit geri-okuması uygula.

## Doğrulama

- `npm run test --workspace @hasarbotu/domain -- pert`
- `npm run test --workspace @hasarbotu/contracts -- pert`
- `npm run test --workspace @hasarbotu/api -- pert`
- PERT component/UAT E2E testi, `npm run typecheck` ve `npm run lint`
- Tenant, role, closed-case, invalid transition, optimistic conflict, idempotency ve audit negatif yollarını doğrula.
