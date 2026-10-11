# Yerel depolama ve test ortamı kontrolü — 11 Ekim 2026

`51793-22893` bilgisayarında `D:\BaranGlobalStorage` kullanılarak yerel
test yapılabildiği doğrulandı. Ofis bilgisayarı genel test ön koşulu değildir.
6 Ekim kaydındaki `DESKTOP-EFN2G33`, o kayıtta seçilmiş merkezi servis
kurulum hedefidir; hedefe özgü kurulum kabulü ayrı kalır.

| Kontrol | Sonuç |
|---|---|
| Depolama | Sabit NTFS disk; gerçek yerel klasör; taramada reparse point yok |
| Son envanter | 10:14 Türkiye saati: 4.242 klasör, 41.502 dosya; eski `_V2_` pilot ağacı hariç |
| Etkileşimli hesap | Listeleme ve 11 farklı dizin grubundan örnek dosya okuma PASS |
| Windows servis hesabı | Gerçek Session 0 / `LocalService`: listeleme ve 11 örnek dosya okuma PASS; pCloud DB tutarlı salt okunur snapshot PASS |
| pCloud eşlemesi | `D:\BaranGlobalStorage`; folder ID `22216867113`, synctype `3` |
| pCloud kuyruğu | 10:10 → 10:13 → 10:14: 1.948 → 488 → 8 task; son kontrolde fstask ve syncfolderdelayed sıfır |
| Node | PATH: 22.23.2; doğrulamada kullanılan `C:\HasarBotuPilot\runtime\node.exe`: 24.21.0 |
| File Agent | 110/110 test PASS |
| Takip API / PostgreSQL | 45/45 test PASS; ayrı `hasarbotu_storage_20261011_test` veritabanı; atlanan test yok |
| Build | Güncel kaynakla tüm workspace paket build'leri PASS; frontend build bu kontrolde çalıştırılmadı |

Son envanter senkronizasyon sürerken alındı; tüm ağacın bulutla içerik
eşitliği veya freshness kabulü değildir. Dosya içerikleri rapora alınmadı.
Takip testleri gerçek HTTP, izole dosyalar, bildirim, yeniden tarama ve
API/scanner yeniden başlatma davranışını kapsar; canlı Google/SBM kabulü değildir.

## Kurulu pilotun mevcut sınırı

API, File Agent ve PostgreSQL pilot servisleri kontrol başında ve sonunda
durmuş durumdaydı. Kayıtlı tek agent kökü
`D:\BaranGlobalStorage\_V2_EKSIST_PILOT_20260920`; mevcut altı kayıtlı konum
bu pilot kökünde bulunuyor. `eksist_pilot` veritabanında `tracked_files`
tablosu yok; yeni takip şeması kurulu değil.

Dolayısıyla **yerel test ortamı PASS**, gerçek ofis klasörlerinin kurulu
servisle otomatik takibi **PARTIAL**. Bunun için güncel servis kurulumu,
takip migration'ları ve gerçek kayıt/klasör eşlemesi ayrıca uygulanıp
doğrulanmalı. Veritabanı güncellemesi öncesinde doğrulanmış yedek gerekir.

Gerçek belge ve pCloud ayarları değiştirilmedi. Pilot veritabanı yalnız
salt okunur işlemle incelendi. Geçici erişim probu servisi kaldırıldı;
test için başlatılan PostgreSQL kümesi ve pilot PostgreSQL servisi önceki
durumlarına döndürüldü.

Yerel kanıtlar: `.local/storage-check-20261011/inspection.json`,
`service-inspection.json`, `pilot-config.json`; test/build logları
`.local/storage-check-*-20261011.log` altında.
