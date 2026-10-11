# Yerel takip genişletmesi — 11 Ekim 2026

**Durum: ayrı test ortamında geniş evrak takibi PASS; tam kullanım PARTIAL.**
Kurulum: `C:\HasarBotuPilot\local-tracking-20261011`.
Kaynak: `D:\BaranGlobalStorage`. Gerçek V1 dosyaları salt okunur kullanıldı;
üretim veritabanına geçiş yapılmadı.

## Önceki pilotun kapsam düzeltmesi

[İlk pilotta](LOCAL_TRACKING_PILOT_2026-10-11.md) seçilen iki dosya bir
`_HASARBOTU` kayıt klasöründeydi. Hash, bildirim kalıcılığı ve yeniden
başlatma kontrolleri geçerliydi; **iki hasar evrakı algılandığı sonucu doğru
değildi**. Uygulama kayıt klasörleri artık evrak taramasından ve silinme
uzlaştırmasından dışlanıyor. Kaynak dosyalar korunarak yalnız test DB'sindeki
yanlış evrak/bildirim kayıtları yedeklenip kaldırıldı. Eski örnek takip kökü
pasifleştirildi.

## Gerçek kayıt ve klasör eşlemesi

`2026 OFİS` adını atlayan V1 keşfi düzeltildi; mevcut sayısal yıl adları
korundu. Plaka benzerliği yerine mevcut aktarımın kaynak kimliği ve
provenance bilgisi kullanıldı.

| Kontrol | Sonuç |
|---|---|
| V1 aktarımı | 379 dosya kaydı, 1.408 not, 9 açık + 69 tamamlanmış görev; tarihsel kapanışlar korundu |
| Tekrar aktarım | Yeni dosya/not/görev sıfır; iş verisi çoğalmadı |
| Tekil fiziksel eşleşme | 378 kayıt takipte; birden çok fiziksel konumu olan 1 kayıt bağlanmadı |
| Evrak kapsamı | 25.570 dolu dosya; 11.457.529.534 byte |
| Hariç tutulan uygulama kayıtları | Yeni kapsamda 757; ilk örnekte ayrıca 2 yanlış gözlem kaldırıldı |
| Kaynak korunması | 757 uygulama kayıt dosyasının SHA-256 değerleri değişmedi |
| Eksik kaynak kayıtları | Önizlemede 165 klasörün V1 sidecar kaydı yok; kayıt uydurulmadı |
| Ayrılan kaynaklar | 5: 1 kaynak kimliği çakışması, 2 ayrıştırılamayan klasör adı, 2 belge türü kanıt tarama hatası |

Gerçek sorumlu/eksper/kullanıcı hesapları eşleştirilmedi. Takipteki kayıtların
sorumlusu **yalnız ayrı ortamın test gözlemcisidir**. V1 sorumlu bilgisi ham
kaynak/provenance içinde korunur; test hesabı gerçek çalışan eşlemesi sayılmaz.

## Doğrulama

- Windows'ta her dosya için PowerShell açılması kaldırıldı. Kalıcı hash
  yardımcısı `FileShare.Read` kullanır; açık yazıcı hâlâ okumayı engeller.
  Uzun taramada ilerleme sağlık bildirimi güncellenir.
- 25.570 dosyanın scanner hash'i bağımsız Node SHA-256 hesabıyla eşit;
  25.570 gözlem ve 25.570 kalıcı bildirim var. Tüm revizyonlar 1; otomatik
  inceleme/onay sıfır. Yeniden başlatma/tarama sonrasında sayılar korundu.
- Gerçek HTTP oturumu ve takip yanıtı PASS. Gerçek Electron/production UI:
  normal giriş, toplam sayılar, ilk 100 evrak/100 bildirim, devamını gösterme
  ve sayfa yenileme PASS. İnceleme taslakları devamını gösterirken korunur.
  Renderer'da Node erişimi yok. Görsel kontrol yapıldı.
- Hedefli testler **187/187 PASS**, atlanan yok: V1/keşif 22, takip API ve
  izole PostgreSQL 45, tüm File Agent 114, takip UI 6. Etkilenen dosyalarda
  lint ve tip kontrolleri PASS; son kaynakla frontend ve tüm workspace
  build'leri PASS. Dağıtılmış servis bağımlılık/hash/smoke kontrolleri PASS.
- Aktarım öncesi DB yedeği ayrı test DB'sine geri yüklendi; **123 tablonun
  tüm içerikleri eşit**. Yanlış metadata olayları ayrıca korumalı yedekte.

Bu hash kabulü yerel byte içeriği içindir; bütün ağacın bulutla eşitliği
veya bulut freshness kabulü değildir. Tracker yalnız evrak takip döngüsünü
çalıştırır; fiziksel dosya işlemleri/OCR iş kuyruğu çalıştırılmaz.

## Kalıcı başlangıç

Üç servis de `Running / Automatic / LocalService`:
`hb-local-tracking-db-20261011`, `hb-local-tracking-api-20261011`,
`hb-local-tracking-tracker-20261011`. Bağımlılıklar tracker → API → DB;
hata sonrası yeniden başlatma gecikmeleri 10/30/60 saniye.

Üçü durdurulduktan sonra yalnız tracker başlatılarak bağımlılık başlangıcı
doğrulandı. Tracker Node süreci zorla kapatıldı; elle başlatmadan yeni süreç
ile toparlandı. Eski Eksist pilotunun servisleri Stopped/Manual kaldı.

**Gerçek Windows reboot kabulü henüz PENDING.** Bir sonraki Windows
açılışından 10 dakika sonra `HasarBotu-Local-Tracking-Boot-Acceptance-20261011`
görevi yeni boot zamanı, servis durumları, boot sonrası başarılı tarama ve UI
HTTP erişimini kontrol eder. SYSTEM bağlamında elle çalıştırılması PASS;
aynı boot'ta doğru olarak `PENDING_NO_NEW_BOOT` raporlar. Sonuç:
`C:\HasarBotuPilot\local-tracking-20261011\evidence\boot-acceptance.json`.

Kanıtlar `.local/local-tracking-20261011/` altında: `expansion-import-summary.json`,
`expansion-mapping-summary.json`, `expansion-validation-restart.json`,
`source-preserved-validation.json`, `desktop-expansion-validation.json`,
`dependency-start-validation.json`, `crash-recovery-validation.json` ve test/
build/dağıtım logları. Ayrıntılı yollar, kaynak kayıtları, yedekler ve UI
görüntüsü kurulumun korumalı `private` dizinindedir; sırlar raporlara alınmadı.

Tam kullanım için kaydı olmayan/belirsiz klasörler, gerçek çalışan
eşleştirmeleri ve gerçek reboot kabulü tamamlanmalıdır.
