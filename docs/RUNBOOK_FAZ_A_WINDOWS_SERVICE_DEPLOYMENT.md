# Runbook — Faz A Windows servis dağıtımı (D5, HB-2026-108)

Durum: Runbook hazır; **gerçek kurulum bu pakette YAPILMADI**. Araçlar
`deploy/windows-service/`te bulunur, `scripts/check-windows-service-configs.mjs`
ile otomatik doğrulanır.

Bu runbook `docs/DEPLOYMENT_AND_OPERATIONS_PLAN.md` §5'te tanımlanan
"servis başlatma/durdurma" ve "depolama kökü/pCloud kesintisi" runbook'larının
Faz A için somutlaştırılmış hâlidir. Her adım sahip, ön koşul, komut/işlem,
beklenen çıktı, durdurma ölçütü, doğrulama ve audit kanıtı taşır (aynı
belgenin kabul ölçütü).

## 0. Bağlayıcı karar (HB-2026-108)

- **Servis sarmalayıcı: WinSW.** NSSM'in resmi kararlı sürümü 2014'te
  dondu (2017 "ön-sürüm" bile hâlâ önerilir); Görev Zamanlayıcı'nın SCM
  sağlık/bağımlılık semantiği yoktur. ADR-Q08 bu kararla kilitlenmiştir.
- **Depolama kökü: pCloud SENKRONİZE KLASÖR modu, sürücü harfi DEĞİL.**
  `P:\` bir pCloud SANAL sürücüsüdür (`net use` boş, `DriveType=2`,
  `VolumeName=pCloud Drive`, `FileSystem=exFAT`). **HB-2026-111'de bu
  makinede yapılan gerçek SYSTEM çalıştırması, aşağıdaki "Local" ad alanı
  varsayımını ÇÜRÜTTÜ:** sürücü harfi aslında `\GLOBAL??` (makine geneli)
  ad alanında kayıtlı (EldoS Callback File System `bfs.sys`/`cbfs20.sys`
  kullanılıyor, basit bir oturuma-özel `DefineDosDevice` DEĞİL) ve SYSTEM
  gerçekten görüp okuyup yazıp silebiliyor. Öneri yine de GEÇERLİ ama
  gerekçesi farklı — bkz. §2: (1) gerçek G/Ç, Windows servisi OLMAYAN,
  yalnız etkileşimli oturumda çalışan `pCloud.exe`ye (CBFS callback
  işleyicisi) bağımlı, bu kullanılabilirlik için kırılgan; (2) ölçülen ACL
  `Everyone: tüm haklar` — en-az-yetki sağlamıyor. Eski (yanlış) gerekçe
  referans için: Microsoft'un genel MS-DOS aygıt ad alanı belgelemesi
  ([Defining an MS-DOS Device Name](https://learn.microsoft.com/en-us/windows/win32/fileio/defining-an-ms-dos-device-name))
  tipik `DefineDosDevice` çağrılarının oturuma özel "Local" ad alanına
  girdiğini açıklar, ancak BU pCloud kurulumu (CBFS tabanlı) bu genellemeye
  UYMUYOR.
- **Başlangıç sırası: PostgreSQL -> API -> File Agent**, WinSW `<depend>`
  ile SCM seviyesinde ifade edilir. Bu bir İYİLEŞTİRMEDİR, TEK korumadır
  değildir: API (`services/api/src/server.ts`) Postgres hazır olmadan da
  çökmeden başlar (`/health` `degraded` döner), File Agent (`runLoop`, D4)
  API hazır olmadan da çökmeden bekler/yeniden dener.

## 1. Ön koşulların doğrulanması (kurulumdan ÖNCE)

**Sahip:** Kurulumu yapan operatör.

**Ön koşul:** Yönetici (Administrator) oturumu.

**Komut/işlem:**

```powershell
Get-CimInstance Win32_Service -Filter "Name='postgresql-x64-17'" |
  Format-List Name, StartName, StartMode, State
