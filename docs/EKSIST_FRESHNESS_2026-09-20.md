# Eksist klasör oluşturma ve OCR doğrulaması — 20 Eylül 2026

**Durum: PARTIAL. Kod ve kurulu pilot servis kontrolleri geçti. Gerçek masaüstü
kabulü tamamlanmadığından genel dağıtım ZIP'i ve dağıtım onayı yoktur.**

## Düzeltme

`case_not_fresh` kök nedeni, yeni klasör oluşturulmadan önce mevcut hedef ve
attest edilmiş içerik isteyen freshness kontrolünün çalıştırılmasıydı. Agent
artık yalnız workspace oluştururken `--operation workspace` gönderir. Gerçek
pCloud DB snapshot'ı ile yerel dosya sistemi birlikte denetlenir: yok/boş dizin
yapısı, yol çakışması, reparse point, conflict adı, büyük/küçük harf çakışması
ve ilgili bekleyen task/fstask/upload_tasks kontrolünden sonra oluşturulabilir.
Kesintide yarım kalmış boş yapı aynı planla tamamlanabilir. İçerik varsa mevcut
revision ve SHA-256 kontrolü sürer. Taşıma/silme freshness kuralı değişmedi.
Oluşturma izni, bulut senkronizasyonunun tamamlandığı iddiası değildir.

OCR'den I/İ harfinin doğrusu çıkarılamaz. Görsel ve taranmış PDF'de eksper adı
orijinal belgeyle karşılaştırılıp açıkça doğrulanır; düzeltme sonrası onay
sıfırlanır. API, kayıtlı kaynak yöntemini esas alır ve onaysız OCR kaydını
transaction ile geri alır. Ham metin/belge korunur; doğrulanan ad ve kullanıcı
kimliği ayrıca saklanır. Türkçe harf farkları hesap eşleştirmesinde korunur.
Metin kaynaklarına OCR düzeltmesi uygulanamaz. Önceki kayıtlar değiştirilmedi.

## Doğrulama

| Kontrol | Sonuç |
|---|---|
| Gerçek freshness aracı; yok/boş/yarım klasör, bulutta içerik, çakışma, task/fstask/upload, junction | 10/10 PASS |
| File Agent tüm testleri; gerçek CLI ve kayıp iş sonucu sonrası tekrar dahil | 98/98 PASS |
| PostgreSQL Eksist + workspace API; OCR reddi, rollback, I/İ kimlik ayrımı, kaynak koruma | 16/16 PASS |
| Oluşturma formu + Eksist UI; iki düğme, servis revizyonu, OCR onayı | 20/20 PASS |
| UI/API/agent entegrasyonu | 2/2 PASS; jsdom, gerçek masaüstü değildir |
| Toplam bağımsız otomatik test | 146/146 PASS; bu gruplarda atlanan yok |
| UI ve tüm workspace build'leri, typecheck | PASS |
| Lint | 0 hata; genel koşuda 12 uyarı |
| Kurulu servislerde metin, PNG, metin PDF, taranmış PDF | 4/4 PASS; dört `ready`, toplam 20 fiziksel alt klasör |
| Kurulu API'de OCR onaysız ret ve sentetik orijinale göre açık ad doğrulaması | PASS; orijinal bayt hash'leri aynı |
| Servis revizyonu ve yeniden okuma | Dört aktarımda PASS |
| Servis kesintisi/yeniden açılış, ilk commit yanıtının gerçek socket ile kaybı, kaynakların tekrar okunması | 3/3 PASS; tek case/source/plan ve fiziksel `ready` |
| Repo dışında kurulu API/agent import ve native bağımlılıklar | 2/2 PASS |
| Yedek → ayrı DB geri yükleme | 114 tablo, 49 migration ve depolama hash'leri aynı; tekrar migration sıfır |
| x64 NSIS adayı | PASS; 987 build dosyası paket/servis çıktısıyla eşleşti; imzasız |
| Gerçek masaüstü: pano/dosya seçici, iki kayıt düğmesi, servis revizyonu, kesinti sonrası UI tekrar | **NOT RUN / BLOCKED** |

Masaüstü `computer-use` başlatmasında gerçek hata: `Module not found: @oai/sky`.
Mevcut node_repl/computer-use dizinlerinde yüklenebilir paket bulunamadı.
Bu oturumda yeni bir otomatik onay reddi yaşanmadı; mevcut engel eksik çalışma
zamanı modülüdür. HTTP ve jsdom sonuçları masaüstü kabulü yerine geçirilmedi.

## Yerel çıktılar

