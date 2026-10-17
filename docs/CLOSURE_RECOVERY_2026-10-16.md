# Dosya kapatma düzeltmesi — 16 Ekim 2026

**PASS:** Bildirilen gerçek dosya Agent üzerinden kapandı. Kaynak klasör artık bulunmuyor; kapalı dosyalar hedefindeki **86 dosya / 23.022.812 bayt** bağımsız olarak yeniden hash'lendi ve işlem öncesi manifestle eşleşti. Dosya `closed`, fiziksel işlem `ready`, iş `succeeded`; ilk yeniden deneme başarılı. Önceki kullanıcı onayı, atamalar ve iş alanları korundu. Özel dosya kimlikleri ve tam kayıt yedeği Git dışında tutulur.

## Neden ve değişiklik

Agent, taşıma öncesinde kaynak ve hedefe aynı içerik güncelliği kontrolünü uyguluyordu. Yeni hedef henüz mevcut olmadığı için `TARGET_CASE_ROOT_NOT_FOUND` ile reddediliyor; beş deneme sonunda işlem `case_not_fresh` nedeniyle başarısız oluyordu. Arayüz 80 sorgudan sonra takibi bıraktığı için son `moving` durumunu göstermeye devam ediyordu.

- `file_destination` kontrolü eklendi. Yalnız henüz bulunmayan hedef için yerel dosya sistemi ve pCloud ad alanının boşluğu doğrulanır. Bekleyen eşitleme işleri, çakışan bulut kaydı ve yol bağlantıları reddedilir. Var olan hedefler tam içerik kontrolüne girer; kaynak içerik doğrulaması korunur.
- Agent hedef denetimini bu amaçla çağırır. Gerçek gate ve gerçek dosya taşıma kullanan regresyon testi önce başarısız oldu, düzeltmeyle geçti.
- Arayüz pencere açıkken terminal sonuca kadar izlemeye devam eder; kapanınca takibi durdurur. Hata sonucu açıkça gösterilir; bağlantı hatasından sonra durum sorgusu yeniden başlatılabilir.
- Küçük ekran kapatma önizlemesinde iç içe kaydırma kaldırıldı; evrak listesi okunabilir kalırken alt işlem düğmeleri sabit tutulur.

Ofiste mevcut dosya hashleri doğrulanıp yalnız `services/file-agent/dist/agent.js` ve `tools/pcloud-session0-freshness-gate.mjs` yedeklendi ve değiştirildi. Yalnız File Agent yeniden başlatıldı. Onaylanmış aynı işin kayıtları yedeklendi; kaynak ve hedef yeniden doğrulanıp mevcut onay korunarak iş atomik ve denetlenebilir biçimde yeniden kuyruğa alındı. Kapanış durumu Agent'ın doğrulanmış sonucuyla API tarafından tamamlandı.

## Doğrulama

- File Agent: **314/314 PASS**.
- Güncellik/boş hedef, çakışma ve eşitleme güvenlik testleri: **13/13 PASS**.
- Ortak pencere ve uzun kapanış takibi regresyonları: **11/11 PASS**.
- Son hata penceresi: iki tema ve iki genişlikte **4/4 görsel PASS**. Önceki arayüz taraması **120/120 PASS**.
- ESLint, UI ve Agent derlemeleri, Agent TypeScript, Windows servis/depolama yapılandırma kontrolü ve `git diff --check`: **PASS**.
- Son **0.1.31** Windows x64 paketi: gerçek açılış, 56 UI dosyası bütünlüğü, bağlantı profili ve tepsi davranışı **PASS**.
- Yerel kurulum **0.1.31**, normal yeniden açılış ve `ready:true`; gerçek kullanıcı oturumu HTTP **200**, kapalı dosya sorgusu HTTP **200 / closed**.

Ofis kod yedeği: `%ProgramData%\HasarBotu\office-management\closure-fix-20261016-backup`.

Son yerel profil yedeği: `%LOCALAPPDATA%\HasarBotuUpdateBackups\0.1.30-to-0.1.31-20261016-093240`. Önceki doğrulanmış 0.1.30 kurulum paketi de korunur.

Paket: `.local/closure-stuck-20261016/release-ui-final/HasarBotu-Setup-0.1.31.exe`. SHA-256: `051b39634addadb4df68c9da5411340b4009ace4cf78e67b14e786ff885843c8`. İlk yerel kurulumda ofis yayını değiştirilmemişti. Aynı doğrulanmış paket daha sonra [ortak güncelleme kaynağına](DESKTOP_UPDATES.md) 0.1.31 olarak yayımlandı.

Kanıtlar `.local/closure-stuck-20261016/`: `regression-red.log`, `agent-suite.log`, `gate-tests.log`, `ui-tests.log`, `deployment-proof.json`, `requeue-proof.json`, `final-case-proof.json`, `failure-visual-proof.json`, `package-smoke-final.log`, `installed-runtime-proof.json`, `installed-api-proof.json`.

## 33 NA 778 — kaynak kanıtı ve taşınmış klasörün kapanışı

**PASS:** 16 Ekim 2026 18:30 Türkiye saatiyle gerçek dosya kapandı. Agent sonucu `verified`, iş `succeeded`, fiziksel işlem `ready`, yaşam döngüsü ve dosya `closed`. Son deneme bir kez çalıştı. Hedefteki **38 dosya / 13.404.492 bayt**, işlem öncesi manifest ve bütün SHA-256 değerleriyle eşleşti; kaynak konum bulunmuyor. Önceki kullanıcı onayı ve iş alanları korundu.

