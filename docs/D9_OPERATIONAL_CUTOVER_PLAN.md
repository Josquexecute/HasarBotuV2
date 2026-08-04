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
| **B1 (mekanizma HAZIR, HB-2026-143, 2026-08-04) — kopyalama HENÜZ UYGULANMADI** | `C:\HasarBotu\services\api\` dizini hâlâ yok. | **Araç hazır:** `deploy-service-artifacts.ps1` (fail-closed, idempotent, atomik, geri alınabilir, allowlist=`dist/`+`package.json`) yazıldı, 12 regresyon testi + statik denetim eklendi. Gerçek makinede yalnız salt-okunur önizleme çalıştırıldı: kaynak `services/api` → hedef `C:\HasarBotu\services\api`, **436 allowlist dosyası, ~1,56 MB**, `would_apply`, sıfır değişiklik. Gerçek `-Apply` HÂLÂ çalıştırılmadı (B6 — kullanıcı onayı + sakin pencere bekliyor). |
| **B7 (yeni, HB-2026-143'te bulundu)** | `deploy-service-artifacts.ps1` yalnız `dist/`+`package.json` taşır — npm workspace'in KÖK `node_modules`'ında hoisted olan çalışma zamanı bağımlılıklarını (fastify, pg, zod, `@hasarbotu/contracts`/`database`/`domain` vb.) TAŞIMAZ. Gerçek makinede doğrulandı: `services/api/node_modules` yalnız `@types`+`undici-types` (tip-only) içeriyor, gerçek bağımlılıklar KÖK `node_modules`'ta. **Aynı sorun File Agent'ın ZATEN GERÇEK yapılan D6 dağıtımında da var** (`C:\HasarBotu\services\file-agent`de node_modules YOK) — yani bu, API'ye özgü değil, HİÇBİR servis şu an deploy dizininden gerçekten BAŞLATILAMAZ (`Cannot find module` ile çöker), servis hiçbiri gerçek `-Apply`/başlatma ile denenmediği için bu şimdiye kadar fark edilmemişti. | **Çözülmedi, ayrı bir karar/paket gerektirir:** üç seçenek (a) deploy script'ine kök `node_modules`'tan gerekli alt kümeyi kopyalayan bir adım eklemek, (b) build'i esbuild/rollup ile TEK DOSYAYA bundle etmek (node_modules gerekmez), (c) `npm install --omit=dev` ile deploy dizininde bağımsız bir kurulum yapmak. Servis GERÇEKTEN başlatılmadan önce bu ÇÖZÜLMELİDİR. |
| **B2** | Repo'daki `services/api/dist/index.js` / `services/file-agent/dist/index.js` çıktısının GÜNCEL HEAD'e karşı taze olduğu doğrulanmadı | Apply öncesi `npm run build:packages` yeniden çalıştırılıp temiz çıkış alınmalı. |
| **B3 (mimari boşluk) — ÇÖZÜLDÜ (HB-2026-142, 2026-08-04)** | `install-services.ps1` her zaman iki servisi de kurardı, tek servis seçme seçeneği yoktu. | **Çözüldü:** `-Services Api` / `-Services FileAgent` / (varsayılan) ikisi parametresi eklendi. `-Services` verilmezse davranış birebir aynı kaldı (regresyon testiyle doğrulandı). Tek-servis modunda seçilmeyen servise ait HİÇBİR dosya/dizin okunmaz/doğrulanmaz. Ayrıca yeni bir idempotency guard'ı eklendi: seçilen servis SCM'de zaten kuruluysa `-Apply` OLMADAN BİLE fail-closed reddedilir (gerçek makinede `hasarbotu-file-agent` ile doğrulandı). 8 regresyon testi (`install-services.tests.ps1`) + statik denetim eklendi, `npm run check:deploy`e bağlandı. Gerçek makinede yalnız salt-okunur önizleme çalıştırıldı (`-Services Api`: yalnız API build eksikliği raporlandı; `-Services FileAgent`: idempotency blocker doğru raporlandı) — hiçbir servis/env/dosya değişmedi. |
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

### Adım 1 — TAMAMLANDI (mekanizma, HB-2026-143): Build + API dağıtım dizini
```powershell
npm run build:packages   # B2: tazelik icin her Apply'dan once yeniden calistirilmali
.\deploy\windows-service\deploy-service-artifacts.ps1 `
  -SourceDir 'C:\...\HasarBotuV2\services\api' `
  -TargetDir 'C:\HasarBotu\services\api' `
  -ServiceLabel 'api' `
  -Apply
