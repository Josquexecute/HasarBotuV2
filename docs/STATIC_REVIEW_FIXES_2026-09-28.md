# Statik inceleme düzeltmeleri — 28.09.2026

Kaynak rapor: `STATIC_REVIEW_2026-09-27.md` (ilk incelemenin kaydı korunmuştur).

- **1–2:** HTTPS istemcisi sertifika doğrulamasını korur. Handler, statik dosya ve kesilen upstream akışları kontrollü hata yanıtıyla karşılanır.
- **3:** Heartbeat sunucunun `leaseExpiresAt` değerini kullanır. 409, ağ hatası veya süre dolması yeni mutasyonları durdurur ve streaming kopyayı iptal eder. Sonuç kabul edilene kadar heartbeat sürer. Başlatılmış atomik işletim sistemi çağrısı geri alınamaz.
- **4:** Taşımadan önce hedef kökte `.hasarbotu-operations/<operationId>-<version>.json` exclusive oluşturulur ve fsync edilir. Kurtarma işlem kimliği, sürüm, kaynak/hedef ve manifest eşleşmesini gerektirir. Eksik/uyuşmayan kanıt manuel kurtarmaya gider. Kanıt dosyaları tekrar denemeler için korunur.
- **5 ve 9:** Profil/sahip kaydı transaction içinde önce dosya satırını kilitler. Kapalı dosyaya yazım engellenir; eşzamanlı ilk kayıt 409 sürüm çakışmasına dönüşür.
- **6:** PostgreSQL havuzunun boş bağlantı hataları hassas bilgiler olmadan loglanır; sağlık kontrolü gerçek sorguyu kullanır.
- **7:** Köprü portu ve Chromium depolaması API bazında kalıcıdır. Port çakışmasında farklı origin'e geçilmez. Önceki rastgele origin'lerde kalmış taslaklar otomatik taşınmaz.
- **8:** Eksist kaynak endpoint'i için köprü timeout'u 120 saniyedir. Kullanıcı ve istek içeriği kimliğiyle eşzamanlı/yanıt kaybı sonrası tekrarlar tek transaction ve kalıcı idempotency kaydı üzerinden aynı sonucu döndürür.
- **10:** Saklanan tema/yoğunluk/sayfa/boolean türleri doğrulanır. Yazma hatasında arayüz bellekte çalışır ve kalıcılık uyarısı gösterir.

## Doğrulama

Node 24.21.0 kullanıldı. Tip kontrolü, tam build ve frontend bundle bütçesi geçti. Lint: 0 hata, mevcut 12 uyarı. `git diff --check` temiz.

| Paket | Geçen | Başarısız | Atlanan |
|---|---:|---:|---:|
| UI | 358 | 0 | 6 |
| Domain | 568 | 0 | 0 |
| Contracts | 277 | 5 | 0 |
| Database | 25 | 54 | 0 |
| Desktop bridge | 14 | 0 | 0 |
| API | 404 | 2 | 0 |
| File Agent | 105 | 0 | 0 |
| Desktop | 114 | 0 | 0 |

İlgili regresyonlar geçti: güvenilen/güvenilmeyen HTTPS, statik dosya okuma hatası, kesilen proxy yanıtı, OCR timeout yönlendirmesi ve yükleme tekrarı, lease kaybında dosya mutasyonunun durması, kanıtlı taşıma kurtarması, gerçek PostgreSQL kilit yarışları, depolama hatası ve iki ayrı Electron süreci arasında taslak/istek anahtarı kalıcılığı.

Genel testlerdeki **61 başarısızlık**, değiştirilmemiş HEAD kaynaklarının ayrı kopyasında da yeniden üretildi:

- Contracts: 5 eski JSON Schema fixture uyuşmazlığı (Eksist alanları, servis revizyonu ve dosya sorgusu).
- Database: yeni `0049_eksist_sources` migration'ını hesaba katmayan sıralama/rollback beklentileri ve ardından gelen zincirleme hatalar (54).
- API: `notifications-uat-e2e` takip uyarısı beklentisi ve `traffic-value-loss-hardening` revision raporu beklentisi (2).

Ek `check:deploy` kontrolü D8/D9 depolama scriptlerinde ve attestation ACL testinde başarısız oldu; bu scriptler değiştirilmedi. Ayrıntılar `.local/static-fixes-*.log` dosyalarındadır. Gerçek Electron kabuk test aracında son pencere kapanırken JSON yazımının yarıda kalmasını önleyen yaşam döngüsü düzeltmesi yapıldı; masaüstü paketi son koşuda 114/114 geçti.

**Durum:** 10 bulgu için düzeltmeler ve ilgili doğrulamalar tamamlandı. Genel depo/release doğrulaması, yukarıdaki mevcut hatalar nedeniyle **PARTIAL**. Installer üretilmedi, dış ortama dağıtım yapılmadı.
