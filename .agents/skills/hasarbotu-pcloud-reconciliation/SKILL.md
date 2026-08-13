---
name: hasarbotu-pcloud-reconciliation
description: HasarBotu'nun pCloud ile yerel NTFS çalışma kopyası arasındaki vaka-bazlı freshness, attestation, diff, reconciliation, repair veya kontrollü cleanup görevlerinde kullan.
---

# HasarBotu pCloud Uzlaştırma

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `docs/D9_PER_CASE_RECONCILIATION_ARCHITECTURE.md`, `docs/PROJECT_STATUS.md`, `docs/SYSTEM_PRODUCT_INVENTORY_REPORT.md` §22 ve HB-2026-162 sonrası ilgili kararları oku.
- `deploy/windows-service/pcloud-*.mjs`, `run-pcloud-*.ps1`, attestation/freshness araçları, repair/cleanup scriptleri ve testlerini incele.

## Sınırlar

- Güncel modelde kritik kapıyı vaka bazında değerlendir. Eski 600 saniyelik tüm-ağaç sessizlik kapısını production yazım önkoşulu olarak geri getirme; yalnız bakım/denetim rolünü koru.
- pCloud yerel DB'sini ve source ağacını salt-okunur kullan. DB/WAL/SHM veya source dosyalarını değiştirme.
- `ready | syncing | conflict | unknown` ve `stale_target | rename_artifact | unknown` ayrımlarını güncel koddan uygula. `unknown`, extra veya rename artefact'i otomatik silme/taşıma.
- Attestation kimliği, pre/post identity fence, task referansları, case scope ve hash kanıtı eksikse fail-closed dur.
- Tam path, dosya içeriği, pCloud hesap bilgisi/DB satırı ve secret değerini asla çıktılamama kuralını uygula.

Repair veya cleanup mutation'ında salt-okunur forensics → exact allowlist ve immutable rapor/hash → güvenli preview → açık onay → taze kimlik/freshness kontrolü → tek vaka/tek dosya apply → iki taraflı hash/varlık doğrulaması → audit sırasını uygula. Silme için kanıtlanmış sınıflandırma ve geri kazanım kaynağı yoksa dur.

## Doğrulama

- İlgili `deploy/windows-service/*.test.mjs` ve `*.tests.ps1` testlerini sentetik köklerde çalıştır.
- `npm run check:deploy` çalıştır.
- Ready, active-sync, conflict-name, stale-target, rename-artifact, unknown, metadata-only ve identity drift yollarını test et.
- Production'da önce yalnız preview/forensics çalıştır; gerçek repair/cleanup sonucunu bağımsız SHA-256 ve kuyruk/freshness kontrolüyle doğrula.
