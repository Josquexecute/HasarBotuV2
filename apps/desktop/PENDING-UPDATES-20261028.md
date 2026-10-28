# Bekleyen güncellemeler — 28 Ekim 2026

## Güncel sonuç — 0.1.81 ofis teslimatı

**0.1.81 yayımlandı:** 28 Ekim 2026 03:48:56 Türkiye saati. Kullanıcının yeni talimatıyla önceki uzun kabul bekleme kararı değişti; mevcut başarılı kontroller ofis kabulüne yeterli sayıldı. Ticari dağıtım yapılmadı.

- **Dahil edilenler:** `21eb944` içindeki 0.1.80 sonrası tüm düzeltmeler korundu. Üç AI yanıt okuyucusu; PDF/OCR timeout/iptal kuyruğu; PDF/page/canvas ve gerçek Tesseract Worker temizliği; child süreç kapanışını bekleyen iş başına süreç yönetimi; bellek ölçümü/supervisor ve tanılama araçları; notice, codec yan kanıtları ve imzalı paketleme hazırlığı. API ve File Agent için 30 sunucu dosyası doğrulandı, değişen 20 dosya yedeklenerek uygulandı. Ortak sözleşme, bağımlılık sürümü ve migration değişmedi.
- **Uzun test:** mevcut SIGTERM dinleyicisi hedef süreç kimliği doğrulanarak çağrıldı; aktif batch boşaldı, orijinal finally temizliği çalıştı ve supervisor kapandı. Süre yaklaşık 7,77 saat; 64.586 iş, 1.017.221 sayfa, 323.814 bütünlük kontrolü. Orijinal sonuç `INTERRUPTED`, supervisor `FAIL`/çıkış 130 kaydı korundu. Bu kullanıcı kaynaklı durdurma 48 saatlik PASS veya uzun süreli kararlılık kanıtı değildir. Ön durdurma kopyaları, orijinal loglar ve hashli durdurma tutanağı korundu.
- **Doğrulama:** 109 API + 48 File Agent + 91 masaüstü/Windows + 23 yayın/paket testi = **271 PASS**. İlk masaüstü koşusundaki tek atlama, NSIS derleyicisi belirtilerek ayrı koşuda geçti. Ayrı isim filtresinin dışladığı testler yeniden atlanmış kabul edilmedi. Typecheck, lint, build, Windows x64 paketleme ve gerçek paket smoke geçti; 75 UI dosyası ve ofis profili eşleşti. Önceki kapsamlı denetim tekrarlanmadı.
- **Kurulum/güncelleme:** temiz Windows VM'de gerçek NSIS 0.1.80 kurulumu, 0.1.81'e yükseltme, gerçek uygulama açılışları, kaldırma ve 0.1.80'e geri dönüş geçti; sentetik profil işareti korundu. Gerçek Electron/Chromium API/login/oturum kalıcılığı ayrı testlerle doğrulandı. Gerçek kullanıcı hesabının NSIS yükseltmesi veya sentetik işaretin gerçek oturum olduğu iddia edilmedi. İlk VM doğrulama aracındaki PowerShell dizi önceliği hatası giderilip temiz test kurulumu yeniden çalıştırıldı; ürün kusuru değildi. İlk test komutu kök yolu ve kapalı yerel test PostgreSQL önkoşulu da giderildi; başarısız deneme kayıtları korundu.
- **Yayın kanıtı:** paket **113.001.074 bayt**, SHA-256 `f6fbf1bf7e75d48513019686078b7dc7a595e46c2a9a1f482ecef1c55fc4e272`. Kurulu 0.1.80 istemcisi `available` gördü; kimlikli manifest ve tam paket indirmesi HTTP 200, boyut ve hash birebir eşleşti. Ofis sunucusunda beş servis sağlıklı, 30 runtime dosyası eşleşiyor, kuyruklar boş ve yeni operasyon hatası yok. Geçici tanılama görevleri ve inspector temizlendi.
- **Koruma:** önceki 0.1.80 manifesti SHA-256 `4c8e86d740c79e087ede445a26f1eecd59b3ca8ed20bcc4b23149a081093cb44` ile yedeklendi; 0.1.80 ve 0.1.79 değişmez kurulumları tekrar hash ile doğrulandı. Kaynak dalı `release/office-0.1.81`, yayın etiketi `office/0.1.81`. Önceki koruma etiketi, inceleme dalları ve tam Git yedeği korundu. Ana dalın geniş otomatik taslak yayın akışı tetiklenmedi.
- **Veri ve ortam:** üretim verisi/migration müdahalesi ve zorla istemci kurulumu yok. Dosya değişimi sırasında salt okunur veri sayımları korundu, servisler/görevler eski çalışma durumuna döndü. VM temiz snapshot'a ve kapalı duruma döndürüldü; yalnız bu doğrulama için açılan ayrı `_test` PostgreSQL kümesi kapatıldı.
- **Kalanlar:** 48 saatlik kararlılık kanıtı yok. Ticari müşteri kabulü, güvenilir imzalama ve codec kaynak/build/relink teslim kanıtları önceki durumunda; iki üretim klasörü kimlik kararı uygulanmadı. Bunlar tamamlanan ofis teslimatıyla karıştırılmadı. Kullanıcılar güncellemeyi kendi kontrolleriyle kurabilir; zorunlu sabah işlemi yok.

