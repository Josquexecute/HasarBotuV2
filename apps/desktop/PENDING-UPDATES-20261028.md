# Bekleyen güncellemeler — 28 Ekim 2026

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
