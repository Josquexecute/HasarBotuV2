# HasarBotu V2 — Dosya Depolama ve File Agent Planı

Tarih: 2026-07-11
Durum: Plan; gerçek dosya erişimi veya yazma kodu değildir

Bu planın temel güvenlik modeli **tek yazıcı** yaklaşımıdır: kritik fiziksel dosya ve klasör hareketlerini yalnız ana File Agent uygular.

## 1. Kaynak doğruluk ayrımı

- PostgreSQL vaka, belge/fotoğraf metadata'sı, göreli yol, hash, boyut, durum ve audit kaydının kaynak doğruluğudur.
- Storage root PDF, Excel, fotoğraf ve fiziksel klasör byte'larını tutar.
- Veritabanına `P:\...`, `C:\...` veya cihaza özel mount yolu yazılmaz.
- File Agent dışındaki uygulama bileşenleri kritik fiziksel taşıma/rename/silme yapmaz.
- Metadata `READY` olmadan dosya UI'de kesin erişilebilir sayılmaz; fiziksel doğrulama olmadan işlem başarıya dönmez.

## 2. Storage root profili

Her kurulumda bir `rootKey` ve yerel/servis konfigürasyonundaki mutlak root eşleşmesi bulunur:

```text
rootKey: baran-global-primary
Windows agent config: P:\BARAN GLOBAL EKSPERTİZ
Geçici test agent config: C:\HasarBotuSandbox\storage
```

Database yalnız `rootKey` + POSIX biçimli göreli yol saklar. Root config secret değildir ancak yalnız yetkili operatör tarafından değiştirilebilir ve auditlenir. Client cihazlarda opsiyonel salt-okunur mapping bulunabilir; canonical yazma root'u ana File Agent'a aittir.

### 2.1 Uygulama durumu (Paket 12 — HB-2026-018)

Bu temel UYGULANDI (fiziksel işlemler ve File Agent hâlâ ayrı):

- Mantıksal `storage_roots` (org bazlı), vaka `case_locations` (rootKey + güvenli göreli yol + `verification_status` + `source` + optimistic `version`) ve append-only `case_location_history` tabloları (Migration 0006). Mutlak yol kolonu YOKTUR.
- **pCloud / `P:\BARAN GLOBAL EKSPERTİZ` MEVCUT köktür**; veritabanında yalnız `rootKey` (ör. `baran-global-primary`) + göreli yol tutulur. Cihaz→mutlak eşleme yalnız yerel File Agent/config'tedir; başka disk/NAS köküne geçiş şema/veri değişmeden yalnız yerel config güncellemesiyle yapılır (taşınabilirlik).
- Güvenli göreli yol doğrulaması hem uygulamada (domain `parseRelativePath`) hem veritabanı CHECK'inde zorlanır: `..`, absolute, sürücü ön eki, UNC/backslash, kontrol karakteri, Windows yasak karakter/aygıt adı reddedilir.
- Konum atama/değiştirme oturum + kiracı kapsamlı, optimistic locking'li ve merkezi audit'e (Paket 11) atomik bağlıdır; mutlak yol yanıt/audit/log'a sızmaz. Fiziksel klasör oluşturma/taşıma/rename, `verified` geçişi ve `P:` tarama bu pakette YOKTUR.

### 2.2 Metadata durum modeli ve File Agent doğrulaması (Paket 13 — HB-2026-019)

Belge/fotoğraf META VERİSİ UYGULANDI (fiziksel işlemler ve File Agent hâlâ ayrı):

- `documents` (mantıksal slot, optimistic `version`), `document_versions` (immutable kayıtlı gerçek + doğrulama durumu, önceki sürüm ilişkisi) ve `photos` (bağımsız kayıt) tabloları (Migration 0007). Alanlar: orijinal ad, güvenli gösterim adı, uzantı, MIME, byte boyutu, SHA-256 (BEYAN), `storage_root_key` + güvenli göreli yol (mutlak yol yok), belge/kaynak türü.
- **Durum modeli** `pending | ready | failed | missing`. Kayıt DAİMA `pending` başlar. Public API veya normal istemci `ready`/doğrulama sonucunu BELİRLEYEMEZ (registration şeması bu alanları içermez). Veritabanı CHECK'i `ready`yi yalnız `hash_verified AND size_verified AND verified_at IS NOT NULL` iken mümkün kılar — fiziksel dosya doğrulanmadan `ready` OLUŞAMAZ.
- **Append-only + immutable:** `metadata_append_guard` trigger'ı `document_versions`/`photos` üzerinde DELETE'i ve kayıtlı gerçeklerin (ad/hash/boyut/yol/tür/...) değiştirilmesini reddeder; YALNIZ doğrulama alanları (`status`, `hash_verified`, `size_verified`, `verified_at`) güncellenebilir.

