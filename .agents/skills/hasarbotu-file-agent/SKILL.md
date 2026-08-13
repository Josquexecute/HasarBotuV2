---
name: hasarbotu-file-agent
description: HasarBotu File Agent iş kuyruğu, path çözümleme, workspace oluşturma/taşıma, belge doğrulama, OCR/PDF ve workbook fiziksel I/O akışlarını incelemek, geliştirmek veya işletmek için kullan.
---

# HasarBotu File Agent

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `docs/PROJECT_STATUS.md`, `docs/SYSTEM_PRODUCT_INVENTORY_REPORT.md` §21–22, `docs/FILE_STORAGE_AND_AGENT_PLAN.md` ve ilgili en yeni karar kaydını oku.
- `services/file-agent/src/`, `services/file-agent/test/`, ilgili `services/api/src/agent|file-operations|workspace/` ve contracts dosyalarını incele.

## Sınırlar

- Aktif runtime kökünü eski planlardan veya `P:\` varsayımından çıkarma; config, service environment ve güncel production kaydından doğrula.
- File Agent fiziksel I/O'nun tek yetkili sahibidir; API/renderer workbook veya case dosyası byte'ına doğrudan dokunamaz. Agent DB'ye doğrudan yazmaz, API protokolünü kullanır.
- Yalnız `storageRootKey + relativePath` kabul et. Drive/UNC/mutlak yol, `..`, backslash kaçışı, reserved ad, symlink/junction/reparse point ve root escape'i fail-closed reddet.
- Lease/ownership/version/location snapshot/idempotency ve server-side sonuç doğrulamasını koru. Agent'ın “başarılı” beyanını tek başına kesin sonuç sayma.
- Hedef doğrulanmadan kaynağı silme. Belirsizlikte `manual_recovery_required` veya eşdeğer kontrollü durum üret; otomatik tahmin/merge/overwrite yapma.
- Ham OS hatası, mutlak root, müşteri içeriği ve secret değerini asla çıktılamama kuralını uygula.

Gerçek mkdir/move/rename/copy/quarantine/workbook/OCR işlemlerinde plan → önizleme → açık onay → vaka-bazlı freshness/kimlik kontrolü → apply → hash/manifest geri-okuma → finalize/audit sırasını uygula. Drift veya freshness `unknown` ise yazma yapma.

## Doğrulama

- İlgili unit/integration testini ve `npm run test --workspace @hasarbotu/file-agent` komutunu çalıştır.
- API protokolü değiştiyse contracts ve API agent/file-operation E2E testlerini çalıştır.
- Windows servis paketine dokunulduysa `npm run check:deploy` ve ilgili sentetik `.tests.ps1` / `.test.mjs` testini çalıştır.
- Temp root'ta traversal, reparse, locked file, hash mismatch, retry, crash recovery ve idempotency negatif yollarını doğrula.
- Gerçek storage mutation'ını test yerine kullanma; yalnız ayrı, açık production onayıyla çalıştır.