Bu vakada üç ayrı koşul birleşti:

- 18 belgenin güncel pCloud sürümü için kaynak kanıtı yoktu. Saatlik kaynak görevi, doğrudan P: sürücüsüne geçişten sonra eski bağımsız ayna koşulunda duruyordu. `findCasesNeedingAttestation` artık yalnız açıkça belirtilen gerçek kaynak kökü ve onun altındaki aynı vaka yolu için doğrudan sürücü kipini destekler. Varsayılan ayna denetimi, gerçek içerik hash'leri ve işlem öncesi/sonrası pCloud kimlik/sürüm sınamaları korunur.
- Windows pCloud sürücüsü bu klasörün yerel taşımasını `EPERM` ile reddetti. Onaylı klasör, pCloud üzerinden aynı klasör ve belge kimlikleri korunarak taşındı. İstemci eski konumu önbellekte tuttu; normal kapanış sonuç vermeyince istemci durduruldu, SQLite profil dosyaları yedeklendi ve mevcut profil yeniden açıldı. Yerel sürücü yeni konumu bundan sonra doğruladı.
- Agent, kaybolmuş sonuç için mevcut kurtarma koduna ulaşmadan bulunmayan kaynağı reddediyordu. Kaynak gerçekten yoksa ve hedef güncelse yürütücü artık aynı iş kimliği/sürümü için önceden yazılmış işlem kanıtını ve hedef manifestini doğrular. Eşleşmeyen kanıt manuel kurtarma gerektirir. Keşif yeni konumu daha önce işlemişse API yalnız tam beklenen bir sonraki konum sürümünü, doğrulanmış hedefi ve `recovered_after_rename` sonucunu kabul eder; konum sürümünü ikinci kez artırmaz. Farklı yol, sonraki sürüm ve doğrulanmamış hedef reddedilir.

Kaynak görevinin sürümlenen uygulaması `deploy/windows-service/office-source-refresh.cjs`; başlatıcısı `run-office-source-refresh.ps1`. Ofise özeldir, mevcut korumalı yapılandırmayı ve servis ortamını kullanır. Saatlik genel tarama korunur. Onaylı dosya işlemlerinden `case_not_fresh` nedeniyle bekleyenler ayrıca **dakikada bir** seçilir. İki görev ortak mutex kullanır. Boş kuyrukta pCloud veritabanı taranmaz; başarısız kaynak kontrolü artık son durum raporunu da `FAIL` yapar. Belgeler ve vaka iş alanları bu görev tarafından değiştirilmez.

2026-10-17: Görevler PowerShell'i `run-office-source-refresh.vbs` üzerinden pencere stili 0 ile başlatır; doğrudan PowerShell başlatılırken görülen kısa konsol parlaması böyle önlenir. `set-office-source-refresh-launcher.ps1 -SourceRefreshDirectory <korumalı-dizin> -BackupDirectory <yedek-dizini>` mevcut görev XML'lerini korur ve yalnız eylemi değiştirir. İki başlatıcı dosyası aynı korumalı dizinde bulunmalıdır. Görev kullanıcıları, zamanlamalar, mutex ve çıkış kodları korunur.

Doğrulama:

- File Agent **315/315 PASS**, gerçek gate ile kaybolmuş sonuç ve ilgisiz işlem kanıtı dahil.
- Gerçek PostgreSQL üzerinde kapanış, dosya işlemleri ve Agent API testleri **48/48 PASS**. Yeni keşif/kurtarma testi düzeltmeden önce başarısız oldu; olumlu ve üç olumsuz durum düzeltmeyle geçti.
- Kaynak kanıtı testleri **24/24 PASS**; doğrudan kök, değişmiş sürüm, yol kaçışı ve yanlış kök kontrolleri dahil.
- TypeScript, ESLint, API ve Agent derlemeleri **PASS**.
- Genel kaynak taraması önizlemesi **627 vaka / 36.907 belge** inceleyerek eski kök hatasını aştı. Eksik veya okunamayan kaynaklar doğrulanmış sayılmaz ve korumalı raporda tutulur.
- Gerçek genel yenileme **58 vaka / 2.613 kaynak belgesi** için kanıt yazarak tamamlandı. Genel sonuç **PARTIAL**: mevcut konum kaydıyla eşleşen klasörü bulunamayan diğer **21 vaka `ENOENT`** ile tutuldu; bunlar doğrulanmış sayılmadı. Bu sınırlama kapanışı tamamlanan 33 NA 778 için geçerli değildir. Ayrıntılar ofisteki korumalı `source-refresh/latest.json` raporundadır.
- Dakikalık gerçek görev **0 çıkış kodu**, boş bekleme kuyruğu ve `PASS` raporuyla doğrulandı. Dört servis çalışıyor; API sağlıklı, pCloud açık; geçici tanı görevleri ve 9229 dinleyicisi bulunmuyor.

API, Agent ve kaynak araçları hash denetimli yedek alınarak ofis çalışma ortamına uygulandı. Masaüstü **0.1.32** korunur; bu düzeltme merkezi servislerdedir. Özel kayıtlar ve kanıtlar Git dışındaki `.local/closure-33na778-20261016/` ile ofisteki korumalı `office-management/closure-33na778-20261016` dizinindedir. `final-case-proof.json` canlı dosya kapanışını; `final-runtime-proof.json` servisleri ve dağıtılan dosya hash'lerini kaydeder.