```
`deploy-service-artifacts.ps1` (B1) yazıldı, test edildi, gerçek makinede
yalnız önizleme çalıştırıldı (§5.E). **B7 (node_modules) çözülmeden bu
adımın gerçek Apply'ı servis çalıştırılabilir hâle GETİRMEZ** — yalnız
`dist/`+`package.json`i taşır.

### Adım 2 — TAMAMLANDI (HB-2026-142): `install-services.ps1`e `-Services` seçici eklendi
`-Services Api` / `-Services FileAgent` / (varsayılan) ikisi. Mevcut
`-ApiDir`/`-FileAgentDir` semantiği korundu; seçilmeyen servise hiç
dokunulmaz. Zaten kurulu bir servis seçilirse (idempotency) fail-closed
reddedilir. 8 regresyon testi + statik denetim eklendi. Gerçek makinede
yalnız önizleme çalıştırıldı (§5'e eklendi).

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

**C) Tek-servis önizlemesi, HB-2026-142 sonrası** (`install-services.ps1 -Services Api`, `-Apply` YOK, gerçek yollarla):
```
--- HasarBotu V2 Windows servis kurulumu: PLAN ---
  Seçilen servisler   : Api
  API dizini          : C:\HasarBotu\services\api
--- Ön koşul HATALARI (kurulum yapılamaz) ---
  - API build çıktısı yok: C:\HasarBotu\services\api\dist\index.js
    (önce 'npm run build --workspace @hasarbotu/api')
EXITCODE=1
```
File Agent hiç bahsi geçmedi/kontrol edilmedi.

**D) Tek-servis önizlemesi** (`install-services.ps1 -Services FileAgent`, `-Apply` YOK, gerçek yollarla):
```
--- HasarBotu V2 Windows servis kurulumu: PLAN ---
  Seçilen servisler   : FileAgent
  File Agent dizini   : C:\HasarBotu\services\file-agent
--- Ön koşul HATALARI (kurulum yapılamaz) ---
  - hasarbotu-file-agent servisi ZATEN kurulu - bu betik VAR OLAN bir
    servisi güncellemez/yeniden kurmaz.
EXITCODE=1
```
Idempotency guard gerçek, zaten kurulu servise karşı doğru çalıştı;
API/Postgres hiç bahsi geçmedi/kontrol edilmedi.

**E) API deploy önizlemesi, HB-2026-143** (`deploy-service-artifacts.ps1`, `-Apply` YOK, gerçek yollarla — kaynak: repo `services/api`, hedef: `C:\HasarBotu\services\api`):
```
--- HasarBotu V2 servis dağıtımı: preview (api) ---
  Allowlist dosya sayısı : 436
  Toplam bayt         : 1562900
  Hedef zaten var mı  : False
