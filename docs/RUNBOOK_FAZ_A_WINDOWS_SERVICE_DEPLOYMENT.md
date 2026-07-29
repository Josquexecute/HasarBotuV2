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

**Ölçüldü (bu geliştirme makinesinde, salt-okunur, 2026-07-29):**

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

**ÖNEMLİ ihtiyat notu:** Yukarıdaki sayılar BU geliştirme/test pCloud
hesabına aittir. Ofis üretim hesabındaki gerçek veri hacmi FARKLI (muhtemelen
DAHA BÜYÜK — yıllar boyu birikmiş dosya/klasör) olabilir; GERÇEK geçişten
önce bu ölçüm ofis makinesinde TEKRARLANMALIDIR.

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

## 2c. File Agent servis hesabı — D6 kararı (HB-2026-113, PLAN — henüz uygulanmadı)

**Durum:** Bu bölüm bir PLANDIR. Bu paket kapsamında hesap, ACL veya kod
DEĞİŞTİRİLMEDİ — yalnız §3 (WinSW kurulumu) BAŞLAMADAN ÖNCE izlenecek
somut prosedür yazıldı. `install-services.ps1`/WinSW XML şablonları bu
kararı henüz UYGULAMIYOR; D6'nın kendisi ayrı, açıkça onaylanmış bir
uygulama görevidir.

**Sahip:** Kurulumu yapan operatör (yönetici).

**Ön koşul:** §2/§2a (senkron klasör geçişi) tamamlanmış; hedef kök
`C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ` mevcut.

**Gerekçe:** WinSW'nin varsayılanı (serviceaccount tanımlanmazsa)
**LocalSystem**dir — HB-2026-111'in ölçtüğü gibi bu hesap makine genelinde
neredeyse sınırsız yetkiye sahiptir; klasör ACL'i tek başına en-az-yetkiyi
SAĞLAMAZ. `DEPLOYMENT_AND_OPERATIONS_PLAN.md` §2.3 zaten "File Agent
hesabına yalnız tanımlı depolama kökünde gereken yetki verilir" ilkesini
BELGELİYORDU; bu bölüm o ilkeyi somut, uygulanabilir bir prosedüre çevirir.

**Komut/işlem (GERÇEK kurulumda, sırayla):**

1. **Hesabı oluştur** (güçlü, rastgele üretilmiş parola; parola KOMUT
   GEÇMİŞİNE/LOG'A YAZILMAZ — `SecureString` kullanılır):

   ```powershell
   $accountName = 'svc-hasarbotu-fileagent'
   $bytes = [byte[]]::new(24)
   [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
   $securePw = ConvertTo-SecureString -String ([Convert]::ToBase64String($bytes)) -AsPlainText -Force
   New-LocalUser -Name $accountName -Password $securePw `
       -PasswordNeverExpires -UserMayNotChangePassword `
       -Description 'HasarBotu V2 File Agent — yalnız Windows servis oturumu, etkilesimli giris YASAK (D6, HB-2026-113)'
   # Yerel "Users" grubundan ÇIKAR (varsayılan üyelik, gereksiz genel haklar taşır):
   Remove-LocalGroupMember -Group 'Users' -Member $accountName -ErrorAction SilentlyContinue
   ```

2. **"Log on as a service" hakkı** — WinSW'nin `<serviceaccount>` bloğundaki
   `allowservicelogon: true` seçeneği bunu kurulumda OTOMATİK vermeyi
   dener (resmi WinSW özelliği); **bu davranış D6 uygulamasında GERÇEKTEN
   doğrulanmalıdır** (bu pakette doğrulanmadı). Otomatik verilmezse veya
   önceden elle doğrulanmak istenirse, LSA politika API'siyle (ek
   dependency GEREKTİRMEZ — `advapi32.dll`) doğrudan verilebilir:

   ```powershell
   # Add-AccountRight yardımcı fonksiyonu (LsaAddAccountRights P/Invoke).
   # Kaynak: standart, yaygın bilinen LSA-rights P/Invoke deseni.
   Add-Type -Namespace Native -Name Lsa -MemberDefinition @'
   [DllImport("advapi32.dll", SetLastError = true)]
   public static extern uint LsaOpenPolicy(IntPtr SystemName, ref LSA_OBJECT_ATTRIBUTES ObjectAttributes, int DesiredAccess, out IntPtr PolicyHandle);
   [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
   public static extern uint LsaAddAccountRights(IntPtr PolicyHandle, byte[] AccountSid, LSA_UNICODE_STRING[] UserRights, int CountOfRights);
   [DllImport("advapi32.dll")] public static extern int LsaClose(IntPtr ObjectHandle);
   [StructLayout(LayoutKind.Sequential)] public struct LSA_OBJECT_ATTRIBUTES { public int Length; public IntPtr RootDirectory; public IntPtr ObjectName; public int Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService; }
   [StructLayout(LayoutKind.Sequential)] public struct LSA_UNICODE_STRING { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }
   '@
   # (Gövde: SID çözümleme + LSA_UNICODE_STRING doldurma + LsaOpenPolicy/LsaAddAccountRights
   #  çağrısı D6 uygulamasında yazılır; burada yalnız YAKLAŞIM belgelenir.)
   # Eklenecek haklar: SeServiceLogonRight (yalnız otomatik verilmediyse yedek).
   ```

