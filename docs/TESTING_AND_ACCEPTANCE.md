# HasarBotu V2 — Test ve Kabul Kriterleri

## Genel

### Paket 18 — Referans veriler ve Case çekirdeği kabulü

- Dört referans GET ucu oturum ister, session organization'ı dışına çıkmaz ve yalnız aktif kayıt döndürür; eksper yalnız gerçek `expert` rolündeki aktif kullanıcıdır.
- `expertUserId`, `lossDate`, `notificationDate` create/update/read sözleşmelerinde ve audit güvenli özetinde bulunur. Tarihler LocalDate'tir; ihbar tarihi hasar tarihinden önce olamaz.
- Pasif/tenant-dışı/role uygun olmayan referans alan bazlı reddedilir. Mevcut pasif ilişki okunabilir; yeniden atanamaz. Optimistic locking ve idempotency regresyona uğramaz.
- API UI formları gerçek katalogları gösterir; yükleme, 401 ve ağ/5xx halinde mock seçenek üretmez. Mock prototip değişmez.
- Gerçek PostgreSQL'de 0010 up/repeat/down-up, mevcut kayıt korunumu ve constraint; gerçek API'de tenant/active/role/create/update/read/audit; tarayıcıda create/edit ve 1366×768/1920×1080 açık-koyu doğrulanmalıdır.
- Paket 18 tarayıcı kanıtı: kurulu Chrome ile gerçek API login→aktif referanslar→Trafik create→zengin alanları server/detayda okuma→ikinci gerçek eksper ve LocalDate update→stale 409/reload; pasif/tenant-dışı reddi ve API kesintisinde no-fallback geçti. 1366×768 açık/koyu ile 1920×1080 koyuda body overflow yok, form scrollbar politikası korundu ve console warning/error/exception 0 kaldı.

### Paket 17 — Yeni İhbar ve temel dosya düzenleme UI kabulü

- API modunda Trafik/Kasko oluşturma gerçek POST ucunu kullanır; plaka kanonik, ofis numarası server kaynaklıdır. Aynı payload retry'sı aynı Idempotency-Key'i kullanır ve çift submit tek komuttur.
- Başarı yeni caseId detayına yönlenir ve server ofis no/caseId sonucu görünür. Validation/unknown-reference alan bazlı; 401/404/409/5xx/ağ hataları güvenli ve mock fallback olmadan gösterilir.
- Düzenleme yalnız Case update contract alanlarını ve `expectedVersion`'ı gönderir; yeni version saklanır. Stale version 409'da yeniden yükleme sunulur; plaka/tür/ofis no/lifecycle değiştirilemez, close/reopen yoktur.
- Referans endpoint'i olmayan kataloglar sahte kayıtla doldurulmaz. Contract dışı eksper, hasar tarihi ve ihbar tarihi disabled görünür ve payload'a yazılmaz.
- Gerçek PostgreSQL/API testinde Traffic/Kasko create, idempotent replay, update/stale/reload, tenant reddi ve merkezi audit doğrulanır; audit'te teknik/secret sızıntısı yoktur.
- Canlı Vite/browser akışı login→create→edit→conflict→reload→edit→logout; ağ kesintisinde mock fallback yok; 1366×768 ve 1920×1080 açık/koyu taşma kontrolü geçmelidir.

### Paket 15 — koşullu evrak motoru kabulü

- `ready` yalnız doğrulanmış File Agent metadata'sı ile mevcut sayılır; pending/failed kontrol gerektirir.
- Zabıt/KTT/Beyan alternatif grubu, Tramer koşulu ve rüculu Kasko belirsizliği deterministik domain testleriyle doğrulanır.
- API oturum zorunluluğu, tenant 404'ü ve yanıtta/audit'te mutlak yol veya belge içeriği bulunmaması gerçek PostgreSQL + canlı HTTP testinde doğrulandı.
- Salt-okunur GET değerlendirmesinin `document_rule_evaluations` snapshot'ı veya audit olayı yazmadığı DB sayaçlarıyla doğrulandı.

### Paket 16 — Evrak ve Fotoğraf gerçek API kabulü

- Mock moddaki mevcut checklist ve 12/108 fotoğraf stres görünümü baseline testleriyle aynen korunur.
- API modunda requirements, belge sürümleri ve fotoğraf metadata'sı DataPort üzerinden okunur; gerçek boş, yükleniyor, 401, tenant 404 ve ağ hatası ayrı gösterilir, mock fallback yoktur.
- Trafik/Kasko/Olay/Rüculu Kasko grupları; present/missing/control_required/not_applicable; alternatif grup gerekçesi ve kural sürümü görünürdür.
- pending/failed/missing fiziksel durumları ayrı; ready yalnız hash+boyut+verifiedAt kanıtıyla fiziksel doğrulanmış gösterilir.
- Dosya adı, sürüm, MIME, boyut ve güvenli göreli konum görünür; mutlak yol, belge içeriği, hash veya secret görünmez.
- Gerçek PostgreSQL + çalışan API + Vite proxy tarayıcı akışında login, Trafik, rüculu Kasko, rücu belirsizliği, tenant 404 ve logout sonrası 401 doğrulanır. GET sonrası snapshot/evaluation-audit sayaçları değişmez.
- UI etkisi 1366×768 açık/koyu ve 1920×1080 koyu tema; iç scrollbar ve yatay metadata tablosu ile görsel olarak kontrol edilir.