Kanıtlar: `.local/office-0.1.81-20261028/` içinde `validation-proof.json`, `vm-result.json`, `soak-stop-result.json`, `backend-deployment-proof.json`, `publication-proof.json`, `client-final-proof.json`, `final-office-proof.json`, `local-cleanup.json` ve `release-result.json`. Orijinal OCR/PDF sonuçları `.local/ocr-memory-20261027/soak-48h-process/` altında kaldı. Aşağıdaki bölümler önceki incelemenin tarihsel kaydıdır; güncel yayın kararını yukarıdaki sonuç belirler.

## Önceki inceleme — 28 Ekim 00:15

Durum: inceleme ve güvenli ayrıştırma tamamlandı; yeni yayın ertelendi. Ofis sürümü **0.1.80** korundu. OCR/PDF uzun kabulü **RUNNING**; ticari dağıtım yapılmadı.

## Korunan değişiklikler

- Yayın kanıtıyla eşleştirilen temel: `9c83ccdd802afda776791efdae4e8f02828ba11e` (0.1.80). Sonraki 48 dosyalık değişiklik: `21eb94459f7c0c82cfaaa7893530f49c4cfa3235`. İnceleme başlangıcında çalışma ağacı temizdi; uzak `main` aynı commit'i gösterdi. Karşılaştırılan değişiklikler eksiksiz mevcut; daha önce Git'e hiç kaydedilmemiş çalışmalar hakkında bir iddiada bulunulmadı.
- Kaynak commit'i `safety/post-0.1.80-20261028` etiketiyle korundu. Tam geçmişli Git yedeği oluşturulup `git bundle verify` ile doğrulandı: `.local/pending-updates-20261028/source-safeguard.bundle`, 18.421.868 bayt, SHA-256 `ba4d5478a9801c6398edf7424894448b18853c4e6fbc8d25e2b4f03c019c73bc`.
- Rapor dalı: `review/pending-updates-20261028`. Bağımsız API düzeltme dalı: `review/api-stream-cleanup-20261028`, commit `a06ca16`. Ana dalın otomatik yayın taslağı iş akışını tetiklememek için bu çalışma inceleme dallarında tutuldu.
- Önceki başarısız OCR/PDF koşuları ve yerel kanıtlar korundu. Canlı testin kaynakları, derlenmiş dosyaları, bağımlılıkları ve kabul eşikleri değiştirilmedi.

## Bekleyen düzeltmeler ve ayrıştırma sonucu

