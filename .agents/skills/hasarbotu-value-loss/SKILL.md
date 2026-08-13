---
name: hasarbotu-value-loss
description: HasarBotu Trafik/Kasko değer kaybı uygunluğu, 01.07.2026 kuralı, kanıt/emsal, sürümlü hesap, kaynak snapshot'ı, rapor ve insan onayı görevlerinde kullan.
---

# HasarBotu Değer Kaybı

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `docs/DOMAIN_RULES.md` değer kaybı bölümlerini, `docs/TRAFFIC_VALUE_LOSS_PLAN.md`, `docs/VALUE_LOSS_RULE_SNAPSHOT_2026-07-01.md` ve ilgili en yeni karar/durum kaydını oku.
- `packages/domain/src/traffic-value-loss*`, `value-loss-rule-snapshot.ts`, contracts, `services/api/src/traffic-value-loss/`, UI ve testleri incele.

## Sınırlar

- Değer Kaybını bağımsız dosya türü yapma. Trafik'te zorunluluk ile Kasko'daki isteğe bağlı mevzuat/ofis politikasını ayrı alanlar olarak koru.
- Yürürlük/kural sürümünü kod ve güncel karardan doğrula. Eski katsayı formülünü veya kanıt yeterliliği eşiğini mevzuat diye uydurma.
- Eksik/çelişkili evidence, yetersiz emsal veya ağır/tam hasarı fail-closed uygun durumla göster. AI confidence kanıt kalitesini yükseltemez.
- Approved/superseded sürümü immutable tut; düzeltmeyi yeni version olarak yap. AI sonucu veya taslak insan onayı olmadan kesinleşemez.
- OOXML kaynak snapshot'ında relationship çözümle, başlangıç/bitiş source hash eşitliğini zorunlu tut ve `source_workbook` ile `product_decision` provenance'ını ayır.
- Emsal müşteri verisi, hücre değeri, tam yol, hash detayı veya secret değerini asla çıktılamama kuralını uygula.

Production onay/rapor/apply adımlarında plan/preview → açık onay → taze version/hash/evidence → apply → bağımsız hesap/snapshot/PDF doğrulaması → audit uygula. Read-only snapshot üretimi fiziksel workbook yazma yetkisi vermez.

## Doğrulama

- Domain/contracts/API/UI değer kaybı testlerini ve kural-source/PDF/closure hardening testlerini çalıştır.
- `npm run test --workspace @hasarbotu/domain -- value-loss`, `npm run test --workspace @hasarbotu/api -- traffic-value-loss`, `npm run typecheck`, `npm run lint` çalıştır.
- Tenant isolation, optimistic locking, append-only/approved immutability, insufficient evidence, rule version, canonical hash ve no-fallback yollarını doğrula.
- Gerçek workbook/browser/PostgreSQL kapılarını ayrı ayrı raporla; biri çalışmadıysa diğerini onun yerine PASS sayma.
