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
seçilmeden gerçek ambiguous/unknown kayıt işlenmez.

Claim-type evidence hiyerarşisi:

- Dosya adı case-insensitive, Türkçe karakter/aksan, boşluk, tire, alt çizgi ve
  uzantı farklarına toleranslı normalize edilir; klasör recursive taranır.
- `K Ruhsat` Kasko, `M Ruhsat` Trafik kanıtıdır. `S Ruhsat` tek başına karar
  üretmez. K+M çatışması fail-closed'dur.
- Genel Kasko/Trafik poliçesi, KTT, zabıt ve beyan başka claim bağlamında da
  bulunabildiği için context evidence olarak saklanır; tek başına tür üretmez.
  Yalnız açıkça rol-bağlı claim belgesi sidecar'ı bağımsız doğrulayabilir.
- Sidecar ile decisive evidence çatışırsa insan kararı gerekir. Inventory hash,
  evidence fingerprint, relative path ve normalize evidence kind provenance'da
  saklanır; source değişirse plan hash/TOCTOU kontrolü değişir.

Çok adaylı target çözümünde stable/native provenance ve exact claim/notification/
office identifier önceliklidir. Bunlardan biri kardeş source'u tek hedefe bağlar
ve geriye tek source/tek candidate kalırsa bijective elimination kullanılabilir.
Eski ilk-import lineage'i yalnız doğrulanmış import zaman penceresi, `case.created`
audit'i, yoğun tek import kümesi, ay başına en az üç benzersiz source/case anchor'ı,
çakışmayan office-sequence ay blokları ve tek zorunlu target ile kabul edilir.
Sıra benzerliği tek başına kanıt değildir.

Kullanıcı/eksper için yalnız normalized exact display veya source tam kimliğiyle
aynı unique e-posta local-part eşleşmesi otomatik kabul edilir. `Atanmadı`
NULL/unassigned'dır. V2 hesabı olmayan ya da ambiguous legacy adlar yanlış hesaba
bağlanmaz; FK NULL kalır, raw/source-level provenance'da korunur ve blocker olmaz.
Service için exact unique master eşleşmesi kullanılabilir. Eşleşme yoksa V1 adı
legacy provenance'da korunur; V1 adı zorunlu service type'ı kanıtlamadığı ve
normalize unique constraint bulunmadığı için otomatik master row yaratılmaz.
Placeholder kullanıcı veya servis oluşturulmaz.

Missing-sidecar klasör için veri uydurulmaz. Historical payload olmadığı için
remediation blocker'ı değildir; preview yalnız mevcut V2 case adedini ve filesystem
freshness sınıfını raporlar. Filesystem birth time vaka tarihi olarak yorumlanmaz.

## Alan kapsamı

| V1 alanı | Sınıf | V2 davranışı |
|---|---|---|
| `notes` | A | Native ID ile idempotent note; özgün yazar/zaman item metadata ve API/UI'da görünür. |
| açık `todos` | A | Task + `created` event; özgün oluşturma/atanan isim metadata'da, event kaynağı `v1_historical_import`. |
| tamamlanmış `todos` | A | `completed` task, özgün completion zamanı, `created` + `completed` event; ikisi de historical source/evidence taşır. |
| `assignment.sorumlu` | A/B | Exact unique identity ile `responsible_user_id`; `Atanmadı` NULL; V2 hesabı yoksa FK NULL + immutable legacy ad. |
| `assignment.eksper` | A/B | Yalnız gerçek expert-role kullanıcıya exact unique eşleşir; aksi halde FK NULL + immutable legacy ad. |
| `service.name` | A/B | Exact unique mevcut master'a eşleşir; service type kanıtı yoksa row yaratılmaz, FK NULL + immutable legacy ad. |
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