```

**Beklenen çıktı:** `State=Running`, `StartMode=Auto`. Bu makinede
doğrulandı: `StartName=NT AUTHORITY\NetworkService` (zaten en-az-yetki
hesabı; DEPLOYMENT_AND_OPERATIONS_PLAN.md §2.3 ile tutarlı, değiştirilmez).

**Durdurma ölçütü:** Postgres kurulu/çalışır değilse önce
`docs/DATABASE_OPERATIONS.md` ile PostgreSQL kurulumu tamamlanır; bu
runbook'a devam edilmez.

**Doğrulama:** Yukarıdaki komutun çıktısı kayda alınır.

**Audit kanıtı:** Bu runbook'un çalıştırıldığı tarih/operatör, deployment
audit kaydına (§6) eklenir.

## 2. pCloud senkronize klasör geçişi

**Sahip:** Ofis IT/operatör (pCloud hesabına erişimi olan).

**Ön koşul:** Adım 1 tamamlanmış; mevcut `P:\BARAN GLOBAL EKSPERTİZ`
içeriğinin bütünlüğü biliniyor (dosya sayısı/toplam boyut notu).

**Gerekçe (HB-2026-111'de düzeltildi — bkz. DECISION_LOG):** İlk gerekçe
("SYSTEM sürücü harfini göremez") bu makinede yapılan gerçek SYSTEM
çalıştırmasıyla ÇÜRÜTÜLDÜ — pCloud bu kurulumda EldoS Callback File System
(`bfs.sys`) kullanıyor ve sürücü harfi `\GLOBAL??` (makine geneli) ad
alanında kayıtlı; SYSTEM gerçekten okuyup yazıp silebiliyor. Geçiş önerisi
GEÇERLİLİĞİNİ KORUYOR ama gerekçesi farklı, iki bağımsız nedenle: (1)
**kullanılabilirlik** — gerçek G/Ç, Windows servisi OLMAYAN, yalnız bir
kullanıcı oturum açtığında çalışan `pCloud.exe`ye (callback işleyicisi)
bağımlıdır; insansız 7/24 çalışması gereken bir Windows servisinin buna
güvenmesi kırılgandır. (2) **ACL/en-az-yetki** — ölçülen ACL
`Everyone: tüm haklar` (tek ACE, `-1`) döndürdü; bu, gerçek müşteri verisi
için savunulabilir bir erişim sınırı SAĞLAMIYOR. pCloud'un "Senkronize
Klasör" (Sync) modu düz bir NTFS dizinini senkronize eder — bu, sıradan
bir dizin olduğu için hem servis hesabına özel NTFS ACL'leriyle
korunabilir hem de Windows servisinden bağımsız (interaktif oturum
gerektirmeyen) bir bileşen tarafından senkronize edilir.

**Komut/işlem:**

1. pCloud masaüstü istemcisinde: Ayarlar → Hesap/Senkronizasyon →
   "Sanal Sürücü"nden "Senkronize Klasör" moduna geç (tam ad ve menü yolu
   pCloud istemci sürümüne göre değişebilir; istemcinin kendi arayüzünden
   doğrulanır).
2. Hedef yerel klasör seç: örn. `C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ`
   (C:\ sürücüsünde, sürücü harfi DEĞİL bir alt dizin).
3. pCloud tam senkronizasyonu TAMAMLAYANA kadar bekle (dosya
   sayısı/toplam boyut, Adım 1'deki nota eşleşene kadar).
4. Yeni yerel kökte salt-okunur bir örnekleme yap: birkaç rastgele dosyanın
   var olduğunu ve boyutunun eskisiyle eşleştiğini doğrula.

**Beklenen çıktı:** `C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ` altında
eski `P:\BARAN GLOBAL EKSPERTİZ` ile BİREBİR aynı klasör/dosya yapısı.

**Durdurma ölçütü:** Senkronizasyon tamamlanmadan veya dosya
sayısı/boyutu eşleşmeden File Agent bu köke YÖNLENDİRİLMEZ; eski `P:\`
sürücüsü bir süre daha (salt-okunur referans olarak) tutulabilir.

**Doğrulama:** §2.5'teki SYSTEM probu YENİ yol için `PASS` vermelidir
(sürücü harfi değil düz dizin olduğu için önkoşul olarak gerekmez ama
NTFS izinlerini doğrulamak için önerilir — `Test-Path` + servis
hesabının o dizine `icacls` ile okuma/yazma izni olduğu kontrol edilir).

**Audit kanıtı:** Geçiş tarihi, eski/yeni kök, dosya sayısı/boyut
karşılaştırması runbook kaydına eklenir. Veritabanı DEĞİŞMEZ — yalnız
File Agent'ın yerel `HASARBOTU_AGENT_ROOTS` değeri güncellenir
(`FILE_STORAGE_AND_AGENT_PLAN.md` §2'de belgelenen taşınabilirlik).

## 2.5. SYSTEM bağlamı doğrulaması

**Sahip:** Kurulumu yapan operatör.

**Ön koşul:** Adım 2 tamamlanmış (veya karşılaştırma için ESKİ `P:\` ile
de bir kez çalıştırılıp GERÇEKTEN görünmediği kanıtlanabilir).

**Komut/işlem:**

```powershell
cd deploy\windows-service
.\probe-p-drive-system-context.ps1                              # varsayılan: P, 90 sn üst sınır
.\probe-p-drive-system-context.ps1 -DriveLetter C -TimeoutSeconds 120  # yeni kök C:\ altındaysa; NTFS erişimi ayrıca `icacls` ile doğrulanır
```

**Beklenen çıktı:** `SONUÇ: ... SYSTEM bağlamından GÖRÜNÜYOR ve
listelenebiliyor.` ve çıkış kodu `0`.

**Durdurma ölçütü:** Çıkış kodu `1` ise (görünmüyor) File Agent servisi
KURULMAZ; Adım 2'ye dönülür. Çıkış kodu `3` ise (zaman aşımı) `-TimeoutSeconds`
artırılıp tekrar denenir; yine aşarsa aşağıdaki log/`LastTaskResult`
incelenir.

**Doğrulama (HB-2026-109):** Betik ekrana `LastTaskResult` (Görev
Zamanlayıcı'nın kendi durum kodu) ve varsa görev eylem log dosyasının
içeriğini yazdırır — zaman aşımı/hata durumunda ham kanıt sağlar. Yalnız
Görev Zamanlayıcı KAYDI (geçici görev) her durumda kaldırılır
(`Get-ScheduledTask -TaskName HasarBotuStorageRootSystemProbe` boş
dönmelidir); sonuç JSON'u, iç betik ve log dosyası **kalıcı audit kanıtı**
olarak `C:\ProgramData\HasarBotu\probe\` altında zaman damgalı bırakılır
(üzerine yazılmaz, sonraki çalıştırmalar birikir).

**Audit kanıtı:** Bu adımın ekran çıktısı VE
`C:\ProgramData\HasarBotu\probe\probe-result-*.json` dosyası deployment
audit kaydına eklenir.

## 3. WinSW servislerinin kurulumu

**Sahip:** Kurulumu yapan operatör.

**Ön koşul:** Adım 1–2.5 tamamlanmış; `npm run build` çalıştırılmış
(`services/api/dist/index.js` ve `services/file-agent/dist/index.js`
mevcut); WinSW ikili dosyası resmi
[github.com/winsw/winsw/releases](https://github.com/winsw/winsw/releases)
adresinden indirilip yerel bir yola konmuş (ör. `C:\Tools\WinSW-x64.exe`).

**Komut/işlem — önce ÖNİZLEME (hiçbir değişiklik yapmaz):**

```powershell
cd deploy\windows-service
.\install-services.ps1 -ApiDir C:\HasarBotu\services\api `
  -FileAgentDir C:\HasarBotu\services\file-agent `
  -WinSwExe C:\Tools\WinSW-x64.exe
