# Masaüstü güncelleme düzeltmesi — 16 Ekim 2026

**PASS:** Bu bilgisayardaki 0.1.16 kurulumu, doğrulanmış yerel **0.1.28** paketiyle güncellendi ve normal olarak yeniden açıldı. Mevcut oturum HTTP 200 döndürdü; ofis API bağlantısı, kullanıcı profili ve kaydedilmiş yardımcı pencere konumu korundu.

## Bulgu ve değişiklik

Kurulum komutu, seçili sürümü sunucuda yeniden doğrularken ekranı `available` durumunda bırakıyordu. Bu süre boyunca düğme etkin kalıyor ve yapılan işlem görünmüyordu. Yeni regresyon testi önce bu nedenle başarısız oldu.

`updates.ts`, tıklama anında `checking` durumunu yayımlar. Seçili sürüm ayrı bir değişkende korunur; sunucu yanıtını beklerken tekrar tıklama ikinci indirme veya kurulum başlatmaz. Ardından mevcut indirme, boyut/hash/sürüm doğrulama ve Windows kurulum akışı çalışır.

Gerçek ofis API'sinden 0.1.27 paketinin **102.681.486 baytı** indirildi ve SHA-256 değeri `2bf4cc1deff5f85e2e39e190ff2350ba33903aa772d2f931f60493c529bbcb77` ile eşleşti. Bu nedenle tek başına 0 baytlık geçici dosya, sunucu dosyasının bozuk olduğunun kanıtı olarak değerlendirilmedi.

Eski uygulamanın normal kapanma isteği bütün Chromium süreçlerini bitirmedi. Kurulum dosyaları yedeklendikten sonra eski süreçler kapatıldı; profil de kurulum öncesinde yedeklendi. Yedek konumu `%LOCALAPPDATA%\HasarBotuUpdateBackups\0.1.16-20261016-075610` dizinidir. Oturum verileri ve kişisel ayarlar kaynak depoya kopyalanmadı.

## Doğrulama

- Güncelleme denetleyicisi, indirme doğrulaması ve gerçek Windows görev/yeniden başlatma testleri: **21/21 PASS**.
- Masaüstü TypeScript, değişen kodun ESLint kontrolü, tam proje build'i ve `git diff --check`: **PASS**.
- NSIS x64 paketi: **PASS**, kurulum çıkış kodu **0**, kurulu dosya sürümü **0.1.28.0**.
- Gerçek paket açılışı, bağlantı profili, 55 UI dosyasının hash kontrolü, loopback köprüsü ve tepsi davranışı: **PASS**.
- Kurulu uygulamanın gerçek IPC güncelleme kontrolü: `current`, mevcut sürüm `0.1.28`, ofis yayını `0.1.27`.
- Gerçek kullanıcı profiliyle oturum sorgusu: **HTTP 200**; başlangıç denetimi `ready:true`.
- Son normal açılış: uygulama çalışıyor; geçici tanılama/debug seçenekleri kapalı.

Bu kurulum yerel düzeltmedir. Ofis güncelleme yayını bu işlemle değiştirilmedi.

## Paket ve kanıt

Paket: `.local/update-20261016/release/HasarBotu-Setup-0.1.28.exe`.
SHA-256: `1cc7107541c61ae2bc338117be5a8c255ed2c0cc0d80c8860bae71d2ec311e78`.

Kanıtlar `.local/update-20261016/` altında: `updater-tests.log`, `typecheck.log`, `lint.log`, `build.log`, `package-smoke.log`, `live-download-artifact-proof.json`, `installation-proof.json`, `installed-runtime-proof.json`, `normal-restart-proof.json`. Karşılaştırma için `revalidation-red.log` korunur.

Otomatik onay denetimi, bu denetimde oluşturulan dört geçici test profilinin silinmesini politika gereği reddetti; daha ayrıntılı gerekçe verilmedi. Bu klasörler kullanıcının Temp dizininde bırakıldı. Asıl profil ve geri dönüş yedeği korunur; uygulama güncellemesi tamamlandı.
