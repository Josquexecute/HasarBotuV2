# Statik inceleme — 27.09.2026

Kapsam: arayüz, API, File Agent, Electron, ortak domain/sözleşmeler, veritabanı migration'ları ve dağıtım yapılandırmalarında genel tarama; kritik akışlarda kaynak ve tüketici kodunun birlikte incelenmesi. Üretilmiş dosyalar ve bağımlılıklar uygulama kaynağı kapsamına alınmadı. Her satırın incelendiği veya bütün hataların bulunduğu iddiası değildir.

Uygulama kodu değiştirilmedi. Aşağıdakiler kaynak kodunda belirlenen hata mekanizmalarıdır; gerçek ortamda yeniden üretim yapılmadı.

## Öncelikli bulgular

| # | Öncelik | Sorun ve etkisi | Çözüm |
|---|---|---|---|
| 1 | P1 | **HTTPS API bağlantısı çalışmaz.** Masaüstü config HTTPS kabul ediyor; köprü bütün isteklerde `node:http.request` kullanıyor. HTTPS origin ile ilk API isteği protokol hatasına düşer. | Protokole göre `node:https.request` / `node:http.request` seçimi; sertifika doğrulamasını koru. |
| 2 | P1 | **Köprü hataları süreci düşürebilir.** HTTP handler içindeki async işlem yakalanmadan bırakılıyor; statik dosya okuma akışında da `error` dinleyicisi yok. Dosyanın kontrol sonrası silinmesi/okunamaması veya senkron proxy hatası kontrollü yanıta çevrilmiyor. | Handler için hata sınırı; dosya ve proxy akışlarında hata/erken kapanma yönetimi; başlık gönderildiyse bağlantıyı sonlandır, aksi halde uygun hata yanıtı ver. |
| 3 | P1 | **Agent iş sahipliğini kaybetse de dosyaya müdahaleyi sürdürüyor.** Heartbeat 409 için `false` döndürüyor; çağıranlar bunu yok sayıyor. Periyodik heartbeat hataları da yutuluyor. Süresi dolan iş başka agent tarafından alınabiliyor. Ayrıca heartbeat aralığı yerel `leaseSeconds` değerinden hesaplanırken API sabit 120 saniye kullanıyor; örneğin yerel 600 saniye ilk heartbeat'i 200 saniyeye erteler. | Süreyi sunucunun `leaseExpiresAt` bilgisinden türet; kayıp sahiplikte yeni yan etkileri durdur; yürütücüye iptal ve iş sahipliği doğrulaması taşı. Sonuç kabul edilene kadar süreyi koru. |
| 4 | P1 | **Eksik kaynak, yanlış hedefin doğrulanmasına dönüşebilir.** Atomik taşıma kurtarmasında kaynak yok ve hedef klasör varsa hedefin manifest'i tek başına başarı sayılıyor. Önceden kaydedilmiş kaynak manifest'i/işlem kanıtı ile eşleşme aranmıyor. Kaynak başka yere taşınmış ve hedef ilgisiz içerikle oluşmuşsa yanlış klasör dosyaya bağlanabilir. | Taşımadan önce kaynak manifest'ini ve işlem kimliğini kalıcı kaydet; kurtarmada eşleştir. Kanıt yoksa manuel kurtarma durumunda dur. |
| 5 | P1 | **Kapanmış dosyaya araç bilgisi yazılabilir.** Araç profili ve sahipleri kaydında kapanış kontrolü transaction/kritik kilitten önce yapılıyor. Kontrol ile yazım arasında dosya kapanırsa eski açık durumla kayıt devam eder. | Aynı transaction içinde önce `cases` satırını `FOR UPDATE` ile kilitle, kapanış durumunu tekrar denetle; kapanış akışıyla kilit sırasını tutarlı tut. |
| 6 | P1 | **PostgreSQL kesintisi API'yi düşürebilir.** Üretim havuzunda `error` dinleyicisi yok. Kurulu `pg-pool`, boşta bekleyen bağlantı hatasını havuz üzerinden `error` olarak yayıyor; karşılanmayan olay süreç hatasına dönüşür. | Havuz oluşturulurken güvenli loglama yapan `error` dinleyicisi bağla; bozuk bağlantının havuz tarafından çıkarılmasını ve sağlık durumunun bozulmasını koru. |
| 7 | P2 | **Yeniden açılışta taslak ve ayarlar kaybolmuş görünür.** Köprü varsayılan olarak rastgele port seçiyor; `localStorage` origin'e bağlı. Yeni port, hızlı not taslağı/idempotency anahtarı ve görünüm ayarlarının eski depolamasını erişilemez kılıyor. Yanıtı kaybolmuş not yeni anahtarla tekrar yazılırsa mükerrer kayıt riski de doğar. | Origin'den bağımsız, dar kapsamlı güvenli IPC üzerinden kullanıcı/veri kaynağı bazlı kalıcı depolama kullan; alternatif olarak port çakışmasını yöneten kararlı origin tasarla. |
| 8 | P2 | **Uzun Eksist OCR işlemi masaüstünde erken kesiliyor.** OCR için 90 saniye tanınmışken köprü 30 saniyelik hareketsizlik zaman aşımı uyguluyor. 30–90 saniyede tamamlanan işlem kullanıcıya 504 verir; sunucu sonrasında kaynağı kaydedebilir. | Tercihen işi kuyruğa alıp kimlikle durumunu sorgulat. Daha küçük değişiklik olarak ilgili uç için sınırlı ve OCR süresiyle uyumlu timeout ile tekrar gönderim kimliği sağla. |
| 9 | P2 | **İlk araç bilgisi kaydında yarış 500 üretiyor.** Profil/sahip kümesi henüz yokken `SELECT ... FOR UPDATE` kilitleyecek satır bulamıyor. İki ilk kayıt aynı anda INSERT'e ulaşabilir; unique ihlali uygulama düzeyinde 409'a çevrilmiyor. | #5'teki mevcut dosya satırı kilidiyle ilk oluşturmayı da sırala; bekleyen istek sürüm uyuşmazlığında 409 alsın. |
| 10 | P2 | **Yerel depolama yazma hatası arayüzü bozabilir.** `usePersistentState` okuma hatasını karşılıyor, fakat effect içindeki `localStorage.setItem` hatasını karşılamıyor. Depolama kapalı/dolu olduğunda uygulama üst seviyesinde yakalanmamış hata oluşabilir. Saklanan JSON'un tipi de doğrulanmıyor. | Yazmayı kontrollü yakala, bellekte çalışmayı sürdür ve kalıcılık sorununu bildir; tema/yoğunluk/boolean değerlerini yüklerken doğrula. |