Ön koşullar karşılandı.
-Apply verilmedi: yalnız plan gösterildi, HİÇBİR değişiklik yapılmadı.
{"Status":"would_apply", ...}
```
436 dosya (`dist/` tamamı + `package.json`), ~1,56 MB. Hedef dizin
oluşturulmadı, hiçbir dosya kopyalanmadı.

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
- `setup-file-agent-service-account.ps1` DEĞİŞTİRİLMEDİ — yalnız
  `-Apply` OLMADAN çalıştırıldı.
- Gerçek `DATABASE_URL`/agent secret DEĞERLERİ hiçbir yerde
  okunmadı/yazdırılmadı/kaydedilmedi (yalnız pass dosyasının VARLIĞI
  doğrulandı).

**Güncelleme (HB-2026-142, 2026-08-04):** Yukarıdaki liste ilk plan
paketi (HB-2026-140) içindir. B3'ün çözümü olarak `install-services.ps1`
KOD DEĞİŞİKLİĞİ aldı (`-Services` seçici + idempotency guard'ı) — bu,
kod/test/statik-denetim değişikliğidir, GERÇEK servis/env/deploy
dosyası mutasyonu DEĞİLDİR. Bu değişiklikten sonra bile gerçek
makinede yalnız `-Apply` OLMADAN önizleme çalıştırıldı (§5.C/D); hiçbir
env değişkeni, gerçek Windows servisi, deploy dosyası veya pCloud ayarı
değişmedi.

**Güncelleme (HB-2026-143, 2026-08-04):** B1'in çözümü olarak YENİ bir
araç (`deploy-service-artifacts.ps1` + testleri) EKLENDİ — bu da kod/
test/statik-denetim değişikliğidir, GERÇEK deploy dosyası mutasyonu
DEĞİLDİR. Testler sırasında `C:\ProgramData\HasarBotu\migration-preflight\
pre-deploy-backups\` altına düşen SENTETİK test yedekleri (gerçek kanıtla
karışmasınlar diye) temizlendi. Gerçek makinede yalnız `-Apply` OLMADAN
önizleme çalıştırıldı (§5.E, gerçek `services/api` → `C:\HasarBotu\
services\api`) — hiçbir dosya kopyalanmadı/taşınmadı. Bu çalıştırma
sırasında YENİ bir gerçek blocker (B7, node_modules/bağımlılık çözümü)
bulundu ve belgelendi.

## 8. Onay bekleyen açık kararlar — CEVAPLANDI (2026-08-04)

Kullanıcı aşağıdaki dört soruyu yanıtladı. Bu, yalnız KARARLARIN
kayıt altına alınmasıdır — hiçbiri bu paket içinde UYGULANMADI; her biri
kendi ayrı paketinde, kendi Plan→Önizle→Onay→Uygula→Doğrula döngüsüyle
yürütülecek.

1. **B3 çözümü** → **Onaylandı: önce küçük bir düzeltme yapılacak.**
   `install-services.ps1`e yalnız API'yi kurabilen dar bir seçici
   parametre eklenmesi, File Agent'a hiç dokunulmadan, ayrı küçük bir
   paket olarak yürütülecek (elle/manuel geçici yöntem yerine).
2. **API deploy dizini kopyalama** → **Onaylandı: küçük bir yardımcı
   script ile.** D6'nın File Agent için kullandığı yönteme benzer,
   tekrarlanabilir bir script yazılacak (elle kopyalama yerine).
3. **Agent kaydı (Adım 4c)** → **Onaylandı: uygulama anında kullanıcının
   kendisi elle yapacak.** Yönetici oturumu/şifresi gerektirdiği için
   otomasyona sokulmayacak.
4. **Gerçek Apply zamanlaması** → **Onaylandı: ofis tamamen sakinken,
   önceden planlanmış bir pencerede.** D8 zincirinde görülen kısa
   aktivite patlamalarının riskini azaltmak için.

Bu dört karar kayda geçti. **B3 düzeltmesi TAMAMLANDI (HB-2026-142,
2026-08-04)** — `install-services.ps1` artık File Agent'a hiç dokunmadan
yalnız API'yi kurabiliyor, idempotency guard'ıyla birlikte. **B1'in
mekanizması da TAMAMLANDI (HB-2026-143, 2026-08-04)** —
`deploy-service-artifacts.ps1` yazıldı, test edildi, gerçek makinede
yalnız önizlendi. Gerçek `-Apply` HÂLÂ bu paket içinde başlatılmadı.

**Yeni açık nokta (B7):** deploy edilen `dist/`+`package.json` npm
workspace'in kök `node_modules`'ında hoisted olan çalışma zamanı
bağımlılıklarını taşımıyor — bu, hem API hem (zaten gerçek kurulu) File
Agent için geçerli, servisleri GERÇEKTEN başlatmadan önce ayrıca
çözülmesi gereken bir karar/paket gerektiriyor (üç seçenek §3'te). D9'un
Adım 3-6'sı (gerçekten sakin bir pencerede, kullanıcının açık onayıyla)
B7 çözülmeden servisin gerçekten ÇALIŞTIĞINI garanti etmez — yalnız
kurulum/env adımlarını tamamlar.