```

**Beklenen çıktı:** Plan listesi + `-Apply verilmedi: yalnız plan
gösterildi, HİÇBİR değişiklik yapılmadı.`

**Komut/işlem — GERÇEK kurulum (yalnız plan gözden geçirilip onaylandıktan
sonra):**

```powershell
.\install-services.ps1 -ApiDir C:\HasarBotu\services\api `
  -FileAgentDir C:\HasarBotu\services\file-agent `
  -WinSwExe C:\Tools\WinSW-x64.exe -Apply
```

**Beklenen çıktı:** `Kuruldu: hasarbotu-api`, `Kuruldu: hasarbotu-file-agent`.
Ardından secret/ortam değişkenleri (bkz. Adım 4) SERVİSLER
BAŞLATILMADAN önce ayarlanır.

**Durdurma ölçütü:** Herhangi bir ön koşul hatası varsa (`node.exe`
bulunamadı, `dist\index.js` yok, Postgres servisi yok) betik `exit 1` ile
durur; hiçbir servis kurulmaz (bkz. §7 test kanıtı).

**Doğrulama:** `Get-Service hasarbotu-api, hasarbotu-file-agent` her
ikisinin de kurulu (`Stopped` durumda, henüz başlatılmamış) olduğunu
gösterir. `sc.exe qc hasarbotu-file-agent` çıktısında
`DEPENDENCIES: hasarbotu-api` görünür.

**Audit kanıtı:** Kurulum komutunun tam çıktısı ve zaman damgası
kaydedilir.

## 4. Secret/ortam değişkenlerinin ayarlanması ve başlatma sırası

**Sahip:** Kurulumu yapan operatör (secret'lara erişimi olan).

**Ön koşul:** Adım 3 tamamlanmış; servisler kurulu ama DURDURULMUŞ.

**Komut/işlem (makine kapsamında, kalıcı; repo'ya/`.env`'e YAZILMAZ):**

```powershell
[Environment]::SetEnvironmentVariable('DATABASE_URL', '<gercek-deger>', 'Machine')
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_ID', '<gercek-deger>', 'Machine')
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_SECRET', '<gercek-deger>', 'Machine')
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_ROOTS', '{"baran-global-primary":"C:\\HasarBotuStorage\\BARAN GLOBAL EKSPERTIZ"}', 'Machine')
[Environment]::SetEnvironmentVariable('HASARBOTU_API_BASE_URL', 'http://127.0.0.1:3100', 'Machine')
```

Ardından **sıra ÖNEMLİDİR**:

```powershell
# 1) Postgres zaten Auto/Running olmalı (Adım 1).
Start-Service hasarbotu-api
Start-Sleep -Seconds 3
Invoke-RestMethod http://127.0.0.1:3100/health   # status "ok" bekleniyor
Start-Service hasarbotu-file-agent
```

**Beklenen çıktı:** `/health` yanıtı `{"status":"ok",...}`; File Agent
servisi `Running` durumuna geçer ve loglarında (`services\file-agent\logs\
hasarbotu-file-agent.out.log`) döngü hatası GÖRÜNMEZ.

**Durdurma ölçütü:** `/health` `degraded` dönerse File Agent yine de
BAŞLATILABİLİR (D4'ün kendi bekleme/yeniden deneme davranışı devreye
girer) ama kök nedeni (genellikle `DATABASE_URL`) araştırılmadan üretime
GEÇİLMEZ.

**Doğrulama:** `Get-Service hasarbotu-api, hasarbotu-file-agent` ikisi de
`Running`. File Agent logunda ilk döngüde `storage_unavailable` GÖRÜNMEZ
(görünürse Adım 2/2.5'e geri dönülür).

**Audit kanıtı:** Başlatma zaman damgaları ve `/health` yanıtı kaydedilir.

## 5. Planlı yeniden başlatma / kapatma sırası (ters sıra)

1. `Stop-Service hasarbotu-file-agent` — yürüyen iş varsa lease/heartbeat
   ile güvenle tamamlanır veya kurtarılabilir durumda bırakılır (D4).
2. `Stop-Service hasarbotu-api` — graceful shutdown (`SIGTERM`,
   `services/api/src/server.ts`), `stoptimeout` 15 sn.
3. Bakım biter bitmez ters sırayla başlat (Adım 4'teki sıra).

## 6. Deployment audit kaydı

Her çalıştırmada şu alanlar kaydedilir: tarih, operatör, hangi adımlar
çalıştırıldı, §1/§2.5/§3/§4'ün ekran çıktıları, karşılaşılan hata (varsa)
ve çözümü. Bu, `DEPLOYMENT_AND_OPERATIONS_PLAN.md` §5'in "her runbook ...
audit kanıtını içerir" kabul ölçütünü karşılar.

## 7. Bu pakette doğrulanan (gerçek kurulum OLMADAN)

- WinSW XML şablonları `scripts/check-windows-service-configs.mjs` ile
  otomatik doğrulandı: geçerli XML, gerekli elemanlar, doğru
  `<depend>` zinciri (api -> postgresql-x64-17; file-agent -> hasarbotu-api),
  şablonda secret/mutlak `P:\`/gerçek makine yolu YOK.
- `install-services.ps1`in sözdizimi (`PSParser`) ve ön koşul-hata
  yollarının doğru `exit 1` ile durduğu (Postgres servisi yokken,
  `dist\index.js` yokken) SENTETİK bir dizin yapısıyla test edildi;
  GERÇEK bir servis hiçbir zaman kurulmadı.
- `probe-p-drive-system-context.ps1` bu makinede GERÇEK yönetici
  yükseltmesiyle çalıştırıldı (HB-2026-110/111): `LastTaskResult=0`,
  P:\ SYSTEM'den görünüyor/okunabiliyor/yazılabiliyor/silinebiliyor;
  sürücü harfi `\GLOBAL??` ad alanında (EldoS CBFS), ACL `Everyone: tüm
  haklar`. Bu, TEK bir geliştirme makinesindeki sonuçtur — ofis
  dağıtım makinesinde Adım 2.5 olarak bağımsız doğrulanmalıdır (farklı
  pCloud sürümü/yapılandırması farklı sonuç verebilir).

## Açık kalan

- pCloud senkronize klasör geçişinin GERÇEK ofis verisiyle süresi ve
  disk alanı etkisi ölçülmedi (yalnız prosedür tanımlandı).
- WinSW ikili dosyasının bütünlük doğrulaması (checksum/imza) için kesin
  prosedür operatör kararına bırakıldı.
- TLS/sertifika (OPS-Q03) ve izleme (OPS-Q05) bu runbook'un kapsamı
  dışındadır; ayrı açık kararlardır.
