# Eksist pilot doğrulaması ve devreye alma hazırlığı

> Bu bilgisayarda sonradan hazırlanan izole V2 servisleri, gerçek pCloud eşlemesi,
> kurulu OCR/HTTP kontrolleri ve açık freshness/UI engelleri için
> [yerel pilot devam raporuna](EKSIST_PILOT_LOCAL_2026-09-20.md) bakın.
> Aşağıdaki rapor önceki denetimin tarihsel sonucudur.

20 Eylül 2026 · Kaynak commit: `8ad31b076bf4847af7d3dd135c10f22a33b1340f`

**Sonuç: PARTIAL. Kurulu ortam pilotu ve dağıtım kapısı BLOCKED.**

## Ortam bulguları

- Kurulu uygulama: `C:\Program Files\HasarBotu - Baran Ekspertiz`, paket kimliği `hasarbotu-baran-ekspertiz`, sürüm `0.6.10`. Kimlik `resources/app.asar` içindeki `package.json` üzerinden okundu. Bu, depodaki `@hasarbotu/desktop 0.1.2` V2 paketi değildir.
- Windows servis envanterinde HasarBotu API/File Agent veya PostgreSQL servisi bulunmadı. Process/User/Machine kapsamlarında incelenen V2 veritabanı, agent kimliği ve depolama kökü değişkenleri tanımlı değil.
- Kullanıcı pCloud'u açtığını, **bu bilgisayarda sync kurulmadığını** bildirdi. Çalışan pCloud uygulaması, File Agent'ın servis hesabından erişilebilir ve güncel yerel kök bulunduğunu kanıtlamaz.
- Yerelde yalnız `.local/postgres/data` geliştirme/test kümesi bulundu. Veritabanları: `hasarbotu_removal_test` (0048), `hasarbotu_eksist_test` (0049). Üretim veritabanı erişimi bulunmadı.
- Varsayılan Node `22.23.2`; proje `>=24 <25` istiyor. Bu çalışmadaki build/test/OCR kontrolleri mevcut yerel `24.21.0` ile çalıştırıldı.
- Masaüstü otomasyonu ayrıca `@oai/sky` modülü bulunamadığı için başlatılamadı. Gerçek paket arayüzünde işlem yapılmadı.

## Tamamlanan doğrulamalar

| Kontrol | Sonuç | Kanıtın sınırı |
|---|---|---|
| Mevcut yerel kümenin soğuk kopyası | PASS; 3.102 dosya, sıfır SHA-256 farkı | Üretim yedeği değildir |
| İzole kopyanın açılması | PASS; ayrı veri dizini, `127.0.0.1:55440` | Kaynak küme başlatılmadı |
| 0048 → 0049 | PASS | Mevcut yerel test veritabanının kopyası |
| Önceki tabloların korunması | PASS | Tüm önceki public tabloların satır sayıları ve sıralanmış içerik hash'leri aynı |
| İkinci `up`, dört indeks, `down`, yeniden `up` | PASS | Yalnız izole test kopyası |
| Tekrarlı referans/içerik, geçersiz tür, null uyumsuzluğu, eksik dosya/kullanıcı, başka organizasyonun dosyası | PASS | PostgreSQL kısıtları; toplam 12 migration kontrolü |
| Derlenmiş API/File Agent girişleri ve yerel OCR bağımlılıkları | PASS | Depo bağımlılıkları; kurulu servis hesabı/paketi değildir |
| Derlenmiş worker ile görsel OCR, metin PDF, taranmış PDF OCR | PASS | Toplam 5 runtime kontrolü; ham belge içeriği rapora yazılmadı |
| Eksist API regresyonları | 8/8 PASS | Ayrı, yeni `hasarbotu_pilot_regression_test`; kaynak DB sıfırlanmadı |
| Eksist UI regresyonları ve API/File Agent entegrasyonu | 9/9 PASS | jsdom, API inject, geçici klasör ve test freshness fixture; gerçek masaüstü değildir |
| Eksist domain regresyonları | 3/3 PASS | Son koşularda atlanan test yok |
| `npm run build` | PASS | UI ve tüm workspace derlemeleri; installer üretilmedi |
| Runtime bağımlılık kapanışı | PASS | API: 127 harici + 3 workspace; agent: 20 harici + 2 workspace; kurulu artifact doğrulaması değildir |
| Kaynak kümenin çalışma sonu kontrolü | PASS | 3.102 dosyanın tamamı değişmeden kaldı; izole sunucu durduruldu |

