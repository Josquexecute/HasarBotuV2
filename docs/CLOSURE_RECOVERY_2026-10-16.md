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

Paket: `.local/closure-stuck-20261016/release-ui-final/HasarBotu-Setup-0.1.31.exe`. SHA-256: `051b39634addadb4df68c9da5411340b4009ace4cf78e67b14e786ff885843c8`. Ofis masaüstü güncelleme yayını değiştirilmedi.

Kanıtlar `.local/closure-stuck-20261016/`: `regression-red.log`, `agent-suite.log`, `gate-tests.log`, `ui-tests.log`, `deployment-proof.json`, `requeue-proof.json`, `final-case-proof.json`, `failure-visual-proof.json`, `package-smoke-final.log`, `installed-runtime-proof.json`, `installed-api-proof.json`.
