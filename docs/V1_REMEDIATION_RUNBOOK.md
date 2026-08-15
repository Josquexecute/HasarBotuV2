# V1 Import Remediation Runbook

Durum: Production migration 0047/0048, onaylı V1 remediation data apply ve
visibility API deploy'u 2026-08-15 tarihinde tamamlandı. Beş source bilinçli
olarak unresolved quarantine'dadır; bunlar güvenli source'ların uygulanmasını
engellemedi. Rollback gerekmedi.

## Production kapanış kaydı — 2026-08-15

- Final onaylı plan ve source-manifest hash'leri servisler kapalıyken yeniden
  doğrulandı; apply sonucu 13 case create, 140 backfill, 162 note, 61 completed
  task, 96 historical closure, 175 field mapping, 149 follow-up history, 134
  task event, 158 raw provenance ve 31 move/rename reconciliation oldu.
- Apply sonrası production toplamları 180 case, 530 note, 73 task, 1029
  `v1_import_records`, 505 audit event ve 96 closed case'tir. İki ardışık replay
  sıfır actionable işlem, sıfır yeni quarantine ve sıfır duplicate üretti.
- Beş quarantine kaydı unresolved ve append-only olarak görünürdür. Quarantine
  source'larına case/note/task/alan/lifecycle mutation uygulanmadı. Gelecekteki
  manual resolution ayrı, açık reconciliation işi olacaktır.
- Historical responsible/expert/service adları first-class kullanıcı/servis FK'si
  değildir. Case detail bunları yalnız opt-in `legacyReferences` alanında güvenli
  biçimde gösterir; tam raw snapshot client'a açılmaz. `Atanmadı` gösterilmez.
- `GET /api/v1/v1-import/quarantines` yalnız mevcut admin izniyle çalışan,
  tenant-scoped, sayfalı ve salt-okunur reporting ucudur. Resolution/edit/delete
  endpoint'i yoktur.
- Visibility deployment'ı yalnız API artefaktını değiştirdi; schema/data migration
  veya File Agent artefakt deploy'u yapılmadı. API ve değiştirilmemiş File Agent
  yeniden Running duruma getirildi; health, agent auth/last_seen, storage root ve
  problemli job kontrolleri geçti.

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

Plan iki bağımsız sonuç kümesi üretir:

- `SAFE APPLY`: deterministik target/type bulunan kaynakların uygulanabilir
  işlemleri.
- `SOURCE QUARANTINE`: yalnız kendi kaynağı uygulanmayan
  `claim_type_unresolved`, `ambiguous_target`, `genuine_evidence_conflict` ve
  `malformed_source` kayıtları.

Quarantine birkaç belirsiz kaynağın bütün güvenli remediation planını bloke
etmesine izin vermez. CLI ham isim/path/not içeriği yerine yalnız token,
stable source identity, neden ve güvenli evidence özetini gösterir. Quarantine
append-only source/revision/alias provenance ile kaydedilir; public/admin raporu
ham snapshot veya path açığa çıkarmadan durumunu gösterir. Daha sonra deterministik
kanıt veya açık reconciliation oluşursa ayrı append-only resolution kaydıyla
çözülebilir. Quarantine sessiz başarı sayılmaz ve yanlış case'e alan/not/görev
bağlamaz.

Claim-type evidence hiyerarşisi:

- Dosya adı case-insensitive, Türkçe karakter/aksan, boşluk, tire, alt çizgi ve
  uzantı farklarına toleranslı normalize edilir; klasör recursive taranır.
- `K Ruhsat` authoritative Kasko, `M Ruhsat` authoritative Trafik kanıtıdır.
  `S Ruhsat` tek başına karar üretmez. K+M gerçek evidence çatışmasıdır ve
  kaynak quarantine'a alınır.
- Sidecar historical metadata'dır ve K/M fiziksel belge kanıtından düşük
  önceliktedir. Yalnız K veya yalnız M varsa karşıt sidecar değeri authoritative
  kararı değiştirmez; çatışma provenance'da korunur. K/M yoksa geçerli sidecar
  kullanılabilir.
- K/M ve kullanılabilir sidecar yoksa bütün PDF'ler yerel `pdfjs-dist` ile
  okunur. Açık Kasko ürün/poliçe rolü veya ZMSS/Trafik poliçesi rolü tek anlamlı
  kanıttır. PDF sonuç vermezse görüntüler pinned Türkçe Tesseract modeliyle
  offline OCR edilir. Ücretli API/AI/internet çağrısı yapılmaz; düşük güvenli OCR,
  genel KTT/zabıt/beyan veya bağlamsız kelime claim type üretmez.
- Karşıt explicit Kasko ve Trafik belge içeriği birlikte bulunursa kaynak
  quarantine'a alınır. Inventory hash, kanıt dosyalarının case-relative yolları,
  dosya hash'leri, extraction yöntemi/sürümü, normalize evidence kind/marker ve
  güven skoru provenance'da saklanır. Ham belge metni plan/log'a girmez. Belge
  içeriği değişirse manifest/plan hash'i değişir ve TOCTOU apply'ı reddeder.

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
2. 0047 ve 0048 migration preview/backup/runbook onayını ayrı al; migration'ları
   uygula ve şema/constraint/view/append-only trigger'ları bağımsız doğrula.
3. Aynı commit'i deploy etmek için ayrı onay/deploy/verify sürecini tamamla.
4. CLI'ı iki kez salt-okunur çalıştır. Her iki çalıştırmada `SchemaReady=true`,
   aynı source manifest/plan hash'i, aynı safe/quarantine dağılımı ve
   `duplicatesThatWouldBeCreated=0` doğrulanmadan apply yok. Ham müşteri verisini
   loglama.
5. Quarantine token/neden listesini ayrıca doğrula; quarantine'daki source için
   hiçbir case/note/task/field mutasyonu planlanmadığını kontrol et.
6. Kullanıcı exact plan hash'i onayladıktan sonra gerçek TTY'da:

   `node deploy/windows-service/run-v1-import.mjs --root "$env:HASARBOTU_V1_ROOT" --actor-email "$env:HASARBOTU_ACTOR_EMAIL" --expected-plan-hash "<64_HEX_PLAN_HASH>" --apply`

7. Apply sonrası bağımsız DB sayımı, API/UI görünürlüğü, lifecycle sorgusu ve
   ikinci preview zero-duplicate doğrulaması yap.

Backup restore, source-sidecar yazımı, ad-hoc SQL remediation, production apply,
deploy ve push bu runbook'un preview adımının parçası değildir.