- Pilot: `C:\HasarBotuPilot`; API `127.0.0.1:3141`, PostgreSQL `55441`.
- Agent/API/PostgreSQL servisleri çalışma sonunda çalışır; başlangıçları Manual.
- Gerçek pilot kökü: `D:\BaranGlobalStorage\_V2_EKSIST_PILOT_20260920`.
- Aday: `C:\HasarBotuPilot\desktop-build-freshness\HasarBotu-Setup-0.1.2.exe`.
- `C:\HasarBotuPilot\Open-Pilot.cmd` yeni adayı seçer; önceki adaylar korunur.
- Manuel kabul belgeleri: `C:\HasarBotuPilot\freshness-fixtures\manual`.
- Kanıtlar: `C:\HasarBotuPilot\evidence\freshness-*.json`.
- Test/deploy logları ve yeniden üretim betikleri:
  `.local/eksist-installed-pilot-20260920/freshness-*` (git dışında).
- DB testleri yalnız ayrı `hasarbotu_freshness_test` DB'sinde çalıştırıldı.

## Yedek ve geri dönüş

Bu yönerge yalnız sentetik pilot içindir; V1/üretim geçişi sayılmaz. Yeni migration
yoktur. Veritabanı ve belge içerikleri dağıtım paketine konmaz; sırlar `private`
dizininde kalır. Yedek, agent ve API durdurularak aynı kesim noktasında alındı:

`C:\HasarBotuPilot\backups\freshness-20260920`

`pilot.dump`, `storage`, önceki `freshness` araçları, `pilot-freshness.mjs` ve
`Open-Pilot.cmd` burada bulunur. Dump, `eksist_freshness_restore` DB'sine geri
yüklendi; tüm tablolar ve kaynak baytları karşılaştırıldı. Servis artifact
yedekleri kendi SHA-256 manifestleriyle aşağıdaki konumlardadır.

Geri dönüş gerekirse önce yeni yazıları durdurun, agent'ı sonra API'yi durdurun.
Sorunun kanıtını ve yedekten sonra oluşan kayıtları koruyun. Yönetici PowerShell'de
depo kökünden aşağıdaki komutları önce `-Apply` olmadan önizleyin; ardından
gerçek geri dönüş için `-Apply` ekleyin:

```powershell
Stop-Service hb-pilot-agent
Stop-Service hb-pilot-api
.\deploy\windows-service\deploy-service-artifacts.ps1 -TargetDir C:\HasarBotuPilot\services\api -ServiceLabel pilot-api -Rollback -RollbackBackupPath 'C:\ProgramData\HasarBotu\migration-preflight\pre-deploy-backups\pilot-api-20260920T162313325Z-bfce32b7'
.\deploy\windows-service\deploy-service-artifacts.ps1 -TargetDir C:\HasarBotuPilot\services\file-agent -ServiceLabel pilot-file-agent -Rollback -RollbackBackupPath 'C:\ProgramData\HasarBotu\migration-preflight\pre-deploy-backups\pilot-file-agent-20260920T162651243Z-7f8d38e1'
```

API, agent, freshness aracı ve masaüstünü aynı sürüm grubuna döndürün. Yedekteki
`freshness` dosyalarını mevcut `C:\HasarBotuPilot\freshness` içine, pilot adaptörü
`tools\pilot-freshness.mjs` konumuna ve `Open-Pilot.cmd` dosyasını pilot köküne
geri kopyalayın. Önceki kod OCR doğrulamasını zorunlu tutmaz ve yeni klasör engeli
geri gelir; geri dönüş sonrası yeni kayıt kabulünü açmadan bunu değerlendirin.

Kod geri dönüşü için DB'yi eski dump ile ezmek gerekmez. Veri geri dönüşü ayrıca
gerekirse dump'ı **yeni bir DB adıyla** restore edin; kaynak belge/plan/klasörleri
aynı kesim noktasıyla uzlaştırın. Sonradan oluşan klasörleri silmeyin veya pCloud
üzerinden körlemesine geri eşitlemeyin. `0049 down` belge verisini siler; geri
dönüş yöntemi değildir. Health, kaynak okuma ve depolama kontrolünden sonra
API'yi, sonra agent'ı yeniden başlatın.

## Dağıtım kapısı

Önce güncel adayda gerçek masaüstü kabulünü tamamlayın: metin/pano görseli ve iki
PDF türü, OCR ad düzeltme/onaysız ret, servis kalem penceresi, iki kayıt düğmesi,
kesinti/ilk yanıt kaybı sonrası tek kayıt ve fiziksel `ready`, uygulamayı yeniden
açınca kaynak okuma. Kanıtı `freshness-release-manifest.json` ile ilişkilendirin.
Ancak bunların tümü geçtiğinde kabul raporu ve hash manifestiyle son dağıtım
ZIP'ini üretin. Mevcut adayın derlenmesi kurulu masaüstü kabulü değildir.