Yerel kanıt dizini: `.local/eksist-pilot-20260920/` (git dışında).
`pilot-evidence.json`, `migration-results.json`, `runtime-results.json`,
`source-cold-copy-sha256.json`, `api-closure.json`, `file-agent-closure.json`,
`build.log`, `api-tests.log`, `ui-tests.log`, `domain-tests.log` ve kullanılan
`migration-check.mjs` / `runtime-check.mjs` burada tutulur. İlk DB değişkensiz UI
keşif koşusundaki atlamalar, son DB bağlantılı `ui-tests.log` koşusunda giderildi.

## Kurulu uygulamada tamamlanması gereken pilot

Bu satırların tamamı **NOT RUN / BLOCKED** durumundadır. Otomatik testler bu
satırları geçmiş saydırmaz. Gerçek Eksist hesabına gerek yoktur; ayrı pilot
organizasyonu ve kişisel veri içermeyen örnekler kullanılabilir.

| Senaryo | Kabul ölçütü |
|---|---|
| Üretim DB yedeğinin izole geri yüklemesi + 0049 | Önceki veri/şema ve migration sırası doğrulanır; ileri geçiş ve yedekten geri yükleme başarılıdır |
| Kurulu API/File Agent OCR ve depolama erişimi | Dağıtımın kendi bağımlılıklarıyla OCR çalışır; servis hesabında klasör oluşturma/okuma/yazma/silme, root health ve gerçek freshness denetimi geçer |
| Metin yapıştırma | Referans, tür, plaka ve ihbar tarihi kullanıcı tarafından doğrulanır; kaynak detayda okunur |
| Görsel aktarımı | Yükleme ve sunulan pano yolu denenir; yerel OCR sonucu ve orijinal kaynak görüntülenir |
| PDF aktarımı | Metin PDF ve taranmış PDF denenir; gerekli sayfalarda OCR kullanılır |
| Kaydet ve detayını aç | Fiziksel klasör doğrulanıp `ready` olduktan sonra doğru detay açılır |
| Kaydet ve kapat | `ready` sonrası modal kapanır; hasar dosyasının lifecycle durumu `open` kalır |
| Bağlantı kesintisi ve yeniden deneme | İzole pilot API/agent bağlantısı kesilir; UI bekleme/hata durumunu gösterir; bağlantı gelince aynı işlem tekrar denenir; tek dosya/kaynak/plan/klasör oluşur |
| Kaydetme yanıtının kaybolması | Sunucuda kayıt tamamlandıktan sonra yanıt kaybı denenir; yeniden deneme ikinci kayıt oluşturmaz |

Her başarılı kayıt için UI sonucu, DB dosya/kaynak/iş kimlikleri, agent `ready`
sonucu ve fiziksel klasör birlikte doğrulanmalı; uygulama yeniden açıldığında
kayıt ve kaynak okunmalıdır. Sadece düğmenin çalışması yeterli değildir.

## Yedekleme, paketleme ve geri dönüş sırası

1. **Önce kurulum hedefini tamamla:** V2 API/File Agent, uygun PostgreSQL ve Node
   24, erişilebilir yerel depolama kökü, servis hesabı ve gerçek freshness
   yapılandırması gerekir. pCloud sync kökü/eşlemesi mevcut veri ve hedef
   karşılaştırıldıktan sonra belirlenmeli. Bu çalışma sync oluşturmadı, pCloud
   ayarlarını veya mevcut kurulu uygulamayı değiştirmedi.