**File Agent doğrulaması (ileride, bu pakette YOK):**

1. API `pending` metadata + göreli yol + BEYAN edilen SHA-256/boyut kaydeder (güvenilmez beyan; kesinleştirilmez).
2. File Agent, `storage_root_key`'i yerel config'teki mutlak köke çözer ve göreli yolu kök-içinde güvenle birleştirir (traversal kontrolü tekrarlanır).
3. Fiziksel dosya okunur; SHA-256 ve byte boyutu YENİDEN hesaplanır.
4. Eşleşme varsa File Agent AYRICALIKLI yolla (public API değil) yalnız doğrulama alanlarını damgalar: `hash_verified=true`, `size_verified=true`, `verified_at=now()`, `status='ready'` (guard bu güncellemeye izin verir, ready CHECK'i sağlanır).
5. Hash/boyut uyuşmazlığında `status='failed'`; dosya bulunamazsa `status='missing'`. Her geçiş merkezi audit olayı üretir.
6. Beyan edilen hash ile doğrulanan hash ASLA otomatik olarak birbirinin yerine geçmez; uyuşmazlık reconciliation/manuel-drift sinyalidir (§10, §14).

### 2.3 File Agent kontrol katmanı ve iş kuyruğu (Paket 14 — HB-2026-020)

Doğrulama KONTROL KATMANI ve protokol UYGULANDI (gerçek fiziksel taşıma/rename/silme hâlâ ayrı):

- Ayrı `services/file-agent` workspace'i yalnız API üzerinden çalışır; DB'ye yazmaz. `agents` tablosu cihaz kimliğini tutar (secret yalnız SHA-256 hash; ham secret DB/audit/log'a yazılmaz). `jobs` tablosu PostgreSQL kuyruğudur: `FOR UPDATE SKIP LOCKED` claim (tek sahip), lease + heartbeat + timeout recovery, attempt/üstel-backoff/`dead_letter`. Job payload YALNIZ mantıksal rootKey + göreli yol + beyan hash/size taşır (mutlak yol CHECK ile engellenir).
- Agent, `storageRootKey`'i YEREL config'teki mutlak köke çözer (§2, §2.1), göreli yolu güvenle birleştirir ve `realpath` ile symlink/junction kaçışını reddeder. SHA-256 STREAMING hesaplanır (§5 adım 6 ilkesiyle; tüm dosya belleğe alınmaz), boyut gerçek dosyadan alınır. Gözlenen değerler sunucuya bildirilir; SUNUCU beyanla karşılaştırıp `pending→ready`/`failed`/`missing` kararını verir. Metadata + iş + merkezi audit tek transaction'dadır; metadata sürüm yarışında eski sürüm ezilmez; sonuç bildirimi idempotenttir.
- KALAN (sonraki paketler): §5 gerçek atomik yükleme/kesinleştirme, §7 lock marker, §10 staging/quarantine recovery, §13 silme/karantina, Windows service sarmalayıcısı ve cross-volume taşıma.

## 3. Göreli yol ve klasör standardı

### 2.4 Koşullu evrak kural motoru (Paket 15)

Değerlendirme yalnız belge sürümünün doğrulanmış `ready` durumunu kullanır. `pending` ve `failed` adayları dosyayı mevcut yapmaz; kullanıcı kontrolü ister. Salt-okunur API yalnız güvenli kimlik ve durum referansı döndürür; fiziksel yol veya içerik taşımaz.

Önerilen canonical format:

```text
{year}/{monthFolder}/{caseFolder}/{category}/{safeFileName}
```

Örnekler:

```text
2026/Temmuz 2026/34MPA764/EVRAK/ruhsat__docv_01.pdf
2026/Temmuz 2026/34MPA764 - 2/HASAR/hasar_001__photo_01.jpg
2026/KAPALI TEMMUZ 2026/34MPA764/DEĞER KAYBI/deger_kaybi__docv_02.pdf
```

Kurallar:

- Path separator database/API sözleşmesinde `/`; File Agent yerel işletim sistemine dönüştürür.
- `caseFolder` mevcut plaka standardını korur: boşluksuz uppercase plaka, tekrar vaka için ` - 2`, ` - 3`.
- Sıra tahsisi plaka benzersizliği varsaymaz; database'teki case folder reservation ile yarış koşulu engellenir.
- Alt kategoriler: `EVRAK`, `HASAR`, `OLAY YERİ`, `ONARIM`, `DEĞER KAYBI`.
- Kapanışta aylık açık kökten `KAPALI {AY} {YIL}` köküne planlı taşıma yapılır; yeniden açma ters plan üretir.
- Göreli yol boş, `..`, drive harfi, UNC prefix, null byte veya root dışına çözüm içeremez.

## 4. Dosya adı güvenliği

- Original file name metadata olarak güvenli/maskeleme kontrollü saklanabilir; fiziksel ad `safeFileName` olur.
- Unicode NFKC normalization, kontrol karakteri temizliği ve Windows reserved ad kontrolü uygulanır.
- Yasak karakterler (`<>:"/\\|?*`) güvenli ayraçla değiştirilir.
- Uzantı allow-list + MIME sniffing + magic-byte kontrolü birlikte kullanılır; yalnız uzantıya güvenilmez.
- İsim uzunluğu ve tam resolved path limiti agent konfigürasyonuyla sınırlandırılır.
- Çakışma durumunda overwrite yoktur; immutable document/photo version ID suffix'i eklenir.
- Kullanıcıya tam mutlak yol gösterilmez; göreli iş yolu veya dosya adı gösterilir.

## 5. Upload ve atomik kesinleştirme

```text
1. API upload intent oluşturur: PENDING metadata + idempotency key.
2. Byte izinli staging alanına alınır; hedef klasöre doğrudan yazılmaz.
3. File Agent boyut/MIME/hash doğrular.
4. Hedef root ve parent folder canonical olarak çözülür; root kaçışı kontrol edilir.
5. Aynı volume'da `.hasarbotu-staging/{jobId}` geçici dosyası oluşturulur.
6. Flush/close sonrası SHA-256 tekrar hesaplanır.
7. Atomik rename/move ile immutable hedef ada kesinleştirilir.
8. Hedef tekrar okunur; size/hash eşitliği doğrulanır.
9. PostgreSQL metadata READY, relative_path/hash/size ve job sonucu ile güncellenir.
10. Audit event oluşturulur; staging güvenli biçimde temizlenir.
```

Cross-volume taşıma gerekiyorsa rename atomik değildir: copy-to-temp → hash verify → destination rename → source quarantine sırası kullanılır. Kaynak, hedef doğrulanmadan silinmez.

## 6. Hash ve duplicate yönetimi

- SHA-256 bütünlük kanıtıdır; güvenlik/duplicate sinyalidir ancak iş anlamında aynı belge kararı tek başına değildir.
- `(rootKey, relativePath)` unique; hash index duplicate adaylarını bulur.
- Aynı case/document slot içinde aynı hash tekrar yüklenirse idempotent mevcut sürüm sonucu dönebilir.
- Farklı case'lerde aynı hash otomatik birleştirilmez; olası yanlış eşleştirme uyarısı ve kullanıcı kontrolü gerekir.
- Hash değişimi File Agent dışı manuel müdahale sinyalidir; metadata otomatik üzerine yazılmaz, reconciliation kaydı açılır.

## 7. Lock ve çakışma

- Kritik case folder işi için PostgreSQL advisory lock veya job-level case lease; aynı anda tek aktif iş.
- Agent ayrıca hedef klasörde kısa ömürlü lock marker kullanabilir; stale marker recovery kurallı olmalıdır.
- Lease `locked_by`, `locked_until`, heartbeat içerir; process ölürse süre sonunda recovery mümkündür.
- UI manuel yeniden denemede yeni job yerine aynı idempotency sonucunu görür.
- Kullanıcı Windows Explorer ile manuel taşırsa File Agent otomatik geri taşımaz; `MANUAL_DRIFT_DETECTED` üretir ve kullanıcı doğrulaması ister.

## 8. PostgreSQL tabanlı görev kuyruğu önerisi

İlk hacim ve tek-agent kararı için ayrı ücretli/operasyonel queue yerine PostgreSQL job tablosu önerilir; kesin seçim açık karardır.

Temel alanlar:

- `id`, `type`, `case_id`, `payload_version`, `safe_payload`
- `idempotency_key`, `request_id`, `requested_by`
- `status`: `PENDING`, `LEASED`, `RUNNING`, `VERIFYING`, `SUCCEEDED`, `RETRY_WAIT`, `FAILED`, `CANCELLED`, `REQUIRES_REVIEW`
- `attempt_count`, `max_attempts`, `next_attempt_at`
- `locked_by`, `locked_until`, `heartbeat_at`
- `source_relative_path`, `target_relative_path`
- `result_hash`, `result_size`, `error_code`, `safe_error_detail`

Worker claim örüntüsü kısa transaction içinde `FOR UPDATE SKIP LOCKED` kullanır. Dosya I/O transaction dışında yürür; status/lease ile saga tamamlanır.

## 9. Retry politikası

- Retry edilebilir: paylaşım geçici yok, dosya kullanımda, geçici I/O hatası, agent restart.
- Retry edilmez: path traversal, MIME/extension reddi, hash mismatch, permission policy ihlali, root dışında hedef.
- Exponential backoff + jitter; kesin süre/deneme sayısı operasyon kararıdır.
- Her deneme aynı idempotency key ve immutable payload hash kullanır.
- Max attempt sonrası `REQUIRES_REVIEW`; kullanıcı düzeltmeden yeni path/payload denenmez.
- Agent kapanırken yeni job almayı durdurur, heartbeat/lease'i güvenli bırakır.

## 10. Yarım işlem recovery

Agent başlangıçta recovery taraması yapar:

1. Süresi dolmuş `LEASED/RUNNING/VERIFYING` job'ları bulur.
2. Staging ve hedef varlığını ayrı ayrı kontrol eder.
3. Hedef hash doğruysa DB sonucunu idempotent tamamlar.
4. Hedef yok, staging doğruysa kesinleştirmeyi tekrarlar.
5. Her ikisi farklı/şüpheliyse hiçbirini silmez; quarantine + `REQUIRES_REVIEW`.
6. Recovery eylemi ayrı audit event üretir.

Reconciliation işi database metadata ile storage envanterini karşılaştırır; otomatik toplu düzeltme yapmaz.

## 11. pCloud / `P:\` bağlantı kesintisi

- Agent root health probe başarısızsa yeni write/move job almaz.
- API `STORAGE_UNAVAILABLE` veya `PENDING_STORAGE` gösterir; case iş verisi okunabilir kalır.
- Metadata READY olmayan upload başarı sayılmaz.
- Kullanıcıya root'un mutlak yolu veya credential detayı gösterilmez.
- Bağlantı gelince pending işler policy'ye göre otomatik retry olabilir; kritik taşıma için kullanıcı plan/onayının süresi geçmediyse devam eder, aksi halde yeniden önizleme ister.
- pCloud senkron işareti File Agent başarı kanıtı değildir; yerel hedef hash/size doğrulanır.

## 12. Kullanıcı cihaz erişimi

Önerilen sıra:

1. Web kullanıcıları belgeyi API tarafından üretilen kısa ömürlü open/download intent ile okur.
2. Desktop kullanıcıları varsa yerel salt-okunur root mapping üzerinden dosyayı açabilir; renderer mutlak yolu görmez, preload doğrulanmış relative path alır.
3. Kullanıcı istemciler depolama köküne doğrudan yazmaz/taşımaz.
4. Büyük medya için API proxy veya yerel mapping performans kararı deployment spike'ında verilir.

## 13. Silme ve karantina politikası

- Doğrudan kalıcı silme yoktur.
- Kullanıcı eylemi önce database'te mantıksal silme/quarantine planı üretir.
- Kritik silme için önizleme, yetki, gerekçe, kullanıcı onayı ve idempotency key zorunludur.
- File Agent dosyayı root içindeki erişimi kısıtlı `KARANTINA/{year}/{jobId}` göreli alanına atomik taşır.
- Metadata original path, quarantine path, hash, actor, reason ve restore deadline/policy ref tutar.
- Restore aynı doğrulama ve audit akışıyla yapılır.
- Kalıcı purge ancak retention/hukuki karar, ikinci yetkili onay ve doğrulanmış yedek sonrası ayrı bakım aracıyla; başlangıç kapsamı değildir.

## 14. Audit event'leri

En az:

- `FILE_JOB_PLANNED`, `FILE_JOB_STARTED`, `FILE_JOB_RETRIED`
- `FILE_HASH_VERIFIED`, `FILE_MOVE_SUCCEEDED`, `FILE_MOVE_FAILED`
- `FILE_QUARANTINED`, `FILE_RESTORED`
- `MANUAL_DRIFT_DETECTED`, `FILE_RECOVERY_REQUIRES_REVIEW`

Event path değerleri göreli ve gerektiğinde maskeli; raw exception/credential/log yoktur.

## 15. Test stratejisi

- Path traversal ve Windows reserved name unit testleri.
- Temp sandbox'ta atomik move/copy/hash integration testleri.
- Aynı idempotency key tekrar testi.
- Agent crash noktalarının her adımında recovery testleri.
- Root bağlantı kesintisi, disk dolu, permission denied, locked file testleri.
- Duplicate ve manuel drift reconciliation testleri.
- Gerçek `P:\`/pCloud üzerinde test yalnız ayrı yetkili UAT ortamı ve dry-run önizleme ile.

## 16. Açık kararlar

- PostgreSQL job queue yaklaşımı onayı.
- Canonical root yalnız merkezde mi, client salt-okunur mapping var mı?
- Upload byte yolu API proxy mi, desktop staging mi?
- pCloud dışı bağımsız fiziksel dosya yedeğinin sahibi ve retention'ı.
- Karantina süresi ve kalıcı purge yetki modeli.
- Büyük fotoğraf/thumbnail cache konumu.

## 17. Paket 19 — Case çalışma klasörü oluşturma (uygulandı)

- `case_workspace_provisionings` planı göreli yolu DB’de rezerve eder; plan ve GET preview filesystem’e dokunmaz.
- `provision_case_workspace` işi yalnız oturumlu kullanıcının açık onayından sonra PostgreSQL kuyruğuna girer. Vaka başına tek rezervasyon ve hedef başına tek aktif job DB kısıtıdır.
- Agent `mkdir` işlemini recursive toplu çağrı yerine bileşen bileşen yapar; her adımda `lstat + realpath` ile ordinary-directory/root containment denetimi uygular. Symlink/junction/reparse point reddedilir.
- Agent yeniden çalışırsa mevcut doğru ana/alt dizinleri başarı kabul eder ve yalnız eksikleri oluşturur. Hata hâlinde rollback-delete yoktur; job retry/dead-letter politikası ve güvenli hata kodu kullanılır.
- Agent progress heartbeat’i `applying`/`verifying` durumunu bildirir. `verified` sonuçta server, case location yarışını tekrar kontrol eder; stale sonuç yazılmaz.
- Başarı transaction’ı `case_locations(verified, system)`, append-only history, provisioning `ready`, job `succeeded` ve merkezi audit’i birlikte yazar.

## 18. Paket 20 — Case çalışma klasörü move/rename saga altyapısı (uygulandı)

- `case_file_operations` fiziksel iş kuyruğu değildir; mevcut `jobs` kuyruğundaki uzun süren DB/filesystem sagasının operation kimliği, hedef rezervasyonu, optimistic location snapshot'ı, manifest özeti ve recovery durumudur.
- Plan/preview filesystem'i değiştirmez. Yalnız doğrulanmış mevcut Case location üzerinde, açık onay ve zorunlu idempotency anahtarıyla `rename_case_workspace` veya `move_case_workspace` işi açılır. Aynı vaka için tek aktif operasyon ve aynı case-insensitive hedef için tek rezervasyon DB'de zorlanır.
- Same-root planı `atomic_rename` ile başlar. Hedef önceden varsa overwrite/merge yapılmaz. Case-only Windows rename operationId'ye bağlı güvenli geçici ad kullanır. Rename olmuş fakat API sonucu kesinleşmemişse Agent hedefi yeniden manifestleyerek idempotent recovery yapar; belirsizliği otomatik geri taşımaz.
- Farklı root veya `EXDEV`, `staged_copy` kullanır: operation-specific staging → streaming copy → her dosyada SHA-256/size → tam manifest eşitliği → atomik publish → DB location switch → ayrı cleanup işi. Tam entry listesi yalnız Agent process belleğindedir; DB/API/audit yalnız manifest hash'i ve file/directory/byte sayaçlarını taşır.
- `cleanup_pending`, doğrulanmış hedef ve yeni DB location'ın korunduğu, kaynak cleanup'ının beklediği retry edilebilir durumdur. Cleanup öncesi kaynak/hedef manifestleri yeniden doğrulanır. Kaynak değişmişse silme yoktur; kısmi silme veya çelişkili gerçek durum `manual_recovery_required` olur.
- Server Agent'ın “başarılı” beyanını koşulsuz kabul etmez: agent/job ownership ve lease, operation version/active job, beklenen case location version, destination reservation ve manifest özeti transaction içinde yeniden doğrulanır.
- Agent lstat/realpath ile ordinary directory ve root containment kontrolü yapar. Traversal, absolute/drive/UNC/backslash, kontrol/aygıt adları, symlink/junction/reparse point ve root escape reddedilir. Mutlak root, ham OS hatası ve secret DB/API/audit/log'a çıkmaz.
- Testler yalnız sentetik geçici root'larda çalışır. Gerçek `P:\`, gerçek müşteri klasörü ve üretim migration kullanılmaz. Paket 21 close/reopen hedef yol iş kuralını üretip bu operation katmanını kullanabilir; Paket 20 close/reopen veya son kullanıcı taşıma UI'si sağlamaz.

## 19. Paket 21 — Close/reopen fiziksel saga kullanımı

- Lifecycle planı istemciden path almaz. Close destination mevcut verified location + `notificationDate` ile kapalı ay altına, reopen destination son append-only close history'deki önceki açık logical location'a server tarafında üretilir.
- Lifecycle approve yeni fiziksel sistem kurmaz; Paket 20 `case_file_operations` kaydı ve mevcut `jobs` kuyruğuna transaction içinde bağlanır. Tek aktif lifecycle/file operation ve destination reservation kısıtları birlikte geçerlidir.
- Agent sonucu ownership/lease, lifecycle/file operation sürümü, case/location snapshot'ı ve destination reservation ile yeniden doğrulanır. Verified location switch ile lifecycle/workflow/history/audit tek transaction'da kesinleşir.
- Same-volume atomic rename ve gerekirse staged-copy/cleanup semantiği değişmez. `cleanup_pending` finalize edilmiş lifecycle ile görünür uyarı olabilir; belirsiz durum `manual_recovery_required` olur ve kullanıcıya başarılı close/reopen gösterilmez.
- Mutlak root Agent yerel config'inde kalır. DB/API/audit/log yalnız logical storage referansı taşır. Gerçek `P:\` üzerinde test deployment/pilot aşamasına bırakılmıştır.

## 20. Paket 22 sınırı

Servis profili ve sigorta şirketi anlaşması yalnız PostgreSQL iş metadata'sıdır. File Agent job protokolü, physical resolver, case workspace yolu ve close/reopen move saga'sı değişmez. Kapanış planının belge snapshot'ı yeni servis uygunluk sonucunu kullanır; bu sonuç Agent'a serbest path veya fiziksel işlem yetkisi vermez.

## 21. Paket 24 — PDF text extraction Agent sınırı

- Kaynak yalnız server’ın doğruladığı case documentVersion logical `storageRootKey + relativePath` değeridir; istemci/Agent mutlak veya serbest yol göndermez.
- Resolver traversal/drive/UNC/backslash/control/device ve root escape’i; her lexical bileşende symlink/junction/reparse noktasını reddeder. Kaynak plan/uygulama hash+size ile yeniden doğrulanır.
- Agent kaynağı streaming `wx` temp kopyaya alır, kopyayı tekrar hash’ler ve PDF magic’i doğrular. Parser ayrı worker, exact sürüm, memory/timeout/output sınırı ve ağ/shell olmadan çalışır; complete/hata/timeout sonrası worker+temp kapanır.
- Her page chunk server’da tekrar sanitize/normalize/segment/hash doğrulamasından geçer. Final summary yalnız lease/ownership/version, ardışık sayfa ve output manifest eşleşirse ready/partial/ocr_required olur.
- Encrypted/malformed/locked/missing/changed/limit/timeout güvenli kodlardır; ham OS/parser hata veya mutlak temp/root path API/audit/log’a taşınmaz. OCR/AI ve gerçek `P:\` testi yoktur.
