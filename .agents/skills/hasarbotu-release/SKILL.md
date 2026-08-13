---
name: hasarbotu-release
description: HasarBotu sürüm hazırlığı, version/artifact kontrolü, Windows NSIS paketleme, release acceptance, deploy planı, install/uninstall smoke, tag/push veya yayın görevlerinde kullan.
---

# HasarBotu Release

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `docs/PROJECT_STATUS.md`, en yeni release/deployment kararları, `docs/SYSTEM_PRODUCT_INVENTORY_REPORT.md`, `docs/DEPLOYMENT_AND_OPERATIONS_PLAN.md` ve Windows servis runbook'unu oku.
- Root `package.json`, `apps/desktop/package.json`, Electron kaynak/testleri, `deploy/windows-service/` ve `scripts/check-*` dosyalarını incele.

## Release akışı

- Önce worktree/branch/HEAD/version/dependency/artifact durumunu salt-okunur doğrula. Mevcut kullanıcı değişikliklerini release'e sessizce dahil etme.
- Release kapsamını installer, servis artifact'i, DB migration, extra reference data ve production cutover olarak ayrı kalemler halinde göster.
- Açık talimat olmadan version bump, commit, push, tag, GitHub release, deploy, installer kurma veya servis restart yapma.
- Artifact içine `.env*`, credential, log, gerçek veri, source map veya tam fiziksel yol girmediğini doğrula. Secret değerini asla çıktılamama kuralını uygula.
- İmza durumunu gerçek sonucu ile raporla; imzasız artifact'i imzalı/güvenilir diye sunma. Mevcut V1/V2 ürün adı çakışması riskini güncel karardan kontrol et.

Production release/deploy için immutable manifest/hash ve rollback içeren preflight/preview → açık onay → taze gate → build/package/deploy → install/launch/health/version/data-boundary doğrulaması → finalize/audit sırasını uygula. Commit/push/tag/release için ayrıca açık Git yetkisi gerekir.

## Doğrulama

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run check:deploy` ve gerekiyorsa `npm audit` çalıştır.
- `npm run package:win --workspace @hasarbotu/desktop` sonucunu boyut/hash/imza ile doğrula.
- İzole test API/DB ile install→launch→health/proxy→uninstall→kalıntı kontrolü yap; gerçek production servisleri/veriyi test sırasında değiştirme.
- Deployed `dist` ile onaylanan build manifestini byte/hash bazında karşılaştır.
- Her gate'i PASS/FAIL/BLOCKED/UNRUN bildir; eski rapordaki test sayısını yeni koşu gibi sunma.
