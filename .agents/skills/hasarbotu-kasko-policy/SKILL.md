---
name: hasarbotu-kasko-policy
description: HasarBotu Kasko poliçe analizi, PDF/OCR/AI candidate akışı, kanonik fact/senaryo, muafiyet ve yedi zorunlu Kasko kontrolü görevlerinde kullan.
---

# HasarBotu Kasko Poliçesi

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `docs/DOMAIN_RULES.md` Kasko bölümleri, `docs/CASCO_POLICY_ANALYSIS_PLAN.md`, `docs/CASCO_POLICY_CANONICAL_MODEL.md`, `docs/CASCO_POLICY_SCENARIO_RULES.md` ve güvenlik politikasını oku.
- Güncel HB-2026-187..191 kararlarını; `casco-policy.ts`, `kasco-mandatory-check.ts`, policy analysis/AI/OCR, contracts/API/UI ve testleri incele.

## Sınırlar

- Poliçe analiz sistemi ile yedi zorunlu Kasko kontrolünü ayrı akışlar olarak koru. Aralarında güncel kodda olmayan otomatik bağlantı veya AI öneri üretimi uydurma.
- Yalnız aynı tenant/case'e ait `ready + hashVerified + sizeVerified + verifiedAt` belge sürümünü evidence kabul et.
- Fact, clause, page/excerpt, conflict, confidence ve human approval zincirini koru. Hüküm bulunmuyorsa bilinmiyor/control-required bırak; genel sektör bilgisini poliçe hükmü yapma.
- Muafiyet, servis/parça şartı, maliyet paylaşımı, kapsam dışı sonucu veya operation hold insan onayı olmadan bağlayıcı hale getirme.
- Kasko kapanışında yedi zorunlu kontrol gate'ini fail-closed koru; Trafik case'ini bu gate ile engelleme.
- Ham poliçe/OCR metni, gerçek kişi bilgisi, tam yol, provider response ve secret değerini asla çıktılamama kuralını uygula.

Bağlayıcı policy/mandatory-check mutation'ında evidence önizlemesi → explicit insan kararı/onayı → taze case/document/version kontrolü → apply → immutable history/audit doğrulaması uygula. AI candidate review/promotion, nihai poliçe onayı değildir.

## Doğrulama

- Domain/contracts/API/UI Kasko, policy-analysis, policy-AI, OCR ve mandatory-check testlerini hedefli çalıştır.
- Gerçek test PostgreSQL'i ile tenant, closed-case, permission, seven-check closure block, conflict ve append-only davranışını doğrula.
- `npm run typecheck`, `npm run lint` ve etki genişse root `npm test`/build çalıştır.
- Gerçek müşteri poliçesi veya live provider kullanma; browser/PDF/OCR/live AI kapılarını ayrı PASS/UNRUN olarak raporla.
