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

## 2a. Dry-run doğrulama planı (HB-2026-112 — gerçek veri taşınmadan, plan)

**Durum:** Bu bölüm bir PLANDIR; §2'nin GERÇEK yürütülmesinden ÖNCE her
adımın nasıl doğrulanacağını somutlaştırır. Bu paket kapsamında GERÇEK
veri taşıma veya WinSW kurulumu YAPILMADI — yalnız salt-okunur ölçüm ve
plan üretildi.

### 2a.1 Kapasite ön-kontrolü

**Sahip:** Kurulumu yapan operatör.

**Ölçüldü (bu makinede — DESKTOP-EFN2G33, GERÇEK ofis/dağıtım makinesi, salt-okunur, 2026-07-29 — bkz. HB-2026-115 düzeltmesi):**

```text
Kaynak: P:\BARAN GLOBAL EKSPERTİZ
  Dosya sayısı : 6.258
  Klasör sayısı: 603
  Toplam boyut : ~8,64 GB (9.279.237.358 bayt)
Hedef sürücü: C:\
  Toplam      : ~930,5 GB
  Boş alan    : ~726,3 GB (ÖLÇÜM ANINDA)
```

**Komut (tekrarlanabilir, salt-okunur):**

```powershell
$stats = Get-ChildItem -LiteralPath 'P:\BARAN GLOBAL EKSPERTİZ' -Recurse -File -ErrorAction Stop | Measure-Object -Property Length -Sum
$dirCount = (Get-ChildItem -LiteralPath 'P:\BARAN GLOBAL EKSPERTİZ' -Recurse -Directory -ErrorAction Stop | Measure-Object).Count
"Dosya: $($stats.Count)  Boyut(GB): $([math]::Round($stats.Sum/1GB,3))  Klasor: $dirCount"
Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" | Select-Object @{n='FreeGB';e={[math]::Round($_.FreeSpace/1GB,2)}}
```

