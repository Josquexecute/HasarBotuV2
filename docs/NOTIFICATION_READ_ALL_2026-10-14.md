# Bildirimlerin topluca okunması — 0.1.12

Bildirimler → Gelen kutusu → **Tümünü okundu işaretle** bütün sayfalardaki mevcut okunmamış bildirimleri kaydeder. Seçili Tümü/Okunmuş/Okunmamış görünümü korunur; liste ilk sayfaya döner, okunmamış sayacı ve açılır bildirim listesi sunucudan yenilenir. Küçük ekranlarda butonlar ikinci satıra geçer.

`POST /api/v1/tracking/notifications/read-all` boş bir JSON nesnesi alır. Oturum ve `case_read` yetkisi zorunludur. İşlem güncel dosya sorumluluğuna göre yalnız oturumdaki kullanıcı ve kuruma ait, arşivlenmemiş dosyaların okunmamış bildirimlerini değiştirir. Kullanıcı/hedef kimliği gönderilemez. Önceden okunmuş zamanlar, diğer sorumluların kayıtları ve işlem başladıktan sonra gelen bildirimler korunur. Operasyonel Uyarılar sekmesindeki evrak/görev kuralları değişmez.

Okunma ve sayılı denetim kaydı aynı veritabanı işlemi içindedir; denetim yazımı başarısızsa okunma da geri alınır. Boş liste ve tekrar çağrı yan etkisizdir. İstek sürerken butonlar devre dışıdır; hata halinde okunmamış sayaç korunur ve yeniden deneme mümkündür.

Doğrulama: 575 API, 406 ön yüz, 139 masaüstü testi geçti. Sekiz mevcut canlı ön yüz testi kimlik bilgileri/yapılandırması olmadan atlandı. Kurulu 0.1.11 uygulamasının butonla gerçek NSIS 0.1.12 kurulumuna geçmesi, otomatik yeniden açılışı, özgün API ve kullanıcı profili koruması geçti. Aynı kurulu uygulamada 61 bildirim iki sayfadan okundu yapıldı, başka sorumlunun bildirimi korunarak liste/sayaç yenilendi ve okunma durumu yeniden açılışta kaldı. 390 px görünümde yatay taşma yok.

Bu son kabul sentetik hesapla izole `_test` veritabanında yapıldı. Kullanıcının daha önce gerçek hesapla ve ofis yeniden açılışından sonra doğruladığı dosya navigasyonu kabulü korunur; 0.1.12 için yeni bir manuel gerçek hesap kabulü iddia edilmez. Canlı hesapların bildirimleri dağıtım sırasında topluca okunmadı.

Ofis ve evdeki gerçek kurulu 0.1.12 istemcilerin arşivi ve 53 arayüz dosyası karşılaştırıldı. Özgün kullanıcı profilleriyle ofis HTTPS API'sine hazırlık kontrolü geçti; gerçek köprü paketli arayüzü sunuyor, Google bağlantısı etkin ve anonim dosya erişimi 401 ile reddediliyor. Ortak 0.1.12 güncellemesi yayımlandı; API/dosya servisi ve diğer üç ofis servisi çalışıyor. Kurulum sırasında iş verilerinin tamamı korundu ve önceki paketler saklandı.

Kanıtlar (Git dışında): `.local/release-updater-read-all-0.1.12-evidence/result.json`, `notifications-mobile-before.png`, `notifications-read.png`; `.local/remaining-work-20261013/read-all-package-proof.json`, `read-all-local-client-proof.json`, `read-all-office-client-final-proof.json`, `read-all-shared-publication-proof.json`, `read-all-final-verified-office-proof.json`, `read-all-final-restore-proof.json`, `read-all-targeted-api-tests.log`, `folder-registration-tests.log`, `read-all-full-ui-tests.log`, `read-all-desktop-tests.log`, `read-all-desktop-e2e-tests.log`.