### Paket 19 — güvenli Case çalışma klasörü kabulü

- Plan/preview çağrısı gerçek PostgreSQL’de rezervasyon ve güvenli özet üretir; sentetik filesystem’de hiçbir dizin oluşturmaz. Onaysız plan için provisioning job bulunmaz.
- Onay zorunlu `Idempotency-Key` taşır; replay ve eşzamanlı iki onay tek aktif işe ve tek fiziksel klasör yapısına dönüşür.
- File Agent yalnız sentetik geçici root’ta ana klasör + beş sabit alt klasörü oluşturur; mevcut/kısmi yapı idempotent tamamlanır, kısmi hatada silme yoktur ve retry eksikleri tamamlar.
- Traversal, drive, UNC, symlink/junction/reparse point; tenant dışı erişim; stale location; 401/404/409; mutlak yol/secret/ham hata sızıntısı negatif testleri geçmelidir.
- `ready` yalnız Agent fiziksel doğrulamasından sonra; verified case location + history + provisioning/job/audit aynı transaction’da oluşmalıdır.
- Gerçek tarayıcı smoke’unda API login → preview → açık onay → applying/verifying → ready; ağ hatasında no-fallback; 1366×768 açık/koyu ve 1920×1080 tema/overflow/console kontrolleri yapılmalıdır.

Bir görev ancak:

- Kod derleniyorsa
- Type check geçiyorsa
- İlgili testler geçiyorsa
- Ana kullanıcı akışı çalışıyorsa
- Hata ve sınırlar raporlandıysa

tamamlandı sayılır.

## UI prototip kabulü

- Sol menü gerçek sayfa değiştirir
- Tema anahtarı çalışır
- Yoğunluk anahtarı çalışır
- Dosya seçimi sağ paneli günceller
- Çift tık tam dosyayı açar
- Dosya sekmeleri içerik değiştirir
- Kritik modal açılır/kapanır
- Filtre ve arama mock veride çalışır
- 1366×768 kırılmaz
- 1920×1080 alanı verimli kullanır
- Scrollbar görünür
- Açık ve koyu tema tutarlıdır
- Türkçe olmayan etiket kalmaz

## Domain regresyon test seti

Planlanan anonim örnekler:

- 10 Trafik
- 10 Kasko
- 5 PERT
- 5 Değer Kaybı
- 5 Kapanma Ücreti
- 5 İşçilik Excel'i
- Anonim Kasko poliçe senaryoları (aşağıdaki 12 zorunlu senaryo)

Zorunlu anonim Kasko senaryo testleri:

1. Genel alan muafiyetsizken özel klozun koşullu muafiyet doğurması
2. Poliçeye uygun servis değişikliğinde durdurmanın (engelin) kalkması
3. Serviste kalındığında poliçe kaynaklı maliyet paylaşımının uygulanması
4. Genel ve koşullu muafiyetlerin birlikte değerlendirilmesi
5. Mini onarım mevcutken mobil onarımın durdurulmuş olması (iki kavramın ayrı modellenmesi)
6. Trafik değer kaybının zorunlu, Kasko değer kaybının ofis kuralı olması
7. Pert Kasko dosyasında değer kaybının "Uygulanamaz" olması (gerekçeli)
8. İhbar fişi, poliçe ve zeyil çelişkisinin gösterilmesi (sessiz çözüm yok)
9. KDV hariç iskontosuz liste bedeli ile gerçek satın alma bedelinin ayrılması
10. AI kaynak bulamadığında kesin karar vermemesi ("açık ve doğrulanabilir hüküm bulunamadı")
11. AI bütçesi dolduğunda temel uygulamanın çalışmaya devam etmesi
12. Yedek var görünürken geri yükleme doğrulamasının başarısız olması (yedek kanıtı ≠ dosya varlığı)

Gerçek müşteri poliçesi veya gerçek poliçe PDF'i fixture olamaz.

## Kritik yayın engelleyiciler

- Yanlış vakaya veri yazma
- Yanlış plakaya Excel yazma
- Klasör kaybı
- Kapanma ücretini yanlış kesinleştirme
- Değer Kaybı kural sürümü karışıklığı
- Muafiyetli dosyada tedarik veya mobil onarım engelinin atlanması
- Poliçe çelişkisinin kullanıcıya gösterilmeden sessizce çözülmesi
- Audit kaybı
- Yetkisiz erişim
- Yedekten dönememe
- Kritik butonun tek tıkla geri alınamaz işlem yapması

## Test raporu

Her geliştirme paketinde:

- Çalıştırılan komut
- Sonuç
- Başarısız test
- Manuel doğrulama
- Ekran boyutu
- Bilinen risk

raporlanır.