P1: önce giderilmeli. P2: normal kullanımda veya belirtilen koşulda işlev kaybı.

## Kaynak noktaları

1. `packages/desktop-bridge/src/bridge.ts:111`; `apps/desktop/src/main/config.ts:57`.
2. `packages/desktop-bridge/src/bridge.ts:159,194`.
3. `services/file-agent/src/agent.ts:48,88,113`; `services/file-agent/src/api-client.ts:65`; `services/api/src/agent/store.ts:32,183`; `services/api/src/agent/routes.ts:58`.
4. `services/file-agent/src/file-operation-executor.ts:333`; `packages/contracts/src/v1/agent/dto.ts:83`; `services/api/src/agent/store.ts:1102`.
5. `services/api/src/case-vehicle-owners/store.ts:108,120`; `services/api/src/case-vehicle-profile/store.ts:139,159`.
6. `packages/database/src/pool.ts:22`; `services/api/src/server.ts:76`; kurulu bağımlılık `node_modules/pg-pool/index.js:52`.
7. `apps/desktop/src/main/config.ts:73`; `packages/desktop-bridge/src/bridge.ts:198`; `src/components/TouchAssistant.tsx:14,39`; `src/app/usePersistentState.ts:6`.
8. `packages/desktop-bridge/src/bridge.ts:50,130`; `services/api/src/eksist/extract.ts:23`; `services/api/src/eksist/routes.ts:43`.
9. `services/api/src/case-vehicle-owners/store.ts:122,142`; `services/api/src/case-vehicle-profile/store.ts:160,177`; `services/api/src/errors/error-handler.ts:15`.
10. `src/app/usePersistentState.ts:7,14`.

## Kontroller ve kullanıcıya bırakılan doğrulama

- `npm run typecheck`: geçti; tanımlı komut ortak paketleri de derledi.
- `npm run lint`: 0 hata, 12 uyarı. 11'i kullanılmayan eslint-disable yorumu; diğeri projede açıkça istisna tanımlanmış sayfalama effect'i. Bunlar yukarıdaki işlevsel hatalarla eşdeğer sayılmadı.
- Gerçek test, veritabanı işlemi, servis başlatma/yeniden başlatma ve paketleme yapılmadı. Tam uygulama/release build'i çalıştırılmadı.
- Kullanıcı doğrulaması: HTTPS ile giriş; okuma sırasında kaybolan statik dosya; iki agent ile lease kaybı; kaynak yok/ilgisiz hedef kurtarması; kapanışla eşzamanlı araç kaydı; PostgreSQL kesintisi; uygulamayı kapatıp taslağı geri açma; 30 saniyeyi aşan OCR; eşzamanlı ilk araç kaydı; depolama yazma hatası.

Durum: **PARTIAL — statik inceleme raporu hazır; düzeltmeler uygulanmadı, çalışma zamanı doğrulaması kullanıcıda.**
