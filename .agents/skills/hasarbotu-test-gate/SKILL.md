---
name: hasarbotu-test-gate
description: HasarBotu değişikliğinin kapsamına göre typecheck, lint, unit, component, PostgreSQL E2E, browser, Electron, workbook, Windows servis, build ve fresh-checkout kapılarını seçmek ve dürüst raporlamak için kullan.
---

# HasarBotu Test Kapısı

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `docs/TESTING_AND_ACCEPTANCE.md`, root ve ilgili workspace `package.json`, `docs/DATABASE_OPERATIONS.md` ve güncel `docs/PROJECT_STATUS.md` test kaydını oku.
- Değişen dosyalardan etkilenen domain/contracts/API/UI/File Agent/Desktop/Windows test yüzeyini çıkar.

## Gate seçimi

- Önce en dar regresyon testini, sonra etki alanının workspace testini, en son gerekli root kapılarını çalıştır.
- TypeScript değişiminde typecheck; source değişiminde lint; runtime/package değişiminde build; frontend'de component+bundle+görsel; API/DB'de gerçek test PostgreSQL E2E; deploy'da `check:deploy` + script testleri seç.
- `TEST_DATABASE_URL` `_test` değilse DB testini çalıştırma. Production DB, gerçek customer workbook/storage veya canlı servisi otomatik test yüzeyi yapma.
- Secret/connection string değerini komut veya çıktıda göstermeme; secret değerini asla çıktılamama kuralını uygula.
- Windows timeout veya `3221225477` gibi kararsızlıkta etkilenen suite'i izole et ve gerekirse `--maxWorkers=1` kullan; ilk başarısızlığı gizleme.

## Zorunlu ayrımlar

- Unit/component PASS; gerçek PostgreSQL, TCP, browser, Electron, workbook, Windows service veya fresh checkout PASS anlamına gelmez.
- Skip, unavailable dependency, stale artefact ve önceki oturum sonucu güncel PASS değildir.
- Testin gerçek production mutation gerektirdiği durumda test diye çalıştırma; ayrı preview/onay/apply/verify kapısına taşı.

## Rapor

- Her komut için çalışma dizini, exit code, pass/fail/skip sayısı ve önemli uyarıyı güvenli biçimde yaz.
- Gate tablosunu `PASS | FAIL | BLOCKED | UNRUN` ile ver ve nedeni ekle.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run check:bundle`, `npm run check:deploy` komutlarından yalnız gerçekten gerekenleri çalıştır; çalıştırılmayanı geçmiş sayma.
- UI'da 1366×768, 1920×1080, açık/koyu tema ve scroll/overflow kontrollerini ayrı satırlar olarak raporla.