3. **Etkileşimli/RDP oturumunu YASAKLA** (aynı LSA API, farklı haklar —
   bu D6'nın ZORUNLU adımıdır, opsiyonel değil):

   ```text
   SeDenyInteractiveLogonRight        — "Deny log on locally"
   SeDenyRemoteInteractiveLogonRight  — "Deny log on through Remote Desktop Services"
   ```

   (Opsiyonel ek sertleştirme, bu kararın kapsamı dışında ama önerilir:
   `SeDenyNetworkLogonRight` — hesabın SMB/ağ üzerinden başka bir amaçla
   kullanılmasını da engeller.)

4. **Hedef depolama kökünde yalnız Modify** (Tam Denetim DEĞİL):

   ```powershell
   $target = 'C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ'
   icacls $target /inheritance:d
   icacls $target /remove 'BUILTIN\Users' 'NT AUTHORITY\Authenticated Users' 'Everyone' 'NT AUTHORITY\SYSTEM' 2>$null
   icacls $target /grant:r "$env:COMPUTERNAME\svc-hasarbotu-fileagent:(OI)(CI)M"
   icacls $target /grant:r 'BUILTIN\Administrators:(OI)(CI)F'
   ```

   Bu, §2a.2'nin (HB-2026-112) `NT AUTHORITY\SYSTEM:(OI)(CI)F` grantını
   SÜPERSEDE eder — File Agent artık SYSTEM olarak çalışmayacağı için o
   grant GEREKSİZDİR ve kaldırılmalıdır.

5. **Uygulama dizininde en az yetki** (LocalSystem'in aksine, adanmış
   hesabın `node.exe`/`dist\index.js`'i okuyabilmesi ve kendi log
   dizinine yazabilmesi için AÇIKÇA gerekir — kolayca gözden kaçan adım):

   ```powershell
   $appDir = $FileAgentDir   # örn. C:\HasarBotu\services\file-agent
   icacls $appDir /grant:r "$env:COMPUTERNAME\svc-hasarbotu-fileagent:(OI)(CI)RX"
   icacls (Join-Path $appDir 'logs') /grant:r "$env:COMPUTERNAME\svc-hasarbotu-fileagent:(OI)(CI)M"
   ```

6. **WinSW kimlik yapılandırması** (`hasarbotu-file-agent.winsw.xml`
   ŞABLONUNA eklenecek — repo'daki şablon parolayı ASLA içermez, yalnız
   yer tutucu; GERÇEK parola yalnız render sırasında, repo DIŞINDAKİ
   dağıtım kopyasına yazılır — mevcut `__NODE_EXE__`/`__APP_DIR__` deseniyle
   AYNI ilke):

   ```xml
   <serviceaccount>
     <domain>%COMPUTERNAME%</domain>
     <user>svc-hasarbotu-fileagent</user>
     <password>__FILE_AGENT_SERVICE_PASSWORD__</password>
     <allowservicelogon>true</allowservicelogon>
   </serviceaccount>
   ```

**Beklenen çıktı:** Hesap oluşturuldu, yalnız "Log on as a service" hakkına
sahip, etkileşimli/RDP girişi reddediliyor (`runas /user:svc-hasarbotu-fileagent
cmd` GERÇEKTEN reddedilmeli — bkz. doğrulama), hedef kökte
`icacls`in yalnız bu hesabı (Modify) ve Administrators'ı (Full) gösterdiği.

**Durdurma ölçütü:** Hesap "Log on as a service" hakkını ALAMAMIŞSA WinSW
servis kurulumu (§3) sırasında SCM açıkça hata verir (`Logon failure`);
kurulum bu hata çözülmeden İLERLETİLMEZ. Etkileşimli giriş reddi
doğrulanamıyorsa (adım aşağıda) hesap kullanıma ALINMAZ.

**Doğrulama:**

```powershell
runas /user:svc-hasarbotu-fileagent cmd   # AÇIKÇA reddedilmeli (etkileşimli giriş yasak)
icacls 'C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ'   # yalnız SYSTEM YOK, svc-hasarbotu-fileagent:(M), Administrators:(F)
whoami /priv  # (servis GERÇEKTEN bu hesapla çalışırken, D6 uygulamasında) SeServiceLogonRight listede
```

**Audit kanıtı:** Hesap adı, oluşturma tarihi, verilen/reddedilen haklar
ve `icacls` çıktısı deployment audit kaydına (§6) eklenir. Parolanın
KENDİSİ hiçbir zaman audit kaydına/log'a/repository'ye YAZILMAZ.

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
- `probe-p-drive-system-context.ps1` bu makinede GERÇEK yönetici
  yükseltmesiyle çalıştırıldı (HB-2026-110/111): `LastTaskResult=0`,
  P:\ SYSTEM'den görünüyor/okunabiliyor/yazılabiliyor/silinebiliyor;
  sürücü harfi `\GLOBAL??` ad alanında (EldoS CBFS), ACL `Everyone: tüm
  haklar`. Bu, TEK bir geliştirme makinesindeki sonuçtur — ofis
  dağıtım makinesinde Adım 2.5 olarak bağımsız doğrulanmalıdır (farklı
  pCloud sürümü/yapılandırması farklı sonuç verebilir).

## Açık kalan

- pCloud senkronize klasör geçişinin GERÇEK ofis verisiyle süresi ve
  disk alanı etkisi ölçülmedi (yalnız prosedür/§2a dry-run planı
  tanımlandı — bkz. HB-2026-112). Ofis üretim verisinin gerçek
  hacmi bu geliştirme makinesindeki ölçümden (6.258 dosya/~8,64 GB)
  FARKLI olabilir; §2a.1 ofis makinesinde TEKRARLANMALIDIR.
- **KARARA BAĞLANDI (HB-2026-113, §2c):** File Agent artık LocalSystem
  yerine adanmış `svc-hasarbotu-fileagent` hesabı altında çalışacak; ACL
  o hesaba daraltılacak. Bu, PLAN aşamasındadır — `install-services.ps1`
  ve WinSW XML şablonları henüz UYGULAMIYOR (D6, ayrı görev). Açık kalan:
  WinSW'nin `allowservicelogon` özelliğinin bu ortamda "Log on as a
  service" hakkını GERÇEKTEN otomatik verip vermediği D6 uygulamasında
  doğrulanmalı; LSA P/Invoke yardımcı fonksiyonunun tam gövdesi (§2c
  adım 2) D6'da yazılıp test edilmeli; parola rotasyon prosedürü (sıklık,
  kim yapar, WinSW'ye nasıl yansıtılır) henüz tanımlanmadı.
- WinSW ikili dosyasının bütünlük doğrulaması (checksum/imza) için kesin
  prosedür operatör kararına bırakıldı.
- TLS/sertifika (OPS-Q03) ve izleme (OPS-Q05) bu runbook'un kapsamı
  dışındadır; ayrı açık kararlardır.