**Beklenen çıktı:** Hedef sürücüde boş alan, kaynak toplam boyutun EN AZ
3 katı (senkronizasyon sırasında geçici çakışma + eski `P:\` kopyasının
paralel tutulma penceresi için pay) — bu makinede 8,64 GB × 3 ≈ 26 GB
gerekirken 726 GB müsait, kapasite SORUN DEĞİL.

**Durdurma ölçütü:** Boş alan < kaynak boyutu × 3 ise geçişe BAŞLANMAZ;
disk büyütme veya eski verinin arşivlenmesi ayrı karar gerektirir.

**DÜZELTME (HB-2026-115):** Önceki taslak bu makineyi "geliştirme/test"
olarak nitelendirip ölçümün ofis makinesinde tekrarlanmasını öneriyordu —
bu YANLIŞ VARSAYIMDI. DESKTOP-EFN2G33 **GERÇEK ofis/dağıtım makinesidir**;
yukarıdaki sayılar zaten GERÇEK üretim verisidir (`P:\BARAN GLOBAL
EKSPERTİZ` altında gerçek iş dosyaları, kimlik fotokopisi dahil gerçek
müşteri/personel verisi gözlemlendi — bkz. DECISION_LOG HB-2026-115).
Tekrar ölçüm GEREKMEZ; kapasite sonucu NİHAİDİR.

### 2a.2 Hedef ACL tasarımı (en-az-yetki — HB-2026-111 bulgusunun düzeltmesi)

**GÜNCELLEME (HB-2026-113, D6 kararı):** Aşağıdaki plan LocalSystem
varsayımıyla yazılmıştı ("açık mimari not" bunu zaten işaretlemişti).
D6 kararı bu varsayımı SÜPERSEDE eder: `NT AUTHORITY\SYSTEM` grantı
YERİNE §2c'deki adanmış `svc-hasarbotu-fileagent` hesabına Modify
verilir. Gerçek uygulamada §2c'nin ACL adımı esas alınır, aşağıdaki
`NT AUTHORITY\SYSTEM` satırı ARTIK GEÇERLİ DEĞİLDİR.

**Sahip:** Kurulumu yapan operatör (yönetici).

**Gerekçe:** HB-2026-111, `P:\` üzerinde `Everyone: tüm haklar` (tek ACE,
`-1`) tespit etti — en-az-yetki YOK. Yeni NTFS kökü, üst dizinden (`C:\`)
miras alınan geniş `BUILTIN\Users`/`Authenticated Users` haklarını
DEVRALMAMALI; yalnız gereken hesaplara açık, dar bir ACL almalı.

**Planlanan ACL (uygulanacak, henüz UYGULANMADI):**

```powershell
# Hedef klasör önce oluşturulur (pCloud senkron istemcisi de oluşturabilir —
# ikisi çakışırsa istemcinin kendi oluşturduğu klasör esas alınır).
$target = 'C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ'
icacls $target /inheritance:d                              # üst dizinden miras KESİLİR
icacls $target /remove 'BUILTIN\Users' 'NT AUTHORITY\Authenticated Users' 'Everyone' 2>$null
icacls $target /grant:r 'NT AUTHORITY\SYSTEM:(OI)(CI)F'     # File Agent servis hesabı (bkz. not)
icacls $target /grant:r 'BUILTIN\Administrators:(OI)(CI)F'  # IT/operatör bakım
```

**ÖNEMLİ açık mimari not:** `hasarbotu-file-agent.winsw.xml`de
`<serviceaccount>` TANIMLANMAMIŞ, yani WinSW varsayılanı olan
**LocalSystem** (= `NT AUTHORITY\SYSTEM`, tam olarak bu paketin probunun
kullandığı hesap) kullanılacaktır. Yukarıdaki ACL bu varsayımla
tasarlandı. LocalSystem makine genelinde zaten neredeyse sınırsız yetkiye
sahip olduğundan, klasör ACL'i tek başına "en-az-yetki"yi TAM sağlamaz —
File Agent'ı adanmış, düşük yetkili bir servis hesabı altında çalıştırıp
ACL'i O HESABA daraltmak daha güçlü bir savunma katmanı olurdu. Bu,
WinSW şablonunu ve servis kurulum kararını etkileyen AYRI bir mimari
karardır; bu planın kapsamında DEĞİŞTİRİLMEDİ, yalnız açık öneri olarak
kaydedildi.

**Doğrulama:** `icacls $target` çıktısında yalnız SYSTEM + Administrators
(+ varsa açıkça eklenen adlandırılmış operatör hesapları) görünmeli;
`Everyone`/`BUILTIN\Users`/`Authenticated Users` OLMAMALI.

**Durdurma ölçütü:** ACL uygulaması sonrası File Agent'ın (SYSTEM hesabı)
hedef kökte GERÇEK yazma/silme yapabildiği §2.5'in `-IncludeWriteAndAclProbe`
anahtarıyla (bkz. `probe-p-drive-system-context.ps1 -DriveLetter C`... not:
bu anahtar sürücü harfi değil TAM YOL da destekleyecek şekilde ayrı bir
doğrulama gerektirebilir — TEK dosya/silme testi için basit bir
`Test-Path`/`New-Item`/`Remove-Item` PROBU yeterlidir) doğrulanmadan
servis BAŞLATILMAZ.

### 2a.3 Dosya/hash karşılaştırma metodolojisi

**Sahip:** Kurulumu yapan operatör.

**Ölçek gerekçesi:** Bu makinede ölçülen ~6.258 dosya/~8,64 GB ölçeğinde
TAM (örnekleme değil) SHA-256 karşılaştırması hesaplama açısından
UCUZDUR (dakikalar mertebesinde); bu yüzden istatistiksel örnekleme YERİNE
tam karşılaştırma ÖNERİLİR. Ofis üretim verisi çok daha büyükse (örn.
100 GB+) bu eşik yeniden değerlendirilip katmanlı (önce sayı/boyut, sonra
istatistiksel örnekleme, sonra tam hash) bir yaklaşıma geçilebilir.

**İki aşamalı doğrulama (her ikisi de GEÇMELİ):**

```powershell
# Aşama A — ucuz: dosya sayısı + toplam boyut (her iki kökte)
function Get-FolderStats($path) {
    $s = Get-ChildItem -LiteralPath $path -Recurse -File -ErrorAction Stop | Measure-Object -Property Length -Sum
    [pscustomobject]@{ Count = $s.Count; Bytes = $s.Sum }
}
$old = Get-FolderStats 'P:\BARAN GLOBAL EKSPERTİZ'
$new = Get-FolderStats 'C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ'
"Eski: $($old.Count) dosya / $($old.Bytes) bayt"
"Yeni: $($new.Count) dosya / $($new.Bytes) bayt"
$old.Count -eq $new.Count -and $old.Bytes -eq $new.Bytes   # True olmalı

# Aşama B — tam: her dosyanın göreli-yol eşleştirilmiş SHA-256'sı
$oldRoot = 'P:\BARAN GLOBAL EKSPERTİZ'
$newRoot = 'C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ'
$oldHashes = Get-ChildItem -LiteralPath $oldRoot -Recurse -File | ForEach-Object {
    [pscustomobject]@{ Rel = $_.FullName.Substring($oldRoot.Length); Hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash }
}
$newHashes = Get-ChildItem -LiteralPath $newRoot -Recurse -File | ForEach-Object {
    [pscustomobject]@{ Rel = $_.FullName.Substring($newRoot.Length); Hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash }
}
$oldMap = @{}; foreach ($h in $oldHashes) { $oldMap[$h.Rel] = $h.Hash }
$newMap = @{}; foreach ($h in $newHashes) { $newMap[$h.Rel] = $h.Hash }
$mismatches = foreach ($rel in $oldMap.Keys) {
    if (-not $newMap.ContainsKey($rel)) { "EKSİK (yeni kökte yok): $rel" }
    elseif ($newMap[$rel] -ne $oldMap[$rel]) { "HASH UYUŞMUYOR: $rel" }
}
$extras = foreach ($rel in $newMap.Keys) { if (-not $oldMap.ContainsKey($rel)) { "FAZLA (eski kökte yok): $rel" } }
$mismatches + $extras   # BOŞ olmalı
```

Karşılaştırma çıktısı (yalnız göreli yol + hash, GERÇEK dosya İÇERİĞİ
DEĞİL) `C:\ProgramData\HasarBotu\probe\` altına zaman damgalı bir dosyaya
yazılıp kalıcı audit kanıtı olarak tutulur (mevcut SYSTEM probu ile AYNI
konvansiyon) — bu dosya repository'ye COMMIT EDİLMEZ (gerçek göreli
yol/dosya adları müşteri verisi izi taşıyabilir).

**Beklenen çıktı:** Aşama A `True`, Aşama B `$mismatches`/`$extras` BOŞ
dizi.

**Durdurma ölçütü:** Herhangi bir eksik/fazla/hash-uyuşmazlığı VARSA
`HASARBOTU_AGENT_ROOTS` DEĞİŞTİRİLMEZ, File Agent eski `P:\` kökünde
kalmaya devam eder; fark araştırılır (genellikle senkronizasyon henüz
TAMAMLANMAMIŞTIR — pCloud'un kendi senkron durumu göstergesi kontrol
edilir).

### 2a.4 `HASARBOTU_AGENT_ROOTS` değişimi (yalnız 2a.1–2a.3 TAMAMEN GEÇTİKTEN sonra)

Değişim, mevcut §4'teki tek satırla AYNIDIR (rootKey `baran-global-primary`
DEĞİŞMEZ — veritabanında hiçbir satır güncellenmez, yalnız bu makine
ortam değişkeni):

```powershell
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_ROOTS', '{"baran-global-primary":"C:\\HasarBotuStorage\\BARAN GLOBAL EKSPERTİZ"}', 'Machine')
Restart-Service hasarbotu-file-agent   # makine ortam değişkeni yalnız süreç BAŞLARKEN okunur
```

**Doğrulama:** Değişimden sonra ilk döngüde File Agent logunda
`storage_unavailable`/`PENDING_STORAGE` GÖRÜNMEZ (D4); §2.5'teki SYSTEM
probu yeni yol (`C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ`) için
`PASS` verir.

### 2a.5 Rollback planı

**Tetikleyici koşullar:** 2a.3'ün hash karşılaştırması geçiş SONRASI
(örn. gecikmeli pCloud senkron farkı nedeniyle) tekrar çalıştırıldığında
uyuşmazlık bulunması; File Agent'ın kök sağlık probunun (D4) yeni kökte
`storage_unavailable` bildirmesi; operatörün gözlemlediği herhangi bir
veri tutarsızlığı.

**Rollback GERİ DÖNÜŞÜ tek bir ortam değişkeni + servis yeniden başlatmadır
(veritabanı DEĞİŞMEZ, çünkü yalnız `rootKey` + göreli yol saklanır —
`FILE_STORAGE_AND_AGENT_PLAN.md` §2):**

```powershell
Stop-Service hasarbotu-file-agent
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_ROOTS', '{"baran-global-primary":"P:\\BARAN GLOBAL EKSPERTİZ"}', 'Machine')
Start-Service hasarbotu-file-agent
# Eski kökün hâlâ çalıştığını kanıtla:
.\probe-p-drive-system-context.ps1 -DriveLetter P
```

**Ön koşul (geri dönüşün MÜMKÜN olması için):** Eski `P:\` sürücüsü,
geçişten sonra EN AZ 14 gün (öneri; kesin süre kullanıcı kararı) DEĞİŞTİRİLMEDEN
salt-okunur referans olarak tutulur — pCloud "Senkronize Klasör" moduna
geçilse bile istemci hesabı aynı kalır, geçmiş veri pCloud bulutunda
zaten durur; yerel `P:\` kopyasının silinmesi AYRI, açıkça onaylanmış bir
adımdır, bu planın parçası DEĞİLDİR.

**Audit kanıtı:** Rollback'in tarihi, tetikleyen bulgu ve komut çıktısı
DECISION_LOG/deployment audit kaydına eklenir.

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

## 2c. File Agent servis hesabı + WinSW kurulumu — D6 (HB-2026-113…119): GERÇEKTEN KURULDU (bu makinede, DESKTOP-EFN2G33)

**Durum:** `deploy/windows-service/setup-file-agent-service-account.ps1`
GERÇEK `-Apply` ile bu makinede ÇALIŞTIRILDI ve BAŞARILI oldu
(HB-2026-119, 2026-07-29 — 12 gerçek deneme, önceki 11'i çeşitli gerçek
kusurlar nedeniyle atomik olarak geri alındı, bkz. DECISION_LOG
HB-2026-118). Gerçek ve KALICI olarak kurulu: yerel hesap
`svc-hb-fileagent`, LSA hakları (`SeServiceLogonRight` +iki deny hakkı),
üç ACL (depolama kökü/uygulama dizini/log dizini), WinSW servisi
`hasarbotu-file-agent` (**`Disabled`, `Stopped` — hiç başlatılmadı**).
Aşağıdaki adımlar artık GERÇEKLEŞTİRİLMİŞ referans olarak okunmalıdır;
araç sentetik+gerçek-hedef senaryolarla önceden test edilmişti (bkz.
DECISION_LOG HB-2026-114/115/116/117), SON adım (SCM kimlik bilgisi)
`ChangeServiceConfigW`in bu makinede tutarlı biçimde başarısız olması
üzerine kullanıcı onayıyla `sc.exe config`e döndürüldü (HB-2026-118/119)
— geri kalan her şey doğrudan Win32 API ile kaldı. **`HASARBOTU_AGENT_ROOTS`
değişikliği, servisi etkinleştirme/başlatma ve gerçek pCloud→NTFS veri
geçişi HÂLÂ AYRI, onaylanmamış adımlardır.**

**Sahip:** Kurulumu yapan operatör (yönetici).

**Ön koşul:** §2/§2a (senkron klasör geçişi) tamamlanmış; hedef kök
`C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ` mevcut; File Agent
`dist\index.js` build edilmiş (`npm run build --workspace @hasarbotu/file-agent`);
WinSW ikili dosyası önceden indirilmiş (bkz. §3 ön koşulu).

**Gerekçe:** WinSW'nin varsayılanı (serviceaccount tanımlanmazsa)
**LocalSystem**dir — HB-2026-111'in ölçtüğü gibi bu hesap makine genelinde
neredeyse sınırsız yetkiye sahiptir; klasör ACL'i tek başına en-az-yetkiyi
SAĞLAMAZ. `DEPLOYMENT_AND_OPERATIONS_PLAN.md` §2.3 zaten "File Agent
hesabına yalnız tanımlı depolama kökünde gereken yetki verilir" ilkesini
BELGELİYORDU; bu araç o ilkeyi uygulayan somut kodu sağlar.

**Komut/işlem — önce ÖNİZLEME (hiçbir değişiklik yapmaz):**

```powershell
cd deploy\windows-service
.\setup-file-agent-service-account.ps1 -FileAgentAppDir C:\HasarBotu\services\file-agent
```

Bu, mevcut durumu (hesap var mı, haklar var mı, ACL uygun mu, WinSW
servisi kurulu mu/`Disabled` mi) okur ve YAPILACAK adımları yazdırır —
hiçbir hesap/ACL/dosya/servis DEĞİŞMEZ.

**Komut/işlem — GERÇEK uygulama (yalnız önizleme gözden geçirilip
onaylandıktan sonra, D6'nın gerçek yürütülmesinde; PAROLA OPERATÖRDEN
ALINMAZ — betik kendi üretir):**

```powershell
.\setup-file-agent-service-account.ps1 -FileAgentAppDir C:\HasarBotu\services\file-agent `
    -WinSwExe C:\Tools\WinSW-x64.exe `
    -PCloudSyncAccount 'DESKTOP-EFN2G33\<pCloud'u çalıştıran gerçek kullanıcı>' `
    -Apply
```

`-PCloudSyncAccount` varsayılanı BU KOMUTU ÇALIŞTIRAN oturumun kendisidir
(`$env:COMPUTERNAME\$env:USERNAME`) — GERÇEK kurulumda pCloud'u çalıştıran
hesap FARKLI bir operatör/hizmet hesabı olabilir; bu durumda parametre
AÇIKÇA verilmelidir (varsayılana güvenilmemelidir).

Bu TEK komut şunları ATOMIK olarak yapar (kod:
`setup-file-agent-service-account.ps1`; herhangi bir adım başarısız
olursa TÜMÜ geri alınır):

1. **Parolayı BİR KEZ üretir** (kriptografik RNG, 32 bayt), yalnız
   `SecureString` olarak bellekte tutar. Operatör parolayı GÖRMEZ/
   GİRMEZ; hesap yalnız "Log on as a service" için kullanılır, hiçbir
   insan ona etkileşimli giriş yapmadığı için parolanın bilinmesi
   GEREKMEZ. Rotasyon = betiği tekrar `-Apply` ile çalıştırmaktır.
2. **Hesabı oluşturur** (yoksa `New-LocalUser`; varsa `Set-LocalUser` ile
   parolayı YENİLER — SCM ile senkron kalması için), yerel `Users`
   grubundan ÇIKARIR. *Geri alma: yeni oluşturulduysa `Remove-LocalUser`;
   önceden vardıysa hesap SİLİNMEZ (yalnız parolası değişmiş kalır — eski
   parola zaten bilinmiyordu, geri alınacak bir "eski hâl" YOKTUR).*
3. **"Log on as a service" hakkını (`SeServiceLogonRight`) VERİR** —
   kendi LSA `LsaAddAccountRights` P/Invoke'u ile (ek dependency
   GEREKTİRMEZ). *Geri alma: `LsaRemoveAccountRights`.*
4. **Etkileşimli/RDP oturumunu YASAKLAR** — `SeDenyInteractiveLogonRight`
   + `SeDenyRemoteInteractiveLogonRight` (ZORUNLU, atlanmaz).
5. **Hedef depolama kökünde miras keser; servis hesabına Modify,
   `-PCloudSyncAccount`e (HB-2026-115) de Modify, Administrators'a Full
   Control verir** (.NET `FileSystemAccessRule` ile). *Geri alma:
   ÖNCEKİ ACL, değişiklikten önce yakalanıp aynen geri yazılır (miras
   durumu dahil) — scratch-klasörde gerçek test edildi.*
6. **Uygulama dizininde Read+Execute, yalnız `logs` alt dizininde
   Modify** verir. *Geri alma: aynı ACL-restore deseni; `logs` dizini
   bu adımda YENİ oluşturulduysa TAMAMEN silinir.*
7. **GERÇEK WinSW kurulumu:** WinSW ikilisini `$FileAgentAppDir`e
   kopyalar, şablonu (`hasarbotu-file-agent.winsw.xml` — repo'daki GERÇEK
   dosya, hiçbir zaman değiştirilmez, yalnız okunur) `__NODE_EXE__`/
   `__APP_DIR__` yer tutucularını çözerek render eder, `<serviceaccount>`
   kimliğini (PAROLASIZ) ekler, `<exe> install` çalıştırır. *Geri alma:
   kopyalanan ikili/render edilmiş XML silinir; servis kurulduysa
   `<exe> uninstall`.*
8. **SCM oturum açma kimlik bilgisini ayarlar — HB-2026-117: `sc.exe`
   KULLANILMAZ.** Doğrudan Win32 SCM API'si (`ChangeServiceConfigW`,
   `advapi32.dll`) bu sürecin İÇİNDEN çağrılır — `sc.exe` gibi bir ÇOCUK
   SÜREÇ hiç başlatılmaz, bu yüzden parola bir komut satırı argümanında
   (argv) HİÇBİR ZAMAN görünmez (aksi hâlde çalıştığı kısa süre boyunca
   başka bir sürecin — WMI `Win32_Process`, denetim/audit araçları —
   komut satırını okuyabilmesi riski olurdu). Parola yalnız geçici,
   yönetilmeyen (unmanaged) bir bellek arabelleğine (`Marshal.
   SecureStringToGlobalAllocUnicode`) çözülüp API'ye HAM POINTER olarak
   geçer; çağrı biter bitmez `Marshal.ZeroFreeGlobalAllocUnicode` ile
   ÖNCE SIFIRLANIR SONRA serbest bırakılır. **Hiçbir dosyaya/argv'ye/
   ortam değişkenine/log'a/repository'ye YAZILMAZ**.
9. **Servis başlangıç türünü `Disabled` yapar ve BAŞLATMAZ** — servisi
   etkinleştirme/başlatma bu betiğin KAPSAMI DIŞINDADIR, ayrı, açıkça
   onaylanmış bir adımdır.
10. Tüm adımlardan SONRA her şeyi YENİDEN OKUYUP doğrular (hesap hakları,
    üç ACL, WinSW kimliği, servis kurulu+`Disabled`+çalışmıyor); herhangi
    biri başarısızsa bu da bir HATA sayılır ve TÜM işlem geri alınır.

**Beklenen çıktı:** `SONUÇ: Tüm adımlar ATOMIK olarak başarılı. Servis
kuruldu, DISABLED, BAŞLATILMADI.` ve çıkış kodu `0`.

**Durdurma ölçütü:** `-Apply` yükseltme OLMADAN, `-WinSwExe` VERİLMEDEN
veya `$ServiceName` servisi ZATEN kuruluyken çağrılırsa betik `exit 2`
ile durur, HİÇBİR değişiklik yapmaz (gerçekten test edildi — bkz.
DECISION_LOG HB-2026-116, ayrıca bir `Write-Error`/global
`$ErrorActionPreference=Stop` etkileşim hatası bulunup düzeltildi: önceki
sürüm bu durumlarda yanlışlıkla çıkış kodu `2` yerine `1` veriyordu).
Adımlardan HERHANGİ biri (ACL, WinSW kurulumu, SCM kimlik bilgisi,
doğrulama) başarısız olursa TÜM işlem geri alınır ve `exit 1` ile
biter — servis §3'e İLERLETİLMEZ.

**Doğrulama (betiğin kendisi son adımda otomatik yapar; elle tekrarlamak
için):**

```powershell
runas /user:svc-hasarbotu-fileagent cmd   # AÇIKÇA reddedilmeli (etkileşimli giriş yasak)
icacls 'C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ'   # svc-hasarbotu-fileagent:(M), <pCloud hesabı>:(M), Administrators:(F) - başka HİÇBİR şey
Get-Service hasarbotu-file-agent   # StartType=Disabled, Status != Running
```

**Audit kanıtı:** Betiğin tam ekran çıktısı (durum + plan + uygulama +
doğrulama VEYA hata + geri alma) deployment audit kaydına (§6) eklenir.
Parolanın KENDİSİ hiçbir zaman audit kaydına/log'a/repository'ye
YAZILMAZ; işlem bittikten sonra parolayı bilen hiçbir kayıt kalmaz
(kasıtlı — bkz. DECISION_LOG HB-2026-116).

## 2d. D7 salt-okunur senkron klasör geçiş preflight'ı — HB-2026-121

**Güncel durum (2026-07-31, bu makinede GERÇEK ölçüm): `BeforeSync PASS/0`;**
hedef senkronizasyonu ve `AfterSync` henüz yapılmadı. Aşağıdaki ilk
`BLOCKED` ölçümü tarihsel tanı kanıtıdır; güncel exact exclusion sonucu
§2d.6'da kayıtlıdır.

Bu adımda veri kopyalanmadı, pCloud ayarı değiştirilmedi,
`HASARBOTU_AGENT_ROOTS` yazılmadı ve hiçbir servis başlatılmadı.
`hasarbotu-file-agent` ölçüm sonunda da `Disabled` + `Stopped`, makine ve
süreç kapsamlı `HASARBOTU_AGENT_ROOTS` değerleri de tanımsız kaldı.

### 2d.1 Salt-okunur araç

```powershell
Set-Location -LiteralPath '<repository-root>'

# Operatör, admin-only kanıt paketindeki exact manifesti seçer.
# Manifestin tam yolu repo'ya, komut çıktısına veya genel loga yazılmaz.
$ghostManifest = '<Administrators-only exact exclusion manifesti>'

# pCloud sync ayarı yapılmadan ÖNCE:
.\deploy\windows-service\test-storage-sync-migration-preflight.ps1 `
  -Stage BeforeSync `
  -GhostExclusionManifestPath $ghostManifest

# pCloud hedefi tamamen senkronize ettikten SONRA, fakat
# HASARBOTU_AGENT_ROOTS/servis değişiminden ÖNCE:
$beforeSyncReport = '<Administrators-only BeforeSync PASS raporu>'
$beforeSyncReportSha256 = '<raporun doğrulanmış SHA-256 değeri>'
.\deploy\windows-service\test-storage-sync-migration-preflight.ps1 `
  -Stage AfterSync `
  -GhostExclusionManifestPath $ghostManifest `
  -BeforeSyncReportPath $beforeSyncReport `
  -BeforeSyncReportSha256 $beforeSyncReportSha256
```

Araç `storage-sync-migration-preflight/1.2.0` JSON özeti üretir. Mevcut
`1.1.0` `BeforeSync PASS` raporunu baseline olarak kabul eder:

- kaynak/hedef dosya, klasör, bayt ve reparse-point sayısı,
- hedef sürücü toplam/boş alanı ve kaynak boyutunun 3 katı kapasite kapısı,
- her iki aşamada hashli/Administrators-only manifest, strict 10 kayıt,
  exact path ve canlı yerel pCloud DB fileId+metadata bağının doğrulanması,
- `BeforeSync`te yalnız bu 10 exact ghost kayıt dışındaki **her dosyanın**
  SHA-256 ile gerçek okunabilirliği,
- `AfterSync`te iki kökün göreli-yol eşlemeli **tam** SHA-256
  karşılaştırması,
- `AfterSync`te güncel kaynak tam manifestinin hashli `BeforeSync PASS`
  baseline'ıyla değişmeden kalması; böylece senkron sırasında iki tarafın
  birlikte eksilmesi/değişmesi de fail-closed yakalanır,
- tarama başı/sonu envanter farkı ve snapshot kararlılığı,
- yalnız güvenli hata kodu/sayısı; dosya adı, göreli/mutlak yol ve ham hata
  metni YOKTUR.

Wildcard, uzantı veya klasör bazlı exclusion kabul edilmez. Manifest yoksa,
hash/ACL doğrulanmazsa, 10'lu küme değişirse ya da fileId/metadata bağı
koparsa kaynak taraması başlamadan fail-closed durur. Araç kaynak/hedefte
kanıt veya temp dosyası oluşturmaz; ACL, registry, ortam değişkeni, pCloud
ve servis durumuna yazmaz. `0=pass`, `2=blocked`, `1=araç/önkoşul hatası`dır.

### 2d.2 Ölçülen envanter ve kapasite

Tam hash başlangıcındaki salt-okunur envanter:

```text
Kaynak:
  Dosya       : 6.363
  Klasör      : 623
  Boyut       : 9.324.951.196 bayt
  Reparse     : 0

Hedef:
  Dosya       : 0
  Klasör      : 0
  Boyut       : 0 bayt
  Boş         : Evet
  Reparse     : 0

C:\ (hash çalışmasının ölçüm anı):
  Toplam      : 999.124.103.168 bayt
  Boş         : 780.604.567.552 bayt
  3x gereken  : 27.974.853.588 bayt
  Kapasite    : PASS
```

Hedef NTFS, reparse point değil ve D6'daki dar ACL'i koruyor: yalnız
Administrators `FullControl`, pCloud'u çalıştıran kullanıcı `Modify` ve
`svc-hb-fileagent` `Modify`; miras kapalı.

Önceki 2026-07-29 ölçümüne göre kaynak büyümüştür (6.258 → 6.363 dosya,
9.279.237.358 → 9.324.951.196 bayt). Bu nedenle eski envanter artık geçiş
kanıtı değildir; her gerçek deneme güncel ölçümle başlamalıdır.

### 2d.3 pCloud yapılandırma sonucu

- pCloud `5.1.8.0` etkileşimli kullanıcı oturumunda çalışıyor ve otomatik
  başlangıç kaydı mevcut.
- Registry `SyncDrive=P:\`; `P:` hâlâ `pCloud Drive`, `DriveType=2`,
  `exFAT` sanal sürücüdür.
- Canlı pCloud DB kilitli olduğu için yazma/kopya/servis durdurma yapılmadan,
  güncel base DB yalnız `mode=ro&immutable=1` ile okundu. `syncfolder=0`,
  `syncfolderdelayed=0`; hedef için kayıt yoktu. Registry, boş hedef ve
  logda hedef izi bulunmaması da aynı sonucu destekliyor.
- Windows UI otomasyon bağlantısı bu oturumda açılamadığı için pCloud
  ekranındaki menü görsel olarak doğrulanamadı. Ancak mevcut yerel
  yapılandırmanın hedef senkron klasöre geçirilmediği yukarıdaki bağımsız
  salt-okunur kanıtlarla uyumludur.

Sonuç: pCloud ayarı **henüz sanal sürücü modundadır**; hedef senkron klasör
olarak yapılandırılmamıştır. D7 preflight bunu değiştirmez.

### 2d.4 Tam SHA-256 sonucu ve durdurma kararı

Gerçek `BeforeSync` çalışması 5 dakika 49 saniye sürdü:

```text
Başlangıç dosyası : 6.363
Hashlenen          : 6.353
G/Ç hatası         : 10
Manifest SHA-256   : ÜRETİLMEDİ (fail-closed)
Kaynak snapshot    : KARARSIZ
Hedef snapshot     : KARARLI / BOŞ
Çıkış              : 2 / blocked
Blocker            : SOURCE_FULL_HASH_INCOMPLETE
Blocker            : SOURCE_CHANGED_DURING_PREFLIGHT
```

Tarama hemen sonrasında kaynak 6.398 dosya / 9.330.146.392 bayt olarak
yeniden ölçüldü; tarama sırasında 35 dosya ve 5.195.196 bayt eklenmiştir.
Bu, kaynakta gerçek yazma/üretim etkinliği bulunduğunu kanıtlar. Tam hash
okuması ayrıca pCloud önbelleği nedeniyle C: boş alanını ölçüm boyunca
değiştirebilir; kapasite payı yine çok yüksektir.

**Bu tarihsel koşuda durdurma ölçütü tetiklendi:** 10 G/Ç hatası çözülmeden ve kaynak yazımları
kontrollü bir bakım penceresinde durdurulup `BeforeSync` tek ve kararlı
snapshot üzerinde `pass/0` vermeden pCloud hedef senkronizasyonu
başlatılmaz. Daha sonra `AfterSync` için sayı+boyut+tam SHA-256
`pass/0` olmadan `HASARBOTU_AGENT_ROOTS` değiştirilmez ve File Agent
etkinleştirilmez/başlatılmaz.

### 2d.5 On `IO_ERROR` için salt-okunur yerel operatör tanılaması — HB-2026-122

2026-07-31 gerçek tanılama sonucu:

```text
İlk hata sayısı                  : 10 / beklenenle eşleşti
Kök hata türü                    : System.IO.IOException
HResult                          : 0x8007045D
Win32/native kod                 : 1117 (ERROR_IO_DEVICE)
Sınıf                            : io_device_error_persistent (10/10)
Offline/recall                    : 0
Dosya/üst dizin reparse           : 0
Paylaşım/erişim kilidi            : 0
260 karakter sınırını aşan yol    : 0
255 karakteri aşan yol bileşeni   : 0
Yeniden okumayla düzelen          : 0
Üç yeniden okumadan sonra kalıcı  : 10
```

Her üç yeniden okuma turunda da 10 dosyanın 0'ı okunabildi; 10'u aynı
`System.IO.IOException / 0x8007045D / 1117` sonucu verdi. Sıfır baytlık,
paylaşımlı erişim kontrolü 10/10 dosyada açılabildi; bu nedenle bulgu bir
paylaşım/erişim kilidi olarak sınıflandırılmadı. Tam yollar 112–144 karakter,
en uzun bileşen 64 karakterdi. Makine genelinde `LongPathsEnabled=false`
olmasına rağmen ölçülen yollar eski `MAX_PATH` veya bileşen sınırını aşmadığı
için yol uzunluğu neden değildir. On kaydın tamamı `Hidden` öznitelikli
`.tmp` dosyasıdır; adları ve yolları repo/özet çıktısına alınmaz.

Bu ölçüm dosya bozulmasını tek başına kanıtlamaz. Kanıtlanan durum, pCloud
sanal sürücüsünde aynı 10 nesnenin metadata ve paylaşım erişimi bulunmasına
rağmen tam veri okumasının dört denemenin tamamında aygıt G/Ç hatasıyla
kalıcı biçimde başarısız olmasıdır. D7 `BLOCKED` kalır.

Kalıcı araç:
`deploy/windows-service/invoke-storage-source-io-diagnostic.ps1`.
Araç kaynakta yalnız okuma yapar; pCloud, hedef, registry, ortam değişkeni
veya servis durumunu değiştirmez. Hassas dosya adları, göreli/tam yollar ve
hata bağlamı yalnız
`C:\ProgramData\HasarBotu\migration-preflight\source-io-diagnostic-20260731T071919716Z-556e9a93.json`
içindedir. Bu klasör ve rapor mirası kapalı, sahibi
`BUILTIN\Administrators`, tek ACE'si `S-1-5-32-544 FullControl` olacak
şekilde doğrulandı. Önceki iki `1.0.0` tanılama raporu da aynı ACL altında
tutulur; yetkili kayıt `storage-source-io-diagnostic/1.0.1` şemalı dosyadır.

Bakım penceresinde, yükseltilmiş Windows PowerShell ile repository kökünde,
kaynağa yazan iş süreçleri durduktan sonra çalıştırılacak kesin komut:

```powershell
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File ".\deploy\windows-service\invoke-storage-source-io-diagnostic.ps1" `
  -ExpectedInitialErrorCount 10 `
  -RetryDelayMilliseconds 1500 `
  -ProgressInterval 500
```

HB-2026-122'deki `ActualInitialErrorCount=0` ölçütü tarihsel genel kuraldır.
HB-2026-123 bunu yalnız kanıtlanmış 10 exact path/fileId kaydı için daraltır;
bu küme dışındaki tek okuma hatası veya kümedeki tek değişiklik yine blokerdir.
Güncel aynı yazmasız bakım penceresi komutu:

```powershell
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File ".\deploy\windows-service\test-storage-sync-migration-preflight.ps1" `
  -Stage BeforeSync `
  -GhostExclusionManifestPath $ghostManifest `
  -ProgressInterval 500
```

### 2d.6 Exact ghost exclusion ve güncel `BeforeSync` sonucu — HB-2026-123

- Admin-only kanıt zincirindeki 10 kayıt sunucuda `MISSING`, yerelde
  `stale_temp_candidate` olarak doğrulandı; F01 revision farkı `PASS` ile
  kapandı. Path/fileId değerleri yalnız korumalı manifesttedir.
- Exclusion manifesti tam 10 exact path/fileId kaydı taşır. Wildcard,
  uzantı veya klasör kuralı yoktur. Manifest ve SHA-256 sidecar mirası
  kapalı, owner/tek ACE Administrators FullControl olarak doğrulandı.
- Araç manifest olmadan `GHOST_EXCLUSION_MANIFEST_REQUIRED` ile hash
  taramasından önce durdu. Geçerli manifest 10/10 exact path ve 10/10
  salt-okunur yerel pCloud DB metadata bağı verdi.
- Gerçek tekrar koşusu: 6.404 gözlenen metadata girdisi, 10 exact exclusion,
  6.394/6.394 başarılı SHA-256, 0 hash hatası, kararlı kaynak snapshot,
  boş hedef, geçen kapasite kapısı ve sıfır blocker. Sonuç `PASS/0`.
- Veri kopyalanmadı; pCloud ayarı, registry/env ve servis durumu değişmedi.

Sonraki adım ayrı operatör onayıyla hedef senkron klasörünü yapılandırıp
tam senkronizasyonu beklemektir. Ardından aynı manifestle `AfterSync`
sayı+boyut+tam SHA-256 `PASS/0` olmadan ortam veya servis geçişi yapılmaz.

## 2e. D8 pCloud → NTFS uygulama önizlemesi — HB-2026-124

**Durum (2026-07-31): `PREVIEW_READY / NOT_EXECUTED`.** Bu bölüm yalnız
gelecekteki operatör uygulamasının fail-closed önizlemesidir. Bu çalışmada
pCloud ayarı açılmadı/değiştirilmedi; dosya kopyalanmadı, silinmedi,
taşınmadı veya yeniden adlandırılmadı; ortam değişkeni ve servis durumu
değişmedi.

### 2e.1 Güncel pCloud davranışı ve risk kararı

Resmi pCloud kaynakları (2026-07-31'de yeniden doğrulandı):

- [Offline Access / Sync](https://help.pcloud.com/article/offline-access):
  masaüstü Sync **iki yönlüdür**; iki taraftaki değişiklikler birbirine
  yansır. Windows/macOS için mevcut bulut klasöründen yerel kopya oluşturma,
  Linux için de açıkça mevcut bulut klasörünü boş yerel klasöre bağlama
  anlatılır. Aynı sayfa bağlantıyı durdurmak için Sync sekmesindeki `Stop`
  düğmesini belirtir.
- [Windows release notes](https://www.pcloud.com/release-notes/windows.html):
  bu makinedeki `5.1.8.0`, 23 Temmuz 2026 tarihli güncel Windows sürümüdür.
- [File recovery and history](https://help.pcloud.com/article/file-recovery-and-history):
  Trash/Revisions/Rewind koruması hesap planına göre 15/30/365 gündür;
  kalıcı silme veya süre aşımı geri alınamaz.

**Karar:** Mevcut bulut klasörü + gerçekten boş yerel klasör eşlemesi,
pCloud'un desteklediği yerel kopya başlangıç desenidir. Boş hedefin ilk
bağlantıda bulutu silmesi beklenen davranış değildir. Buna rağmen bağlantı
kurulduğu andan sonra iki yönlüdür: hedefte yapılan silme/değişiklik de
buluta yansıyabilir. Bu son cümle, pCloud'un “iki taraftaki değişiklikler
yansır” sözleşmesinden çıkan güvenlik sonucudur; Sync tek yönlü indirme
veya salt-okunur mirror olarak kabul edilmez.

Bu makinedeki salt-okunur güncel kanıt:

- pCloud `5.1.8.0` çalışıyor; yerel DB'de `syncfolder=0` ve
  `syncfolderdelayed=0`.
- Hedef mevcut, reparse point değil ve tamamen boş; dar üç ACE'li D6 ACL'i
  korunuyor.
- D7 `BeforeSync PASS/0`: 6.404 gözlenen kaydın yalnız doğrulanmış 10 exact
  ghost kaydı dışlandı; 6.394/6.394 etkili dosya tam SHA-256 ile okundu,
  hash hatası ve blocker yoktu.
- File Agent `Stopped + Disabled`; süreç/kullanıcı/makine kapsamlarında
  `HASARBOTU_AGENT_ROOTS` tanımsız.

Yerel DB'deki `0` sync kaydı yalnız **bu istemciyi** kanıtlar. Başka bir
cihazdaki sync veya açık dosya/yazma faaliyeti buradan görülemez. Gerçek
başlangıçtan önce bütün yazarların ve diğer istemcilerin bakım penceresine
alınması zorunludur.

### 2e.2 Güvenli başlangıç — gelecekteki uygulama sırası

1. Bütün pCloud/iş uygulaması yazarlarını ve diğer cihazları bakım
   penceresine al; bulut kökünde yeni yazma olmayacağını doğrula.
2. Aynı exact exclusion manifestiyle **taze** `BeforeSync` çalıştır.
   `PASS/0`, kararlı kaynak, boş hedef, 0 hash hatası ve 0 blocker yoksa
   dur. JSON raporu Administrators-only tut ve rapor SHA-256'sını ayrı
   doğrula. Eski PASS yalnız tarihsel kanıttır; kaynak değişebileceği için
   gerçek başlangıçta yeniden alınır.
3. Hedefin hâlâ 0 dosya/0 klasör/0 bayt olduğunu; pCloud yerel DB'sinde
   hâlâ sync kaydı olmadığını; File Agent/env durumunun değişmediğini
   salt-okunur doğrula.
4. pCloud `Sync` sekmesinde `Add new sync` seç. Yerel taraf için doğrulanmış
   **boş NTFS hedefi**, bulut tarafı için **mevcut bulut kökünü** seç.
   `Backup` veya `Uploads` seçme. Onay ekranında iki kökü tekrar kontrol et.
5. `Add Sync` tek değişiklik/başlatma noktasıdır. Yalnız ayrı açık operatör
   onayıyla bir kez tıkla. Sonrasında yerel hedefte Explorer, script veya
   uygulamayla hiçbir oluşturma/silme/yeniden adlandırma yapma.
6. pCloud aktarım kuyruğu tamamen bitene kadar File Agent'ı başlatma ve env
   değiştirme. Kaynak dosya/bayt sayısında düşüş, conflict kopyası, pCloud
   hata durumu, beklenmeyen ekstra dosya veya hedef kararsızlığı görülürse
   aşağıdaki durdurma adımına geç.

### 2e.3 Durdurma ve rollback

**Durdurma:** pCloud `Sync` sekmesinde yalnız ilgili eşlemenin `Stop`
düğmesini kullan. Bir onay penceresi dosya silme/temizleme ima ederse
`İptal` et ve durumu Administrators-only kanıta al; belirsiz seçeneği
onaylama. Hesabı `Unlink` etme, hedefi boşaltma ve eşleme aktifken yerel
dosya silme yapma. Stop sonrası iki taraf da olduğu gibi korunur; inceleme
bitmeden hedef yeniden kullanılmaz.

**Rollback sınırı:** D8, env/servis cutover'ından **önce** biter. Bu nedenle
normal rollback; eşlemeyi durdurmak, iki ağacı dokunmadan korumak ve taze
`BeforeSync` ile yeniden planlamaktır. Ortam veya servis geri alma komutu
yoktur; çünkü bunlar D8'de hiç değiştirilmez.

Bulutta eksilme/overwrite kanıtlanırsa otomatik rollback yapılmaz. Önce sync
durdurulur; sonra olay türüne göre Trash, Revisions veya Rewind kullanımı
ayrı, açık veri-yazma onayıyla yürütülür. Hesaba özgü retention süresi web
arayüzünden doğrulanmadan bu imkân “garantili yedek” sayılmaz. Sync aktifken
yerel hedefi silmek rollback değildir; iki yönlü silmeyi büyütebilir.

### 2e.4 AfterSync tam SHA-256 kabul kapısı

pCloud kuyruğu boş ve bütün yazarlar hâlâ durmuşken:

```powershell
$ghostManifest = '<Administrators-only exact exclusion manifesti>'
$beforeSyncReport = '<aynı bakım penceresindeki Administrators-only PASS raporu>'
$beforeSyncReportSha256 = '<raporun bağımsız doğrulanmış SHA-256 değeri>'

.\deploy\windows-service\test-storage-sync-migration-preflight.ps1 `
  -Stage AfterSync `
  -GhostExclusionManifestPath $ghostManifest `
  -BeforeSyncReportPath $beforeSyncReport `
  -BeforeSyncReportSha256 $beforeSyncReportSha256 `
  -ProgressInterval 500
```

`PASS/0` için aynı anda şunların tümü zorunludur:

- baseline raporu hash ve Administrators-only ACL kontrolünden geçer;
- baseline'daki 10 exact exclusion manifest hash'i güncel manifestle aynıdır;
- güncel kaynak dosya/klasör/bayt sayısı ve **tam kaynak manifest SHA-256**
  değeri `BeforeSync` baseline'ıyla aynıdır;
- kaynak ve hedef envanteri birebir eşittir;
- her göreli yolda dosya SHA-256 değeri birebir eşittir;
- eksik, fazla, hash farkı, G/Ç hatası veya tarama sırasında kaynak/hedef
  değişimi yoktur.

`SOURCE_BASELINE_CHANGED_SINCE_BEFORE_SYNC`, `INVENTORY_MISMATCH`,
`FULL_HASH_COMPARISON_FAILED` veya başka herhangi bir blocker sonucu
`BLOCKED/2`dir. `PASS/0` olmadan `HASARBOTU_AGENT_ROOTS`, File Agent veya
eski kök hakkında hiçbir değişiklik yapılmaz. Hedef bugün boş olduğundan
`AfterSync` bu önizleme çalışmasında kasıtlı olarak çalıştırılmadı.

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
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_ROOTS', '{"baran-global-primary":"C:\\HasarBotuStorage\\BARAN GLOBAL EKSPERTİZ"}', 'Machine')
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
- `probe-p-drive-system-context.ps1` bu makinede (DESKTOP-EFN2G33 —
  GERÇEK ofis/dağıtım makinesi, bkz. HB-2026-115) GERÇEK yönetici
  yükseltmesiyle çalıştırıldı (HB-2026-110/111): `LastTaskResult=0`,
  P:\ SYSTEM'den görünüyor/okunabiliyor/yazılabiliyor/silinebiliyor;
  sürücü harfi `\GLOBAL??` ad alanında (EldoS CBFS), ACL `Everyone: tüm
  haklar`. Bu artık NİHAİ ofis-makinesi sonucudur — ayrı bir makinede
  tekrar doğrulama GEREKMEZ.
- `setup-file-agent-service-account.ps1` (HB-2026-114/115/116): sözdizimi
  (`Parser::ParseFile`, 0 hata) doğrulandı; önizleme (Apply'sız) modu
  hem sentetik dizinlere hem GERÇEK hedef değerlere (`C:\HasarBotuStorage\
  BARAN GLOBAL EKSPERTİZ`, gerçek WinSW şablonu — salt-okunur) karşı
  GERÇEKTEN çalıştırıldı; ACL uygula/doğrula fonksiyonları bir SCRATCH
  klasöre karşı MEVCUT (yeni oluşturulmamış) hesaplarla — TEK hesap VE
  İKİ hesap (HB-2026-115: File Agent servis hesabı + pCloud'u çalıştıran
  etkileşimli kullanıcı) senaryolarında, artı eksik-ACE/fazladan-ACE
  negatif testleriyle — gerçekten test edildi; WinSW kimlik ekleme/
  doğrulama fonksiyonları gerçek şablonun SENTETİK bir kopyasına karşı
  test edildi (parola alanı kasıtlı eklenip DOĞRU tespit edildiği dahil).
  **HB-2026-116 (atomik akış):** parola üretici fonksiyon gerçekten
  çağrılıp `SecureString` tipinde, 44 karakter, İKİ ayrı çağrıda FARKLI
  değer ürettiği doğrulandı; WinSW şablon render fonksiyonu gerçek
  commit'li şablona karşı SCRATCH hedefe çalıştırılıp Türkçe metnin
  doğru, yer tutucuların (`__NODE_EXE__`/`__APP_DIR__`) doğru
  çözüldüğü doğrulandı; geri-alma (rollback) yığını sahte (dummy)
  scriptblock'larla TERS SIRA çalıştığı VE bir adım başarısız olsa bile
  DİĞERLERİNİN yine de denendiği (best-effort) doğrulandı; ACL geri-alma
  deseni bir scratch klasörde GERÇEK uygulanıp GERÇEK geri alınarak
  (miras durumu dahil, birebir orijinal ACL'e dönüldüğü) doğrulandı;
  `-Apply` `-WinSwExe` verilmeden VE zaten kurulu GERÇEK bir Windows
  servisine (`Spooler`) karşı `-ServiceName` ile çağrıldığında `exit 2`
  ile GÜVENLE reddedildiği doğrulandı (`Spooler`e HİÇBİR dokunulmadı,
  salt-okunur `Get-Service`). **Bulunan ve düzeltilen gerçek kusur:**
  `Write-Error` global `$ErrorActionPreference='Stop'` altında
  TERMINATING sayılıp script'i sonraki `exit N` satırına ULAŞMADAN
  durduruyordu — gerçek çıkış kodu her zaman `1` oluyordu, belgelenen
  `2` DEĞİL (üç ayrı ön-koşul kapısında gerçekten çalıştırılarak
  BULUNDU); `-ErrorAction Continue` ile düzeltildi ve tekrar test
  edilip doğru kod (`2`) döndüğü doğrulandı.
  **HB-2026-117 (ChangeServiceConfigW + tam zincir failure-injection
  testi):** `sc.exe config` kaldırıldı, yerine `advapi32.dll`
  `OpenSCManagerW`/`OpenServiceW`/`ChangeServiceConfigW`/
  `CloseServiceHandle` DOĞRUDAN (çocuk süreç OLMADAN) çağrılıyor; parola
  yalnız `Marshal.SecureStringToGlobalAllocUnicode` ile geçici unmanaged
  arabelleğe çözülüp API'ye ham `IntPtr` olarak geçiyor, çağrı biter
  bitmez `Marshal.ZeroFreeGlobalAllocUnicode` ile sıfırlanıp serbest
  bırakılıyor. **Test sırasında bulunan VE düzeltilen iki gerçek P/Invoke
  kusuru:** (1) `OpenSCManagerW`'a `lpDatabaseName` için `$null` geçmek
  — MSDN "ServicesActive"e düşeceğini söylese de — bu ortamda GERÇEKTEN
  `ERROR_INVALID_NAME (123)` ile başarısız oluyordu; açıkça
  `'ServicesActive'` vermek düzeltti. (2) `SERVICE_NO_CHANGE` sabiti
  `0xFFFFFFFF` PowerShell'de önce `Int32 (-1)` olarak ayrıştırılıyor;
  bu değer `ChangeServiceConfigW`'ın `uint` parametrelerine geçirilmeye
  çalışılınca "değer UInt32 için çok büyük/küçük" hatasıyla
  BAŞARISIZ oluyordu; `[uint32]::MaxValue` ile düzeltildi. Düzeltme
  sonrası SCM P/Invoke'u GERÇEK bir servise (`Spooler`) karşı SALT-OKUNUR
  erişimle (yalnız `SERVICE_QUERY_STATUS`) test edildi: handle'lar
  gerçekten açılıp kapandı; `ChangeServiceConfigW` bu salt-okunur
  handle'la çağrıldığında Windows'un KENDİSİ `ACCESS_DENIED (5)` ile
  REDDETTİĞİ doğrulandı (yanlış P/Invoke imzası çökme/crash üretirdi —
  bunun yerine düzgün bir Win32 hata kodu dönmesi imzanın DOĞRU
  olduğunun kanıtıdır); `Spooler` hiçbir şekilde değişmedi. Parola
  round-trip'i (`SecureString` → unmanaged arabellek → doğru okunan
  düz metin → sıfırla+serbest bırak) izole doğrulandı. **Tam zincir
  failure-injection testi:** hesap+haklar (mock, gerçek hesap/hak
  OLUŞTURMADAN) + depolama/uygulama-dizini/log ACL'leri + WinSW
  ikili kopyalama + XML render+kimlik enjeksiyonu (HEPSİ GERÇEK
  fonksiyonlarla, scratch klasörlerde) yedi adım sırayla uygulandı,
  ardından "WinSW install başarısız" kasıtlı olarak enjekte edildi;
  `Invoke-Rollback` tüm yedi adımı TAM TERS SIRAYLA geri aldı ve
  gerçek dosya/ACL durumu (miras dahil) BİREBİR orijinaline döndüğü
  doğrulandı (`undoStack` boşaldı). **Test edilMEYEN (kasıtlı,
  kullanıcı talimatıyla — henüz gerçek Apply çalıştırılmadı):**
  `New-LocalUser`/`Set-LocalUser` ile GERÇEK hesap oluşturma/parola
  ayarlama, `LsaAddAccountRights` ile GERÇEK hak verme, gerçek WinSW
  `install`, gerçek bir servise karşı GERÇEK `ChangeServiceConfigW`
  (SERVICE_CHANGE_CONFIG haklı bir handle'la) çağrısı — bunlar D6'nın
  gerçek yürütülmesinde ampirik olarak kanıtlanmalıdır.

## Açık kalan

- **DÜZELTİLDİ (HB-2026-115):** Bu bölüm önceden pCloud senkron
  geçişinin "ofis üretim verisiyle" ayrıca ölçülmesi gerektiğini
  söylüyordu — DESKTOP-EFN2G33 zaten GERÇEK ofis/üretim makinesi
  olduğu için §2a.1'deki ölçüm (6.258 dosya/~8,64 GB) GERÇEK üretim
  verisidir, ayrı ölçüm GEREKMEZ. Açık kalan TEK şey: senkronizasyonun
  GERÇEK süresi/disk etkisi geçiş fiilen yapılana kadar bilinmez
  (yalnız prosedür/§2a dry-run planı tanımlandı — bkz. HB-2026-112).
- **ARAÇ HAZIR VE ATOMIK (HB-2026-113/114/115/116/117, §2c):** File Agent
  artık LocalSystem yerine adanmış `svc-hasarbotu-fileagent` hesabı
  altında çalışacak; `setup-file-agent-service-account.ps1` hesabı, LSA
  haklarını, ACL'i VE GERÇEK WinSW kurulumunu TEK ATOMIK işlem olarak
  uygular/doğrular/gerekirse geri alır. HB-2026-115: depolama kökü ACL'i
  pCloud'u çalıştıran etkileşimli kullanıcıya (`-PCloudSyncAccount`) da
  Modify verir. HB-2026-116: parola operatörden ALINMAZ (betik kendi
  üretir, SecureString, hiçbir dosyaya yazılmaz), servis her zaman
  `Disabled` kurulur ve BAŞLATILMAZ. HB-2026-117: SCM'ye parola aktarımı
  artık `sc.exe` (çocuk süreç, argv ifşası riski) DEĞİL, doğrudan
  `ChangeServiceConfigW` Win32 API çağrısı; tam atomik zincir (hesap+
  haklar mock, ACL+WinSW render GERÇEK) bir failure-injection testiyle
  uçtan uca doğrulandı. Açık kalan: gerçek hesap oluşturma/LSA hakkı
  verme/WinSW `install`/gerçek `ChangeServiceConfigW` çağrılarının
  GERÇEK ortamda ampirik doğrulanması (D6'nın gerçek yürütülmesi —
  kasıtlı olarak bu pakette YAPILMADI); parola rotasyon prosedürü (sıklık, kim
  yapar — mekanizma HAZIR: betiği tekrar `-Apply` ile çalıştırmak) henüz
  RESMİ bir prosedür olarak yazılmadı; `install-services.ps1`e entegrasyon
  (API servisiyle TEK bir orkestrasyon akışına alma) henüz yapılmadı;
  pCloud'un gerçek çalıştığı hesabın GERÇEK kurulumda (bu makinede
  beklenen: `DESKTOP-EFN2G33\user`, ama gerçek dağıtım operatör hesabı
  farklı olabilir) doğru şekilde `-PCloudSyncAccount`e verilmesi operatör
  sorumluluğudur.
- WinSW ikili dosyasının bütünlük doğrulaması (checksum/imza) için kesin
  prosedür operatör kararına bırakıldı.
- TLS/sertifika (OPS-Q03) ve izleme (OPS-Q05) bu runbook'un kapsamı
  dışındadır; ayrı açık kararlardır.