| Kapsam | Mevcut değişiklik | Doğrulama ve yayın durumu |
|---|---|---|
| Gemini poliçe, Gemini e-posta, OpenAI poliçe | Yanıt okuyucusunun başarı, bozuk/büyük yanıt ve bağlantı hatasında kilidini bırakması | Üç üretim dosyası ve regresyon testi 0.1.80 temelinden bağımsız dala ayrıldı. 32 test, typecheck ve ayrı API derlemesi geçti. Backend teslimatı bekler; masaüstü kurulumu bu düzeltmeleri sunucuya taşımaz. |
| PDF/OCR yükleme kuyruğu | Timeout/iptal sonrasında sıradaki heartbeat/chunk gönderimlerinin başlamaması | Extractor testleri geçti; aynı dosyalardaki süreç değişikliklerinden ayrı bir yayın adayı çıkarılmadı. Uzun kabul bekleniyor. |
| PDF/Tesseract kaynak ömrü | Temizlikten sonra terminal mesajı, PDF hata yollarında destroy/cleanup, gerçek iç Worker kapanışının beklenmesi | Lifecycle regresyonları geçti; uzun kabul bekleniyor. |
| OCR/PDF süreç sınırı | İş başına child süreç, aynı Worker/V8 sınırları, child close sonrası sonuç ve geçici dosya temizliği, parent IPC kopunca sahiplenilmiş child'ın kapanması | Extractor/lifecycle/process toplam 37 test geçti. Mevcut 48 saatlik kabul bitmeden yayımlanamaz. |
| Kabul ve tanılama araçları | Süreç ağacı belleği, eş fazlı loaded/idle karşılaştırma, değişmeyen bütçeler, fingerprint ve kalıcı loglu supervisor; Worker bellek deney araçları | Hedefli araç testleri geçti. Deneyler ve kısa koşular 48 saatlik kabul yerine sayılmadı. |
| Lisans/paket ve imzalama hazırlığı | Codec/native notice ve yan kanıtlarının npm paketine dahil edilmesi; kaynak inceleme araçları; ayrı imzalı paketleme yapılandırması | Gerçek npm paket içeriği dahil araç/paket testleri geçti. İmzalama yapılmadı; ticari dağıtım kabulü tamamlanmış sayılmadı. |
| Diğer test araçları | Salt okunur klasör kimliği planlayıcısı, sentetik dış kesinti testleri, klasör/tracking regresyonları; ortak test DB şemasını sıfırlayan test dosyalarının sırayla çalışması | Üretim verisi üzerinde uygulama yapılmadı. Bu incelemede DB entegrasyon testleri ve tam yayın kapısı çalıştırılmadı. |

`src/`, `public/`, `apps/desktop/src/`, ortak paketler, migration'lar ve `package-lock.json` için temel ile kaynak commit'i arasında fark yok. Masaüstü paketindeki yeni komut yalnız imzalı paketleme hazırlığıdır; yeni kullanıcı davranışı sağlamaz. Tüm 48 dosyanın listesi ve dört dosyalık bağımsız API patch hash'i `.local/pending-updates-20261028/scope.json` içinde saklandı.

## Bu oturumdaki doğrulamalar

- Node.js **24.22.0** ile 32 bağımsız API + 37 File Agent + 17 araç/paket testi: **86 PASS, 0 FAIL, 0 atlama**.
- Yeni API testleri eski üç provider üzerinde çalıştırılınca **12 beklenen FAIL** oluştu; diğer üç test isim filtresiyle dışarıda bırakıldı. Düzeltilmiş kaynaklar geri konup `21eb944` ile birebir eşleştiği doğrulandı. Bu negatif kontrol, başarılı 86 testten ayrı tutuldu.
- Güncel API/File Agent `tsc --noEmit` ve değişen TypeScript dosyalarında ESLint geçti.
- Ayrı worktree'de 0.1.80 File Agent ve bağımsız API derlendi; ayrı API typecheck geçti. İlk ayrı typecheck'teki eksik `file-agent/dist/field-photo-worker.js`, bu worktree'nin kendi derlemesiyle giderildi. Canlı testin `dist/` dizinine yazılmadı.
- Tam sistem denetimi, DB entegrasyonları, tam yayın kapısı ve yeni NSIS build/smoke bu oturumda yapılmadı. Yeni sürüm yayınlama koşulları sağlanmış olarak raporlanmadı.

## 48 saatlik OCR/PDF testi

- Başlangıç: **27 Ekim 2026 19:49:17 Türkiye saati**. Beklenen bitiş: **29 Ekim 2026 19:49:17 Türkiye saati** (`2026-10-29T16:49:17.451Z`).
- 28 Ekim 00:15:47 kontrolünde supervisor PID **3348**, test PID **23744** çalışıyordu; ilk başlatan üst süreç artık yoktu. Koşu bu sohbetin/komut oturumunun açık kalmasına bağlı değil. Yeniden başlatılmadı, kesilmedi.
- Kaydedilmiş kontrol noktası: yaklaşık **4,44 saat**, **35.922 iş**, **565.763 sayfa**, **180.132 bütünlük kontrolü**. Başlangıçtaki dokuz beklenen hata senaryosu ayrı sayaçta; son iki toparlanma kontrolü ve nihai kabul henüz çalışmadı.
- Süreç ağacı muhafazakâr RSS tepesi **889,68 MiB**; bütçe 4 GiB. RSS/private commit artış bütçeleri 128 MiB olarak kaldı. Bu ara ölçüm PASS veya sızıntı yokluğu kanıtı değildir.
- Supervisor'ın kaydettiği **17 fingerprint eşleşti**, drift yok. İlk/son inceleme kontrolü arasında 432 yeni iş tamamlandı; `result.json`, `stdout.log`, `stderr.log` büyüdü ve diskte güncellendi. `receipt.json` başlangıç kaydıdır; tamamlanınca supervisor terminal durumunu yazar.
- Kalıcı canlı kayıtlar: `.local/ocr-memory-20261027/soak-48h-process/{receipt.json,result.json,stdout.log,stderr.log}`. İnceleme anlık kayıtları: `.local/pending-updates-20261028/soak-{initial,final}.json`.
- AC otomatik uyku süresi 0; ayar değiştirilmedi. C: üzerinde kontrol anında yaklaşık 95,4 GiB boş alan vardı.

