# D9 — Gerçek operasyonel devretme planı (PLAN, henüz UYGULANMADI)

Durum: **Yalnız plan + fail-closed önizleme.** Bu belge hiçbir env
değişkeni, servis, dosya veya pCloud ayarı DEĞİŞTİRMEDEN, yalnız
salt-okunur doğrulama ve mevcut (test edilmiş, bu makinede daha önce
gerçekten çalıştırılmış) araçların `-Apply` VERİLMEDEN önizleme
modlarıyla hazırlandı. Gerçek `-Apply` bu paket içinde ÇALIŞTIRILMADI.

**Hedef:** File Agent'ın depolama kökünü `P:\BARAN GLOBAL EKSPERTİZ`
(pCloud sanal sürücü) yerine `C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ`
(pCloud senkronize klasör, D7/D8'de doğrulanmış NTFS dizini) yapmak ve
API + File Agent Windows servislerini gerçekten çalışır hâle getirmek.

## 0. Önkoşul — D8 kanıtı

D8 migration doğrulama zinciri (`gate` → `PostSyncRebaseline` →
`AfterSync`) HB-2026-139'da baştan sona `PASS/0` verdi: 6873 dosya, 673
klasör, kaynak (`P:\`) ve hedef (`C:\HasarBotuStorage\...`) arasında tam
SHA-256 eşitliği kanıtlandı. Kanıt: Administrators-only
`C:\ProgramData\HasarBotu\migration-preflight\poststage-aftersync-
20260803T211949338Z-1bb00fbc.json` (+ sha256 sidecar).

**D9 Apply öncesi zorunlu taze-doğrulama:** bu rapor zaman içinde
bayatlar (yeni dosya/senkron aktivitesi). Gerçek `-Apply`'dan hemen önce
`test-storage-sync-migration-preflight.ps1 -Stage AfterSync` (aynı ghost
manifest + bu raporu `-BeforeSyncReportPath` olarak) tek kez yeniden
çalıştırılıp taze `PASS/0` alınmalı — HB-2026-134/136/137/138'de
gözlemlendiği gibi ofis aktivitesi kısa aralıklarla gerçek dosya
değişikliği üretebiliyor.

## 1. Bu paket içinde salt-okunur doğrulanan GERÇEK makine durumu

Aşağıdaki her satır bu paket içinde DESKTOP-EFN2G33 üzerinde gerçekten,
salt-okunur olarak sorgulandı (komutlar ve tam çıktılar §5'te):

| Alan | Gerçek durum |
|---|---|
| `hasarbotu-file-agent` Windows servisi | **Kurulu.** `StartType=Disabled`, `Status=Stopped` (D6, HB-2026-119/120'de gerçekten uygulandı) |
| `hasarbotu-api` Windows servisi | **Kurulu DEĞİL** |
| Servis hesabı `svc-hb-fileagent` | **Var, Enabled=True.** `SeServiceLogonRight` ✓, `SeDenyInteractiveLogonRight` ✓, `SeDenyRemoteInteractiveLogonRight` ✓, `PasswordRequired=True` (HB-2026-120 düzeltmesi) |
| Depolama kökü ACL (`C:\HasarBotuStorage\BARAN GLOBAL EKSPERTİZ`) | **Doğru.** `Administrators`→Full, `DESKTOP-EFN2G33\user` (pCloud senkron hesabı)→Modify, `svc-hb-fileagent`→Modify. Başka ACE yok |
| File Agent uygulama dizini ACL (`C:\HasarBotu\services\file-agent`) | **Doğru** (Read+Execute + yalnız `logs`da Modify) |
| File Agent WinSW XML (render edilmiş, diskte) | `<depend>hasarbotu-api</depend>`, `<serviceaccount><user>svc-hb-fileagent</user></serviceaccount>`, `HASARBOTU_AGENT_ROOTS`/`HASARBOTU_AGENT_SECRET` XML'de YOK (ortam değişkeni bekleniyor) |
| `C:\HasarBotu\services\file-agent\dist\index.js` | **Var** (D6 sırasında dağıtılmış) |
| `C:\HasarBotu\services\api\` (dizinin kendisi) | **YOK** — hiç oluşturulmamış |
| WinSW ikili dosyası | **Var**: `C:\Tools\WinSW-x64.exe` (18.243.033 bayt, file-agent kopyasıyla aynı boyut) |
| `postgresql-x64-17` servisi | `Running`, `StartType=Automatic` |
| `node.exe` | `C:\Program Files\nodejs\node.exe` |
| Repo build çıktısı | `services/api/dist/index.js` VE `services/file-agent/dist/index.js` repo ağacında MEVCUT (tazeliği doğrulanmadı — bkz. Blocker B2) |
| Makine ortam değişkenleri | `HASARBOTU_AGENT_ROOTS`, `HASARBOTU_AGENT_ID`, `HASARBOTU_AGENT_SECRET`, `HASARBOTU_API_BASE_URL`, `DATABASE_URL` — **Machine/User/Process kapsamlarının HİÇBİRİNDE TANIMLI DEĞİL** |
| Uygulama DB rolü parola dosyası | `%USERPROFILE%\.hasarbotu\hasarbotu_app.pass` **var** (içeriği bu pakette OKUNMADI/yazdırılmadı) |

## 2. Hedef son durum

- `hasarbotu-api` servisi kurulu, `Automatic`, `Running`.
- `hasarbotu-file-agent` servisi `Automatic` (şu an `Disabled`), `Running`.
- Makine kapsamında kalıcı ortam değişkenleri:
  - `DATABASE_URL = postgres://hasarbotu_app:<pass dosyasından>@127.0.0.1:5432/hasarbotu`
  - `HASARBOTU_API_BASE_URL = http://127.0.0.1:3100`
  - `HASARBOTU_AGENT_ROOTS = {"baran-global-primary":"C:\\HasarBotuStorage\\BARAN GLOBAL EKSPERTİZ"}`
  - `HASARBOTU_AGENT_ID`, `HASARBOTU_AGENT_SECRET` — API'nin agent-kayıt uç noktasından ÜRETİLECEK gerçek değerler (bkz. Adım 4c)
  - `NODE_ENV = production` (API için)
- `GET /health` → `{"status":"ok",...}`.
- File Agent logunda ilk döngüde `storage_unavailable` YOK.

## 3. Bu paket içinde bulunan gerçek blocker'lar (Apply öncesi çözülmeli)

| Kod | Blocker | Not |
|---|---|---|
| **B1** | `C:\HasarBotu\services\api\` dizini hiç yok; `install-services.ps1` bu yüzden `API build çıktısı yok` ile `exit 1` (bu pakette GERÇEKTEN çalıştırılıp doğrulandı, §5) | Çözüm: `npm run build --workspace @hasarbotu/api` (repo'da) sonrası `services/api/dist` + `package.json`/gerekli runtime dosyalarının `C:\HasarBotu\services\api\`e kopyalanması. Bu paket içinde YAPILMADI. |
| **B2** | Repo'daki `services/api/dist/index.js` / `services/file-agent/dist/index.js` çıktısının GÜNCEL HEAD'e karşı taze olduğu doğrulanmadı | Apply öncesi `npm run build:packages` yeniden çalıştırılıp temiz çıkış alınmalı. |
| **B3 (mimari boşluk)** | `install-services.ps1` **her zaman İKİ servisi de** (`hasarbotu-api` + `hasarbotu-file-agent`) sırayla kurar; TEK servis seçme seçeneği YOK (kod: `Install-OneService` çağrıları satır 171-172, koşulsuz). `setup-file-agent-service-account.ps1`in kendi önizlemesi de doğruladı: *"hasarbotu-file-agent servisi ZATEN kurulu — bu betik VAR OLAN bir servisi güncellemez/yeniden kurmaz"* — yani D6'nın atomik aracı da tekrar dokunmayı reddediyor. `install-services.ps1`i olduğu gibi `-Apply` ile çalıştırmak `hasarbotu-file-agent`i YENİDEN `install` eder; WinSW şablonundaki `<startmode>Automatic</startmode>` gerçek SCM `StartType=Disabled`i (D6'nın kasıtlı, ayrı bir `ChangeServiceConfigW` çağrısıyla verdiği) SESSİZCE Automatic'e döndürebilir — bu, "önce env/secret ayarlanmadan asla otomatik başlamasın" fail-closed davranışını BOZAR. | **Çözüm önerisi (bu pakette YAPILMADI, ayrı küçük bir paket gerektirir):** `install-services.ps1`e `-Services @('Api')` / `-Services @('Api','FileAgent')` gibi dar bir seçici parametre eklemek, yalnız seçilenler için `Install-OneService` çağırmak, mevcut sözdizimi/ön-koşul testlerine yeni test eklemek. Bu, D9 Apply'ının GERÇEKTEN güvenle atılabilmesi için ÖNKOŞULDUR. |
| **B4** | Gerçek `HASARBOTU_AGENT_ID`/`HASARBOTU_AGENT_SECRET` yok — bunlar sabit kodlanamaz; API'nin `POST /api/v1/agents` (admin oturumu gerektirir, `services/api/src/agent/routes.ts:187`) uç noktasından ÜRETİLİR ve yalnız BİR KEZ düz metin döner (`services/api/src/agent/store.ts:126` `registerAgent`) | API çalışmadan bu adım atılamaz — sıralama: API kur+başlat (secret olmadan, yalnız `HASARBOTU_AGENT_ROOTS`/`_ID`/`_SECRET` gerektirmeyen kısım) → admin oturumuyla agent kaydet → dönen `agentId`+`secret`i File Agent ortam değişkenlerine yaz → File Agent'ı başlat. |
| **B5** | En az bir admin rollü kullanıcının DB'de var olduğu bu pakette doğrulanmadı (agent kaydı admin oturumu gerektirir) | Apply öncesi salt-okunur `SELECT` ile doğrulanmalı (gerçek parola/bağlantı dizesi hiçbir çıktıya yazdırılmadan). |
| **B6** | `AGENTS.md` §7 kritik işlem standardı gereği bu, açık kullanıcı onayı gerektiren bir sınıf işlemdir (env/servis değişikliği) | Bu belge onay İSTEĞİDİR — gerçek `-Apply` yalnız kullanıcının bu planı gözden geçirip AÇIKÇA onaylamasından sonra çalıştırılmalı. |

## 4. Sıralı Apply planı (yalnız kullanıcı onayından SONRA çalıştırılacak)

Model: Planla → Önizle → Onay → Uygula → Doğrula → Kesinleştir → Audit
(AGENTS.md §7).

### Adım 0 — Taze D8 doğrulaması
```powershell
.\deploy\windows-service\test-storage-sync-migration-preflight.ps1 `
  -Stage AfterSync -GhostExclusionManifestPath $ghostManifest `
  -BeforeSyncReportPath $beforeSyncReport -BeforeSyncReportSha256 $hash
```
`PASS/0` olmadan hiçbir sonraki adıma geçilmez.

### Adım 1 — Build + API dağıtım dizini (B1/B2 çözümü)
```powershell
npm run build:packages
New-Item -ItemType Directory -Path 'C:\HasarBotu\services\api' -Force
# services/api/dist + gerekli runtime dosyaları kopyalanır (file-agent'ın
# D6'da nasıl dağıtıldığıyla AYNI yöntem — repo bu kopyalama adımını
# otomatikleştiren bir betik İÇERMİYOR; operatör elle veya küçük bir
# yardımcı betikle yapar, ayrı bir küçük paket olarak).
```

### Adım 2 — (Ayrı küçük paket, B3) `install-services.ps1`e `-Services` seçici eklenmesi
Bu paket kapsamı DIŞINDA. Değişiklik küçük, test edilebilir olmalı:
mevcut `-ApiDir`/`-FileAgentDir` semantiği korunur, yalnız hangi
servis(ler)in kurulacağı seçilebilir hâle gelir; `hasarbotu-file-agent`
zaten kuruluysa varsayılan olarak ATLANIR (yeniden `install`
ÇAĞRILMAZ).

### Adım 3 — Yalnız API'nin WinSW kurulumu
```powershell
.\deploy\windows-service\install-services.ps1 -ApiDir 'C:\HasarBotu\services\api' `
  -FileAgentDir 'C:\HasarBotu\services\file-agent' -WinSwExe 'C:\Tools\WinSW-x64.exe' `
  -Services @('Api')   # Adım 2'nin ürettiği yeni parametre
```
Önce `-Apply` OLMADAN çalıştırılıp plan gözden geçirilir, sonra `-Apply`.

### Adım 4 — Secret/ortam değişkenleri (sıra ÖNEMLİ)
```powershell
# 4a) DB parolası yerel dosyadan okunur (asla ekrana/log'a yazılmaz)
$pw = Get-Content "$env:USERPROFILE\.hasarbotu\hasarbotu_app.pass" -Raw
[Environment]::SetEnvironmentVariable('DATABASE_URL', "postgres://hasarbotu_app:$pw@127.0.0.1:5432/hasarbotu", 'Machine')
[Environment]::SetEnvironmentVariable('HASARBOTU_API_BASE_URL', 'http://127.0.0.1:3100', 'Machine')
[Environment]::SetEnvironmentVariable('NODE_ENV', 'production', 'Machine')

# 4b) API başlatılır (File Agent HENÜZ değil — henüz agent kimliği yok)
Start-Service hasarbotu-api
Start-Sleep -Seconds 3
Invoke-RestMethod http://127.0.0.1:3100/health   # "ok" beklenir

# 4c) Admin oturumuyla agent kaydı (GERÇEK admin kimlik bilgisiyle,
# operatör elle çalıştırır — otomatikleştirilmez, secret ekrana YAZILMAZ,
# yalnız güvenli şekilde saklanır):
#   POST /api/v1/agents  { "name": "file-agent-baran-global" }
#   -> { agent: { id, ... }, secret: "..." }  (BİR KEZ döner)

[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_ID', '<agent.id>', 'Machine')
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_SECRET', '<secret>', 'Machine')
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_ROOTS', '{"baran-global-primary":"C:\\HasarBotuStorage\\BARAN GLOBAL EKSPERTİZ"}', 'Machine')

# 4d) File Agent'ı Automatic yap ve başlat
Set-Service hasarbotu-file-agent -StartupType Automatic
Start-Service hasarbotu-file-agent
```

### Adım 5 — Smoke test (Doğrula)
- `Get-Service hasarbotu-api, hasarbotu-file-agent` → ikisi de `Running`.
- `Invoke-RestMethod http://127.0.0.1:3100/health` → `status: "ok"`.
- `C:\HasarBotu\services\file-agent\logs\hasarbotu-file-agent.out.log` ilk
  döngüde `storage_unavailable` İÇERMEZ.
- Küçük, zararsız bir gerçek iş (ör. mevcut bir dosyanın salt-okunur
  envanter/okuma işlemi — YAZMA testi burada YAPILMAZ) uçtan uca izlenir.

### Adım 6 — Kesinleştir
- Eski `P:\BARAN GLOBAL EKSPERTİZ` en az 14 gün silinmeden, salt-okunur
  referans olarak tutulur (mevcut karar, PROJECT_STATUS §2903).
- Deployment audit kaydı (RUNBOOK §6 formatı) yazılır.

## 5. Bu paket içinde GERÇEKTEN çalıştırılan salt-okunur önizleme kanıtları

**A) D6 dosya-ajanı hesap/ACL/servis durumu** (`setup-file-agent-service-account.ps1`, `-Apply` YOK):
```
Hesap (svc-hb-fileagent) mevcut mu   : True
Sahip mi: SeServiceLogonRight        : True
Sahip mi: SeDenyInteractiveLogonRight: True
Sahip mi: SeDenyRemoteInteractiveLogonRight: True
Parola gerekli (PasswordRequired)    : True
Depolama koku ACL uygun mu           : True
Uygulama dizini ACL uygun mu         : True
Log dizini ACL uygun mu              : True
WinSW servisi kurulu mu              : True (StartType=Disabled Status=Stopped)
UYARI: hasarbotu-file-agent servisi ZATEN kurulu - bu betik VAR OLAN bir
servisi guncellemez/yeniden kurmaz.
-Apply verilmedi: yalniz durum + plan gosterildi, HICBIR degisiklik yapilmadi.
EXITCODE=0
```

**B) API+File Agent WinSW kurulum önizlemesi** (`install-services.ps1`, `-Apply` YOK, gerçek yollarla):
```
--- HasarBotu V2 Windows servis kurulumu: PLAN ---
  Postgres servisi    : Running
--- Ön koşul HATALARI (kurulum yapılamaz) ---
  - API build çıktısı yok: C:\HasarBotu\services\api\dist\index.js
    (önce 'npm run build --workspace @hasarbotu/api')
EXITCODE=1
```
(`exit 1` beklenen fail-closed davranıştır — hiçbir dosya/servis
değişmedi.)

## 6. Rollback planı

`HASARBOTU_AGENT_ROOTS` değişimi geri alınabilirdir (mevcut karar,
PROJECT_STATUS §2903): rootKey DEĞİŞMEZ, yalnız makine ortam değişkeni
eski `P:\BARAN GLOBAL EKSPERTİZ` değerine döndürülüp servisler yeniden
başlatılır — veritabanı DEĞİŞMEZ.

```powershell
Stop-Service hasarbotu-file-agent
[Environment]::SetEnvironmentVariable('HASARBOTU_AGENT_ROOTS', '{"baran-global-primary":"P:\\BARAN GLOBAL EKSPERTİZ"}', 'Machine')
Start-Service hasarbotu-file-agent
```

Daha geniş geri alma (API/File Agent servislerini tamamen durdurup eski
duruma dönmek):
```powershell
Stop-Service hasarbotu-file-agent
Stop-Service hasarbotu-api
Set-Service hasarbotu-file-agent -StartupType Disabled
```
Bu, D9 öncesi duruma (bu belgenin §1'inde belgelenen gerçek durum)
BİREBİR döner — `hasarbotu-api` kurulmuşsa kaldırılması (`hasarbotu-api.exe
uninstall`) ayrı, açık bir karardır.

Eski `P:\` kökü en az 14 gün silinmeden tutulur; rollback bu süre
içinde HER ZAMAN mümkündür.

## 7. Bu pakette YAPILMAYANLAR (kesin liste)

- Hiçbir env değişkeni (Machine/User/Process) yazılmadı/değiştirilmedi.
- Hiçbir Windows servisi kurulmadı/başlatılmadı/durdurulmadı/değiştirilmedi.
- Hiçbir dosya kopyalanmadı/taşınmadı/silinmedi (bu plan dosyası hariç).
- pCloud ayarı, sync eşlemesi hiç değişmedi.
- `install-services.ps1`, `setup-file-agent-service-account.ps1` veya
  başka hiçbir mevcut araç DEĞİŞTİRİLMEDİ — yalnız `-Apply` OLMADAN
  çalıştırıldı.
- Gerçek `DATABASE_URL`/agent secret DEĞERLERİ hiçbir yerde
  okunmadı/yazdırılmadı/kaydedilmedi (yalnız pass dosyasının VARLIĞI
  doğrulandı).

## 8. Onay bekleyen açık kararlar

1. **B3 çözümü onaylanıyor mu** — `install-services.ps1`e tek-servis
   seçici parametre eklenmesi ayrı, küçük bir paket olarak mı yapılsın?
2. **API deploy dizini kopyalama yöntemi** — elle mi, yoksa yeni bir
   küçük yardımcı betikle mi (D6'nın file-agent için yaptığı gibi)?
3. **Agent kaydı (Adım 4c)** kimin admin hesabıyla, ne zaman yapılacak?
4. **Gerçek Apply zamanlaması** — ofis mesaisi dışında mı planlanacak
   (D8 zincirinde görüldüğü gibi gerçek ofis aktivitesi kısa aralıklarla
   dosya hareketine yol açabiliyor; servis kesintisi/File Agent ilk
   başlatması için sakin bir pencere tercih edilir)?

Bu dört sorunun cevabı olmadan gerçek `-Apply` bu depo kuralları
gereği BAŞLATILMAZ.
