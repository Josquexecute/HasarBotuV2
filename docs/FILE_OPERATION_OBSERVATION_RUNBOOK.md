# İlk gerçek File Agent işi — production observation runbook (HB-2026-178)

Tarih: 2026-08-09
Kapsam: D9 operasyonel cutover'ı tamamlandıktan sonra (HB-2026-177), File
Agent'a atanacak **ilk gerçek İşçilik workbook yazım işi** (`apply_labor_workbook`)
için salt-okunur bir gözlem/kanıt paketi nasıl üretilir.

## Ne zaman kullanılır

İlk gerçek vaka File Agent'a atanıp `apply_labor_workbook` job'ı
tamamlandığında (başarılı **veya** başarısız) — bu araç sentetik veri
üretmez, yalnız **zaten var olan** Postgres kayıtlarını (jobs,
`labor_workbook_apply_operations`, agents, audit_events) ve isteğe bağlı
olarak rapor anında bağımsızca yeniden hesaplanan **güncel** bir Session-0
freshness gate sonucunu bir araya getirir.

## Araç

`deploy/windows-service/generate-file-operation-observation-bundle.mjs`

```powershell
$env:DATABASE_URL = "postgres://hasarbotu_app:$pw@127.0.0.1:5432/hasarbotu"
node .\deploy\windows-service\generate-file-operation-observation-bundle.mjs `
  --job-id '<apply_labor_workbook job id>'
```

Yalnız Postgres tarafını (Job/Operation/Agent/AuditEventChain/IsolationCheck)
gösterir. pCloud tarafını (attestation/current-revision eşleşmesi) da dahil
etmek için (File Agent'ın KENDİ makinesinde, aynı env değerleriyle):

```powershell
node .\deploy\windows-service\generate-file-operation-observation-bundle.mjs `
  --job-id '<job id>' `
  --case-relative-path '<vakanın göreli klasör yolu, ör. 2026\00AAA000>'
```

`--top-level-folder-name`/`--pcloud-db`/`--attestation-store`/`--target-root`
verilmezse sırasıyla `HASARBOTU_AGENT_PCLOUD_TOP_LEVEL_FOLDER`/
`HASARBOTU_AGENT_PCLOUD_DB_PATH`/`HASARBOTU_AGENT_ATTESTATION_STORE`/
`HASARBOTU_AGENT_ROOTS` (Machine env, File Agent'ın zaten kullandığı AYNI
değerler) otomatik kullanılır — çoğu durumda yalnız `--job-id` +
`--case-relative-path` yeterlidir.

`--job-id`'yi bulmak için: yönetim panelinde/`labor_workbook_apply_operations`
tablosunda ilgili vakanın `apply_job_id`/`preview_job_id` sütunu.

## Çıktının bölümleri ve nasıl okunur

| Bölüm | Kaynak | Ne kanıtlar |
|---|---|---|
| `Job` | `jobs` tablosu | Kuyruk durumu: `status`, `attempt_count`, `last_error_code`. `status:"succeeded"` + `last_error_code:null` sağlıklıdır. |
| `Agent` | `agents` tablosu (`jobs.leased_by_agent_id` üzerinden) | İşi HANGİ agent aldı, o agent hâlâ `active` mı, `last_seen_at` ne kadar taze. |
| `Operation` | `labor_workbook_apply_operations` | Vaka referansı (`CaseId`), workbook yolu, onaylı revizyon hash'i, nihai `status`. |
| `HashFence` | Aynı tablo, `source_workbook_hash`/`result_workbook_hash` | **Yazım öncesi/sonrası kimlik-hash çiti** — `Verdict:"verified_end_to_end"` = API, agent'ın raporladığı `startSha256`/`resultSha256`'yı KENDİ kayıtlı `source_workbook_hash`'ıyla sunucu tarafında ayrıca doğruladı (`RESULT_HASH_MISMATCH` olsaydı `mismatch_detected_server_side_rejected` dönerdi — ham agent iddiasına asla güvenilmez, bkz. `services/api/src/labor-workbook-apply/store.ts`). |
| `AuditEventChain` | `audit_events` | `labor_workbook.apply_approved` → `apply_claimed` → `writer_started` → `writer_completed`/`writer_failed` → `apply_completed`/`apply_failed` kronolojik anlatısı, her aşamada hash değerleri dahil. |
| `IsolationCheck` | `jobs` (aynı organizasyon, aynı ±1 saatlik pencere) | Bu işin başarısız olması (varsa) BAŞKA bir vakayı/job'ı etkilemedi mi? `CrossCaseLeakDetected:false` + `Verdict:"isolated"` beklenen sağlıklı durumdur. `true` çıkarsa gerçek bir mimari sorunu işaret eder — ayrı, acil incelemeyi gerektirir. |
| `FreshnessObservation` | `pcloud-session0-freshness-gate.mjs` (rapor anında, bağımsızca yeniden çağrılır) | **ÖNEMLİ:** bu, tarihsel kararın tekrarı DEĞİLDİR — freshness gate'in kendi kararı Postgres'te kalıcı değildir (yalnız `case_not_fresh` hata kodu iz bırakır). Bu bölüm rapor anındaki GÜNCEL durumu gösterir; `Entries[]` içindeki her dosya için attestation/current-revision eşleşmesi (`FileStatus`, `FileId`, `PCloudHash`, `AttestedAtUtc`) ayrıca görülebilir. |

## Başarısızlık senaryosu

`Job.Status` `failed`/`dead_letter` ise:
1. `Job.LastErrorCode`'a bakın (`case_not_fresh` ise freshness gate reddetti — bu BEKLENEN, fail-closed davranıştır, veri kaybı YOKTUR).
2. `IsolationCheck.Verdict`'in `isolated` olduğunu doğrulayın — yalnız BU vaka etkilenmeli.
3. `AuditEventChain`'deki `writer_failed`/`apply_failed` olayının `details` alanına bakın (varsa hangi aşamada, hangi hash'le başarısız olduğu).
4. Bu araç **düzeltme yapmaz** — yalnız gözlemler. Gerçek bir repair/retry kararı ayrı, açık bir kullanıcı onayı gerektirir (AGENTS.md §7).

## Kapsam dışı (bilerek)

- Sentetik/test vakası oluşturmaz — yalnız GERÇEK, zaten var olan bir job'u okur.
- Hiçbir DB satırına/dosyaya yazmaz (yalnız kendi Administrators-only kanıt raporunu isteğe bağlı olarak `C:\ProgramData\HasarBotu\migration-preflight\`'a yazan bir sarmalayıcı eklenmedi bu turda — CLI çıktısı stdout'a JSON olarak yazılır; operatör isterse kendi `> dosya.json` ile kaydeder).
- `labor_workbook_apply` DIŞINDAKİ job türleri (ör. `file_operation`, `verify_document`) için henüz destek yok — `UNSUPPORTED_TARGET_TYPE` ile açıkça reddedilir, yanıltıcı/eksik bir rapor üretilmez.
