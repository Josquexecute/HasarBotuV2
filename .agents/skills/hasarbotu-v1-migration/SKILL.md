---
name: hasarbotu-v1-migration
description: HasarBotu V1 klasör/sidecar verisini V2'ye keşfetme, planlama, idempotent backfill/import etme veya mevcut V1 aktarımını doğrulama görevlerinde kullan.
---

# HasarBotu V1 Aktarımı

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `docs/PROJECT_STATUS.md` başını ve `docs/DECISION_LOG.md` içindeki en yeni V1 aktarım kararını oku.
- `packages/domain/src/v1-import.ts`, `services/api/src/v1-import/`, `packages/database/migrations/0046_v1_import_provenance.js`, `packages/database/migrations/0047_v1_import_remediation.js`, `deploy/windows-service/run-v1-import.mjs` ve ilgili testleri oku.

## Sınırlar

- V1 kaynak klasörlerini ve sidecar dosyalarını salt-okunur kabul et; yeniden adlandırma, düzeltme veya silme yapma.
- Plakayı benzersiz kimlik sayma. `PLAKA`, `PLAKA - 2`, `PLAKA - 3` klasörlerini ayrı source relative path/case adayları olarak koru.
- JSON/TXT önceliğini, claim type eşlemesini, closed-state ve alan backfill kararını güncel koddan doğrula; tahmin üretme.
- Mevcut dolu V2 alanını kör ezme. Belirsiz, çatışmalı, sidecar'sız veya kanıtsız kayıtları açık durumla bırak.
- `source_relative_path` tek başına identity değildir. Source için path-bağımsız stable identity, note/task için V1 native item ID kullan; path'i yalnız alias/lineage olarak sakla.
- Aynı metinli meşru note/task kayıtlarını içerik hash'iyle birbirine dedupe etme. Move/rename, aynı source replay ve partial-production reconciliation senaryolarını ayrı ayrı test et.
- Actionable sayaçlara blocked source içindeki note/task'ları katma; CLI özeti writer'ın yapacağı işlemlerle aynı semantiği taşımalıdır.
- Her parse edilen source için source-level immutable raw revision ve path alias geçmişi koru; raw JSON'u item başına çoğaltma.
- Historical KAPALI kaydı yalnız migration-only lifecycle yoluyla, güncel closure gate'lerini retroaktif çalıştırmadan ve kapanış zamanı uydurmadan taşı.
- Unknown claim type yalnız unique V2 target/provenance/identifier kanıtıyla auto-resolve edilir. Ambiguous target ve isim eşleşmeleri machine-readable resolution manifestte insan kararına bırakılır; placeholder kullanıcı oluşturulmaz.
- Note yazar/zamanı, completed task zamanı/event'i ve follow-up history canonical metadata olarak korunur; yalnız body prefix'i provenance sayılmaz.
- Eski 0046 writer'ını kullanma; remediation planner/writer stable identity ve explicit plan hash sınırını kullanır.
- Gerçek veri, not/görev içeriği, kullanıcı bilgisi, tam yol ve secret değerini asla çıktılamama kuralını uygula.

Production apply için salt-okunur discovery/preflight → sıfır-yazmalı preview ve sayım → immutable plan → açık onay → taze preview/TOCTOU → vaka-bazlı transaction apply → bağımsız sayım/idempotency/provenance doğrulaması → audit sırasını zorunlu tut. Preview onay değildir; `--apply` çalıştırma.

## Doğrulama

- `npm run test --workspace @hasarbotu/domain -- v1-import`
- `npm run test --workspace @hasarbotu/api -- v1-import`
- Şema etkisi varsa `npm run test --workspace @hasarbotu/database`
- `npm run typecheck` ve `npm run lint`
- Sentetik fixture ile create/backfill/conflict/ambiguous/missing-sidecar/duplicate/TOCTOU yollarını doğrula.
- Production preview ancak kullanıcı kapsamındaysa salt-okunur çalıştır; Apply'ı ayrı onaya bırak.