## Ofis ve ticari dağıtım kararı

**Ofis:** sunucuda salt okunur SSH denetimiyle manifest sürümü **0.1.80**, paket **113.000.938 bayt**, SHA-256 `2652b3d54dde10ca2c69b9f851938cf4809612cb7325c2b0853e4887b15f41e1` doğrulandı. Manifest hash'i `4c8e86d740c79e087ede445a26f1eecd59b3ca8ed20bcc4b23149a081093cb44`; önceki 0.1.79 değişmez paketi de mevcut. Feed'e veya kurulu istemcilere yazılmadı. Önceki 0.1.80 yayınındaki eski istemci/kimlikli indirme kanıtı korundu; bu oturumda yeni HTTP indirme veya yeni istemci kabulü yapıldığı iddia edilmedi.

Yeni ofis yayını yapılmadı: bekleyen farkta yeni masaüstü çalışma kodu yok; bağımsız API düzeltmesi sunucu dağıtımı gerektiriyor, OCR/PDF değişikliklerinin 48 saatlik kabulü bitmedi. Sırf sürüm artırmak bu düzeltmeleri ofise teslim etmez. İmzalama/ticari kabul eksikleri, mevcut ofis kanalını durdurma gerekçesi olarak kullanılmadı. Sonraki gerçek ofis adayı için AGENTS.md'deki sürüm artışı, doğrulama, x64 NSIS/smoke, önceki manifest/paketin korunması, eski kurulu istemcinin `available` görmesi ve kimlikli tam boyut/SHA-256 indirme koşulları devam eder. Uzun test geçtikten sonra teslim kapsamının kalan yayın kontrolleri tamamlanmalıdır.

**Ticari müşteri:** bu görevde dağıtım yetkisi yok. Depodaki kabul kayıtlarına göre müşteriye özel profil/gerçek müşteri-WAN kabulü, güvenilir imzalama kimliği/timestamp kanıtı, codec kaynak/build/relink teslim kanıtlarının kapanması ve uzun kabul sonucu bekliyor. Daha önceki temiz VM kurulumu bu koşulların yerine sayılmadı. İki üretim klasörü kimlik çakışması operatör kararında kaldı; kayıt birleştirme, silme veya yeniden eşleme yapılmadı.

## Sabah yapılacaklar ve durma noktası

1. Zorunlu yayın/kurulum işlemi yok. Test bitişi 29 Ekim akşamı; makineyi açık tutup kalıcı `receipt.json` / `result.json` üzerinden durumu takip et. Henüz tamamlanmış kabul bekleme.
2. İleride API düzeltmesi teslim edilecekse `review/api-stream-cleanup-20261028` dalını kullan; dar backend teslimatı ve ilgili yayın kapısı ayrıca tamamlanmalı. Canlı test kaynaklarını yeniden derleme veya değiştirme.
3. Üretim klasörü kimlik kararları ve ticari müşteri profili/imzalama/kaynak teslimi girdileri kullanıcıya ait sonraki işlerdir. Bu incelemede uygulanmadı.

Güvenli bağımsız ayrıştırma, hedefli doğrulama, Git koruması ve raporlama tamamlandı. Kalan işler bitmemiş uzun kabul veya ayrı üretim/müşteri önkoşullarına bağlı olduğundan ek dağıtım yapılmadan duruldu. Üretim verisi değişikliği, migration, üretim servis restart'ı, zorla istemci kurulumu ve ticari dağıtım: **0**.

Makinece okunur sonuç ve kanıt hashleri: `.local/pending-updates-20261028/review-result.json`. Ham test logları/JSON'ları ve bağımsız API patch'i aynı dizinde saklandı. Bu rapor zaman damgalı bir inceleme sonucudur; canlı koşunun sonraki terminal durumu kendi kalıcı kayıtlarında bulunur.
