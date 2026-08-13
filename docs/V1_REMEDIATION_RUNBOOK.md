# V1 Import Remediation Runbook

Durum: Kod ve salt-okunur production preview hazırdır. Production migration,
deploy veya remediation apply henüz yapılmamıştır.

## Kalıcı kimlik ve provenance

- Source identity: `caseIdentity.caseKey + metadata.createdAt` değerlerinin
  kanonik, path-bağımsız SHA-256 fingerprint'i. İki alanın biri yoksa kaynak
  otomatik işlenmez. Gerçek V1 envanterinde bu birleşim 150/150 benzersizdir;
  `caseKey` tek başına benzersiz değildir.
- Note/task identity: stable source identity + item türü + V1 native item ID.
  Metin/title identity değildir; aynı metinli iki meşru öğe birleşmez.
- Path yalnız `v1_import_source_aliases` lineage kaydıdır. Active→KAPALI move,
  ay klasörü rename ve klasör rename source/item identity'yi değiştirmez.
- Her source hash/mapping-version çifti için raw JSON bir kez
  `v1_import_source_revisions` içinde immutable saklanır. Item-level tabloda
  yalnız hedef bağlantısı ve tarihsel semantik bulunur; büyük JSON tekrar
  edilmez.
- Eski 0046 kayıtları silinmez veya güncellenmez. Kanıtlanan stable identity'ye
  append-only `v1_import_record_reconciliations` ile bağlanır.

## Preview sözleşmesi

Varsayılan çalışma `preview`dür ve CLI tek bağlantıyı
`default_transaction_read_only=on` yapar. `Summary.actionable` yalnız writer'ın
uygulayabileceği işlemleri sayar. Blocked source içindeki note/task sayıları bu
toplama girmez. `duplicatesThatWouldBeCreated` sıfır değilse apply fail-closed
reddedilir.

`HumanResolutionTemplate` ham isim/path/note içeriği göstermeden stable source
identity, path token, candidate case ID/type/lifecycle ve identifier-match
bayraklarını üretir. Gerçek karar dosyası şu sürümdedir:
`hasarbotu-v1-resolution/1.0.0`. Target ID veya claim type kullanıcı tarafından
seçilmeden ambiguous/unknown kayıt işlenmez. Kullanıcı/eksper/servis için yalnız
normalize edilmiş benzersiz exact match veya açık token→ID mapping kabul edilir;
placeholder oluşturulmaz.

## Alan kapsamı

| V1 alanı | Sınıf | V2 davranışı |
|---|---|---|
| `notes` | A | Native ID ile idempotent note; özgün yazar/zaman item metadata ve API/UI'da görünür. |
| açık `todos` | A | Task + `created` event; özgün oluşturma/atanan isim metadata'da, event kaynağı `v1_historical_import`. |
| tamamlanmış `todos` | A | `completed` task, özgün completion zamanı, `created` + `completed` event; ikisi de historical source/evidence taşır. |
| `assignment.sorumlu` | A | Exact unique/manifest ile `responsible_user_id`; aksi halde unresolved + raw. |
| `assignment.eksper` | A | Exact unique/manifest ile `expert_user_id`; aksi halde unresolved + raw. |
| `service.name` | A | Exact unique/manifest ile `service_center_id`; aksi halde unresolved + raw. |
| `assignment.takipTarihi/sonIslemTarihi` | A | Güvenli current backfill + `v1_historical_import` follow-up history. |
| `caseIdentity.claimNoticeNo` | A | `notification_form_number`; eşleşmede deterministic identifier kanıtı. |
| `caseIdentity.dosyaNo` | A | `insurer_claim_number`; gerçek mevcut envanterde dolu örnek yoktur. |
| `claimType` | A | Yalnız `traffic/casco`; unique mevcut hedef kanıtı varsa boş tür hedef case'ten çözülür. |
| fiziksel `KAPALI <ay>` lineage | A | Migration-only `historical_close`; current closure gate'leri retroaktif koşmaz. |
| vehicle make/model/modelYear | A | Geçerli ise sürümlü vehicle profile; diğer vehicle alanları raw snapshot'ta. |
| `officeFileNo` | B | V2'nin kanonik sıralı office number'ı ezilmez; eşleşme kanıtı + raw snapshot. |
| raportör, priority, V1 workflow/status | B | Eşdeğer güvenli first-class alan yok; raw snapshot. |
| portal checklist, V1 audit/history | B | Eksiksiz raw snapshot; sahte V2 user/audit olayı üretilmez. |
| labor/heavyDamage/KTT/rücu/AI yardımcı bağlamı ve bilinmeyen ek alanlar | B/C | `.passthrough()` parser + immutable raw snapshot; sessiz kayıp yok. |

A: first-class eşleme vardır. B: operasyonel değer raw provenance'da korunur.
C: deprecated/ayrı modül alanı raw provenance'da korunur, otomatik first-class
karar üretilmez.

## Historical closure

Yol yalnız remediation writer içindedir; public API route değildir. Fiziksel
olarak `KAPALI <ay>` altında bulunan, deterministik target'ı olan ve halen açık
case için planlanır. `cases.lifecycle_status/workflow_stage` kapalı olur,
append-only lifecycle history `history_source=v1_historical_import` ve
`operation_type=historical_close` taşır. V1'de gerçek kapanış anı bulunmadığı
için `closed_at/source_occurred_at` null kalır; `metadata.updatedAt` kapanış
zamanı diye kullanılmaz. Normal reopen/file-operation gate'leri bypass edilmez.

## Production sırası

1. Güncel kod için tam test/typecheck/lint/build/check:deploy kanıtını doğrula.
2. 0047 migration preview/backup/runbook onayını ayrı al; migration'ı uygula ve
   şema/constraint'leri bağımsız doğrula.
3. Aynı commit'i deploy etmek için ayrı onay/deploy/verify sürecini tamamla.
4. CLI'ı `--summary-only` olmadan salt-okunur çalıştır; generated
   `HumanResolutionTemplate` için kullanıcı kararlarını resolution manifestine
   yaz. Ham müşteri verisini loglama.
5. Manifest ile yeni preview al. `SchemaReady=true`, human-required kabul edilen
   kapsam ve `duplicatesThatWouldBeCreated=0` doğrulanmadan apply yok.
6. Kullanıcı exact plan hash'i onayladıktan sonra gerçek TTY'da:

   `node deploy/windows-service/run-v1-import.mjs --root "$env:HASARBOTU_V1_ROOT" --resolution-file "$env:HASARBOTU_V1_RESOLUTION_FILE" --actor-email "$env:HASARBOTU_ACTOR_EMAIL" --expected-plan-hash "<64_HEX_PLAN_HASH>" --apply`

7. Apply sonrası bağımsız DB sayımı, API/UI görünürlüğü, lifecycle sorgusu ve
   ikinci preview zero-duplicate doğrulaması yap.

Backup restore, source-sidecar yazımı, ad-hoc SQL remediation, production apply,
deploy ve push bu runbook'un preview adımının parçası değildir.
