# Windows yardımcısı

2026-09-13 — Kullanıcının Windows genelinde AssistiveTouch benzeri yardımcı
isteği üzerine, mevcut Electron kabuğuna ayrı bir yardımcı pencere eklendi.
Kaynak sürümü 0.1.2; bu yerel geliştirme değişikliği production dağıtımı değildir.

## Kullanım

- HasarBotu açıldığında ekranın sağında küçük bir yardımcı düğme görünür.
  Ana pencere küçültüldüğünde diğer Windows uygulamalarının üzerinde kalır.
- Düğmeyi sürükleyerek taşı; tıklayarak menüyü aç. Klavyeyle Enter/Space menüyü,
  ok tuşları konumu kontrol eder. Escape açık menüyü kapatır.
- Menü: HasarBotu’yu aç, Dosyalar, Bildirimler, Ayarlar, göster/gizle,
  konumu sıfırla ve uygulamadan çık. Kısayollar mevcut uygulama sayfalarını açar;
  giriş ve rol kontrolleri geçerlidir. Başka sayfaya geçiş ana pencereyi yeniden
  yükler; o sayfadaki kaydedilmemiş form taslağı korunmaz.
- Gizlenen veya Alt+F4 ile kapatılan yardımcı sistem tepsisi menüsünden geri
  açılır. Ana pencerenin X düğmesi veya “HasarBotu’dan çık” uygulamayı kapatır.
  Windows ile otomatik başlatma eklenmedi.
- Son konum yalnız kullanıcının Electron ayar dizinindeki
  `assistant-position.json` dosyasında tutulur. Ekran/DPI/çalışma alanı değişimi
  ve çıkarılan monitör durumunda düğme görünür çalışma alanına sınırlandırılır.
- Bu sürüm kısayol yardımcısıdır; AI sohbeti, ses kontrolü veya ekran görüntüsü
  servisi içermez. Güvenli Windows oturum/UAC ekranları kapsam dışıdır.

## Teknik sınır

Ana uygulamanın mevcut ayrıcalıksız preload'u korunur. Yalnız yardımcıya ait
sandbox preload, tek `hasarbotu:assistant` kanalında dokuz sabit UI komutunu
iletir. Ana süreç gönderici pencereyi, ana frame'i, tam belge URL'ini ve komutu
doğrular. Renderer URL, dosya yolu, komut satırı veya koordinat veremez.
Fare konumu ana süreçte Electron `screen` üzerinden DIP cinsinden okunur.

Yardımcı aynı loopback köprüsünden yalnız kendi statik HTML/CSS/JS dosyalarını
yükler; ayrı geçici session kullanır. Ana uygulamanın oturum çerezlerini ve
zoom ayarını paylaşmaz. CSP, sandbox ve permission reddi uygulanır; navigasyon,
yeni pencere, webview ve indirme engellenir. DB/File Agent veya business write
yolu eklenmez. Pencere kapandığında IPC/display/download listener'ları ve tray
temizlenir.

Electron 43.2.0'ın Windows `floating` seviyesi görev çubuğunun arkasına
yerleştirme yapar; bu ortamda `isAlwaysOnTop()` false olmasına yol açtı.
Çalışma alanına sınırlandırılan yardımcı `pop-up-menu` seviyesini kullanır.
İlgili upstream uygulama:
[NativeWindowViews::SetAlwaysOnTop](https://github.com/electron/electron/blob/v43.2.0/shell/browser/native_window_views.cc#L1081).

## Doğrulama

Güncel test ve paket sonucu `LOCAL_READINESS_REPORT.md` içindeki yardımcı
ekinde kayıtlıdır. Regresyonlar: `assistant-policy.test.ts`,
`assistant-renderer.test.ts`, `assistant-e2e.test.ts`.
Electron entegrasyon testi gerçek pencere/preload/IPC/menü/gezinti/persistence
zincirini çalıştırır; sürükleme testinde donanım imleci deterministik verilir.
Bu test fiziksel fare/dokunmatik ve çok monitörlü kullanıcı kabulü yerine geçmez.
