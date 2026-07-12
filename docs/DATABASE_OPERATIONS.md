# HasarBotu V2 — Veritabanı Operasyonları (Paket 05)

Tarih: 2026-07-12
Kapsam: PostgreSQL 17 kurulum kaydı, bağlantı/rol düzeni, migration komutları, test güvenlik kapısı ve yedek/geri yükleme smoke prosedürü. SQL şema ayrıntıları migration dosyalarındadır.

## 1. Kurulum kaydı (geçici merkez: ofis Windows 11 makinesi)

- Sürüm: **PostgreSQL 17.10** (EDB dağıtımı, winget `PostgreSQL.PostgreSQL.17`), bileşenler: server + commandlinetools (pgAdmin/StackBuilder kurulmadı).
- **Türkçe locale düzeltmesi:** EDB kurulumunun initdb adımı Windows Türkçe locale'inde (`Turkish_Türkiye.1254` ASCII dışı) başarısız olur. Cluster manuel kuruldu:
  `initdb -U postgres --auth=scram-sha-256 --encoding=UTF8 --locale-provider=icu --icu-locale=tr-TR --locale=C`
  Sonuç: `server_encoding=UTF8`, Türkçe sıralama ICU `tr-TR` ile.
- Servis: `postgresql-x64-17`, `NT AUTHORITY\NetworkService` hesabıyla, otomatik başlatma; veri dizini `C:\Program Files\PostgreSQL\17\data` (NetworkService tam yetki ACL'li).
- Binaries: `C:\Program Files\PostgreSQL\17\bin` (PATH'e eklenmedi; komutlar tam yolla çağrılır).

## 2. Kimlik ve sır düzeni

Şifreler repository'ye GİRMEZ; tek konum: `%USERPROFILE%\.hasarbotu\`

| Dosya | İçerik |
|---|---|
| `postgres-superuser.pass` | `postgres` süperkullanıcı şifresi (kurulumda kriptografik üretildi) |
| `hasarbotu_app.pass` | `hasarbotu_app` rol şifresi (uygulama DB'si `hasarbotu` sahibi) |
| `hasarbotu_test.pass` | `hasarbotu_test` rol şifresi (test DB'si `hasarbotu_test` sahibi) |

Bağlantı URL biçimi: `postgres://KULLANICI:SIFRE@127.0.0.1:5432/VERITABANI`. `.env` dosyası kullanılmaz (API config politikası); değişkenler oturumda verilir.

PowerShell örnekleri:

```powershell
# test URL'ini olustur
$pw = Get-Content "$env:USERPROFILE\.hasarbotu\hasarbotu_test.pass" -Raw
$env:TEST_DATABASE_URL = "postgres://hasarbotu_test:$pw@127.0.0.1:5432/hasarbotu_test"

# uygulama URL'i (API icin opsiyonel DATABASE_URL)
$pw = Get-Content "$env:USERPROFILE\.hasarbotu\hasarbotu_app.pass" -Raw
$env:DATABASE_URL = "postgres://hasarbotu_app:$pw@127.0.0.1:5432/hasarbotu"
```

## 3. Migration komutları

Kanonik dizin: `packages/database/migrations` (sıralı `NNNN_ad.js`, ESM, her adım kendi transaction'ında). Durum tablosu: `pgmigrations`.

```powershell
# ileri (DATABASE_URL ortamda olmali)
npm run migrate:up --workspace @hasarbotu/database

# yalniz SON adimi geri al (gelistirme/test icindir)
npm run migrate:down --workspace @hasarbotu/database
```

Kurallar (INFRASTRUCTURE_IMPLEMENTATION_PLAN Paket 05):

- Migration deterministiktir; aynı adım ikinci kez uygulanmaz.
- Üretimde veri kayıplı `down` yerine **onaylı ileri düzeltme** planı kullanılır.
- Otomatik production migration yoktur; migration çalıştırma insan kararıdır ve kritik işlem modeline tabidir.

## 4. Test güvenlik kapısı

- Entegrasyon testleri yalnız `TEST_DATABASE_URL` verildiğinde koşar; verilmezse blok **açıkça atlanır** (başarılı sayılmaz, atlandı raporlanır).
- Kod içi kapı: `assertTestDatabaseUrl` — veritabanı adı `_test` ile bitmiyorsa test **reddedilir**. Üretim bağlantısı testte kullanılamaz.
- Test koşusu `hasarbotu_test` şemasını sıfırlar (`DROP SCHEMA public CASCADE`); bu URL asla üretim DB'sine işaret etmemelidir.

## 5. API bağlantısı

`DATABASE_URL` API için opsiyoneldir: verilmezse health Paket 04 davranışıyla hep `ok`; verilirse health, sınırlı süreli (1500 ms) gerçek `SELECT 1` ping'iyle `ok`/`degraded` üretir (HTTP 200 + gövdede durum). Havuz graceful shutdown'da kapatılır. Geçersiz `DATABASE_URL` ile sunucu başlamaz; hata mesajı değeri taşımaz.

## 6. Yedek / geri yükleme smoke prosedürü

Amaç: "yedek dosyasının oluşması başarı sayılmaz" kuralının kanıtı (ARCHITECTURE Yedek bölümü).

```powershell
$bin = "C:\Program Files\PostgreSQL\17\bin"
$env:PGPASSWORD = Get-Content "$env:USERPROFILE\.hasarbotu\postgres-superuser.pass" -Raw

# 1) dump al
& "$bin\pg_dump.exe" -U postgres -h 127.0.0.1 -Fc -d hasarbotu_test -f "$env:TEMP\hb_smoke.dump"

# 2) ayri veritabanina geri yukle
& "$bin\createdb.exe" -U postgres -h 127.0.0.1 hasarbotu_restore_smoke
& "$bin\pg_restore.exe" -U postgres -h 127.0.0.1 -d hasarbotu_restore_smoke "$env:TEMP\hb_smoke.dump"

# 3) icerigi dogrula (satir sayisi esitligi) ve temizle
& "$bin\psql.exe" -U postgres -h 127.0.0.1 -d hasarbotu_restore_smoke -t -A -c "SELECT count(*) FROM organizations;"
& "$bin\dropdb.exe"  -U postgres -h 127.0.0.1 hasarbotu_restore_smoke
Remove-Item "$env:TEMP\hb_smoke.dump"
$env:PGPASSWORD = $null
```

Gerçek üretim yedek planı (günlük/haftalık/aylık, 14g/8h/12a saklama, BitLocker'lı harici disk, hash doğrulama, `backup_runs`/`restore_test_runs` kayıtları) `ARCHITECTURE.md` ve `AUDIT_SECURITY_AND_BACKUP_PLAN.md` kapsamındadır; bu smoke yalnız mekanizmanın çalıştığını kanıtlar.

## 7. Bilinen sınırlar / ertelenenler

- LAN erişimi kapalı (yalnız 127.0.0.1); pg_hba/dinleme genişletmesi ayrı operasyon kararıdır.
- SSL/TLS yerel loopback'te devre dışı; dış erişim paketinde zorunlu olur.
- `sslmode` gibi URL sorgu parametreleri bilinçli desteklenmez; ihtiyaçta ayrı karar.
- Üretim `hasarbotu` DB'sine migration uygulaması Paket 05 kapsamı dışıdır (test DB kanıtı yeterli); ilk üretim migration'ı ayrı onaylı adımdır.