2. **Pilot kapısını kapat:** Yukarıdaki matrisi kurulu V2 paketinde tamamla.
   Testlerdeki `always-ready-freshness-gate.mjs` üretimde kullanılmaz. Gerçek
   üretim kopyasında şema sıfırlayan test paketi çalıştırılmaz.
3. **Yedek al:** Bakım penceresinde yeni yazıları durdur, agent işlerini güvenli
   sınırda bitir/durdur; API ve agent'ın önceki artifact, sürüm, servis kimliği
   ve yapılandırmalarını kaydet. PostgreSQL sürümüyle uyumlu `pg_dump` custom
   format yedeğini ve gerekli rol/yetki bilgisini al. Depolama ağacının aynı
   kesim noktasına ait yedeğini, bekleyen işleri ve pCloud/freshness durumunu
   kaydet. Sırlar ayrı korumalı depoda kalır; dağıtım ZIP'ine konmaz.
4. **Geri yüklemeyi prova et:** DB yedeğini ayrı ad/portta geri yükle; migration
   seviyesi, satır sayıları, kaynak belge hash'leri ve dosya bağlantılarını
   doğrula. Artifact ve klasör yedeklerinin SHA-256 manifestlerini kontrol et.
   Bu bilgisayardaki test kümesi kopyası, bu üretim provası yerine geçmez.
5. **Paket içeriğini doğrula:** Windows x64 masaüstü installer + UI, API ve
   File Agent derlemeleri, kilitli runtime bağımlılıkları, OCR worker JS,
   Tesseract WASM/core ve Türkçe dil verisi, native canvas, PDF desteği ve
   `packages/database/migrations/` (0049 dahil) bulunmalı. API kapanışının
   bildirdiği değer kaybı referans snapshot'ı da gerçek dağıtım yoluna göre
   sağlanmalı. `deploy-service-artifacts.ps1` workspace paketlerinde yalnız
   `dist` + `package.json` kopyalar; **migration dizini ayrıca paketlenmeli**.
   Repo, kullanıcı belgesi, DB yedeği veya secret pakete dahil edilmez.
6. **Artifact doğrulaması:** `resolve-runtime-dependency-closure.mjs`,
   `provision-extra-data-references.ps1` ve `deploy-service-artifacts.ps1`
   araçlarının planlarını gerçek hedeflere karşı kontrol et. Ardından
   repo bağımlılıklarına erişemeyen konumda `smoke-test-deployed-service.mjs`
   ve gerçek OCR çalıştır; kurulu kullanıcı/servis kimliğiyle pilotu tekrarla.
   Paket manifestinde commit, runtime/uygulama sürümleri, migration seviyesi,
   dosya SHA-256'ları ve kabul raporu bulunmalı.
7. **Devreye alma:** Doğrulanmış yedekten sonra 0049'u uygula; uyumlu API,
   agent ve desktop artifact'larını devreye al. Health, yetkiler, root health,
   freshness ve bir uçtan uca kayıt geçmeden genel kullanımı açma.
8. **Geri dönüş:** Sorunda yazıları ve agent'ı durdur, hata kanıtlarını koru.
   Önceki artifact'ları doğrulanmış manifest/yedekten geri getir
   (`deploy-service-artifacts.ps1 -Rollback -RollbackBackupPath ...` mevcut
   araçtır; gerçek hedefler belirlenmeden çalıştırılmaz). DB geri dönüşü
   gerekiyorsa kanıtlanmış yedeği geri yükle; sonradan oluşan kayıt/klasörleri
   kesim noktasıyla uzlaştır. Klasörleri topluca silme, pCloud ile eski veriyi
   körlemesine eşitleme. **0049 `down`, `eksist_sources` tablosunu ve belgeleri
   siler; üretimde veri koruyan rollback değildir.** DB/klasör/artifact
   tutarlılığı ve eski akış smoke kontrolü sonrası yazıları yeniden aç.

**Dağıtım paketi hazırlanmadı ve üretime çıkış yapılmadı.** Bunun nedeni
kurulu ortam, sync/servis hesabı erişimi, üretim kopyası ve gerçek arayüz
kabul ölçütlerinin henüz doğrulanmamış olmasıdır.
