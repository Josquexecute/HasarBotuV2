---
name: hasarbotu-labor
description: HasarBotu İşçilik föyü, AI önerisi/dağıtımı, kategori profili, workbook preflight, immutable apply planı ve File Agent üzerinden güvenli Excel yazımı görevlerinde kullan.
---

# HasarBotu İşçilik

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `docs/ARCHITECTURE.md` workbook sınırını, `docs/SECURITY_AND_AI_POLICY.md`, `docs/TESTING_AND_ACCEPTANCE.md` Paket 65A/65B ve ilgili güncel karar/durum kayıtlarını oku.
- `packages/domain/src/labor-*`, `packages/contracts/src/v1/labor*`, `services/api/src/labor*`, `services/file-agent/src/labor-workbook-*`, ilgili UI ve testleri incele.

## Sınırlar

- AI suggested/proposed değeri onaylı/final snapshot yerine kullanma. Current revision, exact row reference, profile/version, conflict-free durum ve insan onayını zorunlu tut.
- Kategori eksenini veya legacy profile semantiğini sessizce yeniden yorumlama; güncel domain sürümünü izle.
- Preflight salt-okunurdur. Gerçek workbook yoksa oluşturma; şablon, worksheet, hedef hücre veya formül davranışı tahmin etme.
- API/renderer workbook byte'ına dokunamaz. Yalnız File Agent writer olabilir; queue/lease/operation/plan hash zincirini koru.
- Makro/imza/external link/OLE/DDE, formüllü hedef, reparse/path escape, stale lock, protected-cell veya plan drift durumunda fail-closed dur.
- Hücre değerini, workbook binary'sini, gerçek müşteri içeriğini, mutlak root'u veya secret değerini asla çıktılamama kuralını uygula.

Fiziksel workbook apply için preflight → immutable write plan + plan hash → kullanıcıya hücre adresi/özet önizlemesi → açık onay → taze source hash/revision/profile kontrolü → exclusive backup → temp write → hedef/doğunulmayan OOXML doğrulaması → atomik replace → geri-okuma → finalize/audit uygula. Hata halinde kaynak bytes'ını koru ve doğrulanmış rollback yap.

## Doğrulama

- İlgili domain, contracts, API, File Agent ve UI testlerini; ardından `npm run typecheck` ve `npm run lint` çalıştır.
- `npm run test --workspace @hasarbotu/file-agent -- labor-workbook` ve `npm run test --workspace @hasarbotu/api -- labor-workbook` odak testlerini çalıştır.
- Preflight/apply plan hash, stale revision, conflict, lock, protected range, formula, backup, atomic replace, rollback ve untouched-part regresyonlarını doğrula.
- Gerçek workbook UAT yalnız açık onaylı kopya/şablonla yapılır; gerçek customer workbook kapısını çalıştırmadıysan UNRUN yaz.
