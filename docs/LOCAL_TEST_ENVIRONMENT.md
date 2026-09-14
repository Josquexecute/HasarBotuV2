# HasarBotu V2 — Yerel test ortamı

Hazırlık ve doğrulama: 2026-09-13. Bu ortam tamamen sentetiktir; production
başka bilgisayardadır. Windows servisi kurulmadı. Süreçler mevcut kullanıcı
altında arka planda çalışır; Windows açılışında otomatik başlamaz.

Windows genelindeki [yardımcı düğmeyi](./DESKTOP_ASSISTANT.md) denemek için
bu ortam açıkken `apps/desktop/release/assistant/win-unpacked/HasarBotu.exe`
çalıştırılabilir. Tarayıcıdaki arayüz Windows üstü pencere oluşturmaz.
Yeni installer adayı aynı dizinin üstündeki `HasarBotu-Setup-0.1.2.exe` dosyasıdır.

## Adresler ve giriş

| Bileşen | Adres / kapsam |
|---|---|
| Arayüz | `http://127.0.0.1:5173` — gerçek API modu |
| API | `http://127.0.0.1:3100` |
| PostgreSQL 17.11 | `127.0.0.1:55432` — UTF-8, ICU `tr-TR` |
| Otomatik test DB | `hasarbotu_automation_test` — rol `hb_automation` |
| Elle kabul DB | `hasarbotu_uat_test` — rol `hb_uat` |
| Yönetici | `admin@hasarbotu.test` |
| Salt okunur kullanıcı | `readonly@hasarbotu.test` |

İki sentetik hesap aynı rastgele test parolasını kullanır. Parolayı terminale
yazdırmadan panoya almak için proje kökünde:

```powershell
& .\.local\test-environment\manage.ps1 -Action CopyPassword
```

Ardından arayüzde kullanıcı adıyla giriş yapın. Mevcut tarayıcıda önceden
mock modu seçildiyse veri kaynağını API olarak seçin; mock ekranını gerçek
veritabanı kabulü saymayın.

Parolalar kaynakta veya logda bulunmaz. Windows kullanıcı hesabıyla
şifrelenmiş `secrets.clixml`, `%LOCALAPPDATA%\HasarBotuTest` altında çalışma
alanına özgü bir alt klasördedir; dizin ACL'i mevcut kullanıcıyla sınırlıdır.
Bu dosya farklı Windows kullanıcısına taşınabilir bir parola dosyası değildir.

## Başlatma, durdurma ve doğrulama

```powershell
# Çalışma durumunu göster
& .\.local\test-environment\manage.ps1 -Action Status

# Kapalı ortamı başlat
& .\.local\test-environment\manage.ps1 -Action Start

# Veritabanı, HTTP, giriş, rol sınırı ve Agent bağlantısını doğrula
& .\.local\test-environment\manage.ps1 -Action Check

# Süreçleri kapat; verileri sakla
& .\.local\test-environment\manage.ps1 -Action Stop
```

Başlatma, dolu portlarda veya başka süreç kimliğinde ilerlemez. Ortam kısmen
açıksa önce `Status`, sonra `Stop` ve `Start` kullanın. `Stop` yalnız bu
yardımcının başlattığı, kimliği yeniden kontrol edilen süreçleri ve bu test
cluster'ını durdurur. Otomatik testler çalışırken durdurmayın.

## Otomatik test komutları

Her yeni terminalde Node 24 ve yalnız otomatik test veritabanını seçin:

```powershell
. .\.local\test-environment\manage.ps1 -Action Enter
npm.cmd run test --workspace @hasarbotu/database
npm.cmd run test --workspace @hasarbotu/api -- test/auth-flow.test.ts
npm.cmd run test --workspace @hasarbotu/file-agent -- test/config.test.ts

# Tam test zinciri — bu hazırlıkta henüz çalıştırılmadı
npm.cmd test
```

`Enter`, bağlantı sırrını ekrana basmadan `TEST_DATABASE_URL` değişkenini ayarlar.
Otomatik testler kendi DB'lerinde şemayı sıfırlar. İki rolün karşı DB'ye erişimi
`pg_hba.conf` ve CONNECT yetkileriyle reddedilir; elle kabul verileri korunur.
Aynı otomatik DB'yi kullanan ayrı test komutlarını eşzamanlı çalıştırmayın.

## Sentetik veri ve sınırlar

- İki DB'de 48 migration, HEAD `0048_v1_import_source_quarantine`; migration
  tekrar koşusu sıfır işlem verdi.
- Elle kabul DB'sinde 1 test ofisi, 2 kullanıcı, 1 Trafik ve 1 Kasko dosyası,
  1 storage root ve 1 aktif File Agent var. Başlangıçta karantina listesi boştur;
  diğer bilgisayardaki beş gerçek kaynak aktarılmadı.
- Agent'ın fiziksel kökü `.local/test-environment/storage` dizinidir. Örnek
  vaka çalışma klasörleri, belge/PDF/Excel içerikleri henüz oluşturulmadı.
- AI sağlayıcıları test API fabrikasına bağlanmaz. Gerçek harici çağrı yapılmaz.
- Freshness/insan onayı korumaları devrededir. Kritik taşıma/Excel yazımı için
  sentetik kanıtlarla ayrı kabul senaryosu gerekir; bu ortam hazırlığı onların
  geçtiği anlamına gelmez.
- Tarayıcı/Electron görsel kabulü, iki çözünürlük/iki tema, PDF/OCR/Excel ve
  kurulum/kaldırma testleri bu adımın kapsamında çalıştırılmadı.

## Çalıştırılan doğrulamalar

| Kontrol | Sonuç |
|---|---|
| Database workspace, gerçek PostgreSQL | 78/78 PASS |
| API giriş/oturum testleri, gerçek PostgreSQL | 8/8 PASS |
| File Agent config regresyonu | 7/7 PASS |
| DB sınırı/rol/locale/migration, API health, UI proxy üzerinden login/401/403/case detail, Agent poll | 23/23 PASS |
| Stop → sıfır dinleyen test portu → Start → yeniden kontrol | PASS; sentetik veriler korundu |
| Yerel PowerShell/JavaScript yardımcılarının sözdizimi | PASS |

Bu 93 hedef testte skip veya fail yoktur. Tam root suite sonucu değildir.
Kanıtlar `.local/test-environment/logs`, `check-result.json` ve
`postgres-download.json` dosyalarındadır. `.local` Git dışında, bu makineye
özgüdür; kaynak kopyasıyla otomatik dağıtılan kurulum altyapısı sayılmaz.

PostgreSQL, [resmi Windows indirme sayfasının](https://www.postgresql.org/download/windows/)
yönlendirdiği [EDB binary arşivinden](https://www.enterprisedb.com/download-postgresql-binaries)
alındı. İndirme hash'i yerel envantere kaydedildi; bağımsız yayıncı checksum'u
ile doğrulandığı iddia edilmez. Production kurulumu ve önceki imzasız masaüstü
installer'ı değiştirilmedi. Git geçmişi bulunmadığı için commit oluşturulmadı.
