# D9 Per-Case pCloud Reconciliation Mimarisi (HB-2026-162)

Durum: TASARLANDI + salt-okunur/güvenli tooling UYGULANDI. Gerçek repair/
delete/cutover Apply bu pakette YAPILMADI. File Agent'a canlı entegrasyon bu
pakette YAPILMADI (bkz. §8, açık karar gerektiriyor).

## 1. Motivasyon

D9 Adım 0, tek bir global kapıya (`pcloud-post-sync-rebaseline-gate.mjs`,
`test-pcloud-post-sync-rebaseline-gate.ps1` / `test-pcloud-maintenance-window-gate.ps1`
üzerinden çağrılır) dayanıyordu: **P:\ ve C:\HasarBotuStorage altındaki
TÜM tenant ağacının** (bugün ~8650+ dosya) aynı anda 600 saniye kesintisiz
sessiz kalmasını VE tam SHA-256 eşitliğini şart koşuyordu.

HB-2026-148'den HB-2026-161'e kadar süren gerçek olay zinciri bu modelin
canlı bir ofiste operasyonel olarak çalışmadığını kanıtladı:

- Tek bir ilgisiz vakadaki (`56AAG629\HASAR`) gerçek fark, haftalarca TÜM
  cutover'ı durdurdu (B10).
- Sessizlik penceresi defalarca gerçek, meşru ofis aktivitesiyle sıfırlandı
  (`PCLOUD_PENDING_TASKS_FOUND`, `WindowResetCount`).
- Nihayet tam sessizlik (969 sn, 0 reset) elde edildiğinde bile, ağaç genelinde
  gerçek içerik farkları (`SOURCE_TARGET_HASH_MISMATCH_AT_PASS`) bulundu —
  toplamda 27, sonra 22 gerçek fark, 10+ farklı vaka klasöründe dağılmış.
- Bir cleanup Apply'ının (HB-2026-158) doğrudan sebep olmadığı, ama zamanlama
  bakımından örtüşen bağımsız bir pCloud olayı 5 dosyanın kaybolmasına yol
  açtı (HB-2026-159/160/161) — global kapı bunu ne öngördü ne engelledi.

Sonuç: global kapının güvenlik katkısı ("kritik işlem öncesi eski/tutarsız
veri üzerinde çalışılmasın") gerçek, ama **kapsamı yanlış** — hiçbir gerçek
kritik işlem (File Agent taşıma/rename) hiçbir zaman "TÜM tenant ağacının
sessiz olması"na ihtiyaç duymaz; `case_file_operations_one_active_case`
kısıtı zaten her vaka için ayrı, izole bir saga'yı zorunlu kılıyor
(`packages/database/migrations/0012_case_file_operations.js`). Doğru soru
her zaman **"BU vaka senkron mu"**dur, "her şey senkron mu" değil.

## 2. Mimari genel bakış

```
                     ┌─────────────────────────────┐
                     │ pcloud-maintenance-window-   │
                     │ gate.mjs (DEĞİŞMEDİ, sadece  │
                     │ enumerateSourceTree'ye       │
                     │ OPSİYONEL scopeRelativePath) │
                     └──────────────┬────────────────┘
                                    │ reused
                     ┌──────────────▼────────────────┐
                     │ pcloud-post-sync-diff-         │
                     │ forensics.mjs (buildDiffFore-  │
                     │ nsicsReport artık OPSİYONEL    │
                     │ caseRelativePath alır)         │
                     └──────────────┬────────────────┘
                                    │ reused
                     ┌──────────────▼────────────────┐
                     │ pcloud-case-reconciliation.mjs │  <- YENİ
                     │  - PatternClassification       │
                     │    (stale_target/rename_       │
                     │    artifact/unknown)           │
                     │  - CaseStatus (ready/syncing/   │
                     │    conflict/unknown)           │
                     └──────────────┬────────────────┘
                                    │ CLI
                     ┌──────────────▼────────────────┐
                     │ run-pcloud-case-reconciliation │  <- YENİ
                     │ .ps1 (admin-only rapor, File    │
                     │ Agent'ın çağıracağı CLI         │
                     │ sözleşmesi)                     │
                     └──────────────┬────────────────┘
                                    │ tüketir
                     ┌──────────────▼────────────────┐
                     │ repair-post-sync-stale-target- │  <- GENİŞLETİLDİ
                     │ files.ps1 (3. şema adapteri +   │  (2 eski şema
                     │ pre-replace identity fence +    │   DEĞİŞMEDİ)
                     │ sınırlı yeniden deneme)         │
                     └─────────────────────────────────┘

Global kapı (pcloud-post-sync-rebaseline-gate.mjs +
test-pcloud-post-sync-rebaseline-gate.ps1 / test-pcloud-maintenance-window-
gate.ps1): SIFIR SATIR değişti. Artık kritik işlem ÖN KOŞULU değil; periyodik/
manuel bakım-denetim aracı olarak kalır (§5, INV-6).
```

## 3. Bileşenler

| Dosya | Durum | Özet |
|---|---|---|
| `pcloud-maintenance-window-gate.mjs` | genişletildi | `enumerateSourceTree(root, excludedPaths, options)` — opsiyonel `options.scopeRelativePath`; verilmezse davranış birebir eskisiyle aynı (5 mevcut çağrı noktası etkilenmedi, regresyon testiyle kanıtlandı). |
| `pcloud-post-sync-diff-forensics.mjs` | genişletildi | `buildDiffForensicsReport(args)` artık opsiyonel `args.caseRelativePath` kabul eder; verilirse hem tarama hem conflict-name taraması o vaka klasörüyle sınırlanır (per-case izolasyon, INV-3). Verilmezse davranış birebir eskisiyle aynı. |
| `pcloud-case-reconciliation.mjs` | **yeni** | Tek vaka için: diff + PatternClassification + CaseStatus. Salt-okunur, silme yeteneği yok. |
| `pcloud-case-reconciliation.test.mjs` | **yeni** | 10 test: ready/conflict(0-byte+klasik stale_target)/syncing/fail-closed-karışık/rename_artifact/unknown/metadata_only-yoksayma/vaka-klasörü-eksik(iki senaryo)/CLI. |
| `run-pcloud-case-reconciliation.ps1` | **yeni** | Operatör/File-Agent CLI sözleşmesi: admin-only hash'li rapor, güvenli konsol özeti. Gerçek verilerle test edildi (bu paket, §7). |
| `repair-post-sync-stale-target-files.ps1` | genişletildi | 3. şema adapteri (`Get-CandidateEntriesCaseReconciliation`) + PNG/asgari-uzunluk bütünlük kontrolü (uzantıya göre dağıtım, JPEG yolu değişmedi) + kopyalama-öncesi/sonrası kimlik çiti + sınırlı yeniden deneme (`-MaxIdentityRetries`). İki eski şema DEĞİŞMEDİ (11 eski test + 3 yeni test grubu = 14 test, hepsi geçti). |
| `repair-post-sync-stale-target-files.tests.ps1` | genişletildi | +3 test grubu (schema adapter+PNG/PDF dispatch, retry-başarılı, retry-tükendi) — deterministik senkron nokta (`HASARBOTU_TEST_IDENTITY_FENCE_SYNC_MARKER`, yalnız test-opt-in, üretimde asla tetiklenmez). |
| `scripts/check-windows-service-configs.mjs` | genişletildi | Yeni araç + genişletilmiş repair tool için statik denetim satırları. |

Global kapı dosyaları (`pcloud-post-sync-rebaseline-gate.mjs`,
`test-pcloud-post-sync-rebaseline-gate.ps1`, `test-pcloud-maintenance-window-gate.ps1`,
`pcloud-database-quiescence.ps1`): **hiçbiri değiştirilmedi.**

## 4. Sınıflandırma modeli

Her fark (missing/extra/content_mismatch), `metadata_only` hariç:

- **stale_target**: hedef, canlı pCloud nesnesini yansıtmıyor. İki alt-desen:
  - 0-byte/yarım-indirme yer tutucusu (hedef tam 0 byte, pCloud revizyon
    geçmişinde eşleşen 0-byte kayıt) — HB-2026-162'de gerçek 22 farkın 11'i
    bu desendeydi.
  - Klasik: hedefte gerçek eski revizyon, pCloud'da gerçek yeni revizyon.
  - Her iki alt-desen de `repair-post-sync-stale-target-files.ps1`'in
    mevcut, kanıtlanmış aday-ispat mantığıyla (PCloud.found, TaskReferenceCount==0,
    CurrentRow.size==Source.Size, hedef boyutuyla eşleşen AYRI bir revizyon)
    uyumludur — 0 bir geçerli boyut değeridir, özel durum gerekmez.
- **rename_artifact**: aynı vaka içinde bir `missing` ve bir `extra` kaydı
  AYNI SHA-256'yı paylaşıyor — dosyanın taşındığının kanıtı. Bu araç
  YENİDEN ADLANDIRMAYI ÇÖZMEZ, yalnız işaretler (repair tool bunları da
  bloke eder: `TARGET_ONLY_NO_SOURCE_COUNTERPART` / `PATTERN_CLASSIFICATION_NOT_STALE_TARGET`).
- **unknown**: yukarıdakilerle kanıtlanamayan her şey. Asla otomatik
  silinmez/taşınmaz.
- **metadata_only**: tamamen yok sayılır (içerik ispatlı olarak aynı).

Vaka durumu (`CaseStatus`):
- **ready**: gerçek fark yok VE conflict-name artefaktı yok.
- **syncing**: gerçek fark var AMA etkilenen HER dosyada canlı pCloud
  task/fstask referansı var VE hiç conflict-name yok. Fail-closed dar tanım:
  tek bir takılı dosya bile tüm vakayı `conflict`'e düşürür — "bazısı
  senkronda, bazısı takılı" asla "senkron oluyor, bekle" diye maskelenmez
  (bkz. INV-4, repair tool test grubu 5).
- **conflict**: gerçek fark/conflict-name var, canlı senkron kanıtı yetersiz.
- **unknown**: vaka klasörü bir/iki tarafta yok, ya da alttaki diff adımı
  read-only-güvenli bir sebeple başarısız oldu (örn. `PCLOUD_DATABASE_SNAPSHOT_UNSTABLE`
  — gerçek, eşzamanlı pCloud yazma aktivitesinin kendisi kanıtı). File Agent
  freshness gate `unknown`'ı `conflict` ile AYNI şekilde ele almalı — asla
  ilerlemeye izin vermez.

## 5. Güvenlik invariantları

**INV-1 (Kaynak kimlik doğruluğu):** Bir kritik işlem yalnız, işlem ANINDA
taze probe edilmiş belirli bir pCloud fileId+revision+hash+size'a bağlanmış
bayt kullanır. Repair tool kopyalama ÖNCESİ VE hemen replace ÖNCESİ iki ayrı
canlı probe yapar (`pre-replace identity fence`); ikisi arasında kaynak
değiştiyse yalnız o dosya, sınırlı sayıda (`-MaxIdentityRetries`) yeniden
denenir.

**INV-2 (Sessiz veri kaybı yok):** Hiçbir dosya, alternatif kopyanın (repair
için kaynak, cleanup için "gerçekten orphan") canlı doğrulaması yapılmadan
silinmez/üzerine yazılmaz. `extra`/`unknown` HİÇBİR ZAMAN otomatik silinmez
— bu motor yalnız SINIFLANDIRIR, cleanup tool'u hiçbir kod yolunda otomatik
tetiklemez.

**INV-3 (Vakalar arası izolasyon):** A vakasındaki bir blocker, B vakasının
kritik işlemini ASLA geciktirmez/bloke etmez. Tarama kapsamı
(`scopeRelativePath`/`caseRelativePath`) her zaman tek bir vaka klasörüyle
sınırlı; conflict-name taraması da aynı şekilde vaka köküne indirgenmiş
(HB-2026-148...161'de yaşanan tam tersi durumun doğrudan düzeltmesi).

**INV-4 (Belirsizlikte fail-closed):** `ready` dışındaki her durum
(`syncing`/`conflict`/`unknown`) File Agent freshness gate'i BLOKE eder.
`syncing` yalnız TÜM etkilenen dosyalarda canlı kanıt varsa verilir —
karışık durumlar hep `conflict`'e düşer.

**INV-5 (Idempotent + güvenli yeniden deneme):** Her salt-okunur kontrol
tekrar çalıştırıldığında aynı/tutarlı sonucu verir. Her onarım adımı
(staging → doğrula → atomik replace/move) son adıma kadar hedefi
DOKUNULMAMIŞ bırakır; kesinti anında en kötü durum "hiç uygulanmadı", asla
"yarım uygulandı" değildir (mevcut, kanıtlanmış desen — değişmedi).

**INV-6 (Global kapı zayıflatılmadı):** `pcloud-post-sync-rebaseline-gate.mjs`,
`pcloud-maintenance-window-gate.mjs`'in `MINIMUM_QUIET_SECONDS = 600` sabiti,
`test-pcloud-post-sync-rebaseline-gate.ps1`, `test-pcloud-maintenance-window-gate.ps1`
— hiçbiri değiştirilmedi, hiçbir çağrısı by-pass edilmedi. Global kapı hâlâ
tam, doğru, periyodik/manuel bir bütün-tenant bütünlük denetimi olarak
kullanılabilir; yalnızca kritik işlem ÖN KOŞULU olmaktan çıkar.

**Sonuç:** INV-1 + INV-4, global kapının sağladığı güvenlik özelliğini
(eski/doğrulanmamış veri üzerinde kritik işlem yapılmaması) DAHA İNCE
GRANÜLERLİKTE ve DAHA İYİ İZOLASYONLA (INV-3) sağlar. Hiçbir gerçek kritik
işlem hiçbir zaman "bütün ağaç sessiz" girdisine ihtiyaç duymadığından,
kaybedilen tek şey hiçbir kod yolunun gerçekte talep etmediği bir garantidir.

## 6. Test stratejisi

- **Birim testleri (sentetik fixture, `node:test`):** her sınıflandırma
  dalı + her `CaseStatus` dalı + "vaka klasörü eksik" iki senaryosu +
  yapısal "silme yeteneği yok" doğrulaması (statik audit).
- **Regresyon testleri:** `enumerateSourceTree`/`buildDiffForensicsReport`nin
  opsiyonel parametre EKLENMEDEN ÖNCEKİ tüm çağrı şekilleriyle birebir aynı
  davranması (mevcut 31+ test hiç değişmeden geçti).
  `repair-post-sync-stale-target-files.ps1`'in iki eski şeması hiç
  değişmeden geçti (11 eski test).
- **Yeni güvenlik-kritik testler:** identity-fence "başarılı yeniden deneme"
  ve "tükenmiş yeniden deneme → yalnız o dosya bloke" — WALLCLOCK ZAMANLAMAYA
  GÜVENMEDEN, script içine yalnız test-opt-in ortam değişkeniyle etkinleşen
  deterministik bir senkron noktasıyla (`HASARBOTU_TEST_IDENTITY_FENCE_SYNC_MARKER`)
  kanıtlandı — üretimde bu değişken hiçbir zaman ayarlanmaz, no-op kalır.
- **Statik denetim (`scripts/check-windows-service-configs.mjs`):** her yeni/
  değişen dosya için salt-okunur/env-servis-mutasyonu-yok/admin-only-ACL
  desenleri + tüm test suite'lerinin gerçekten çalıştırılıp geçmesi.
- **Gerçek veri doğrulaması:** bu paket, yeni motoru GERÇEK 10 vaka
  klasörüne karşı çalıştırdı (§7) — sentetik fixture'ların gerçek pCloud DB
  şemasıyla/davranışıyla uyumlu olduğunu kanıtladı; bu süreçte 2 gerçek
  hata bulundu ve düzeltildi (PowerShell wrapper StrictMode altında eksik
  JSON alanları; `missing` girdileri için yanlış PatternNote metni) —
  sentetik testler bu hataları YAKALAMADI, yalnız gerçek veri yakaladı.

## 7. Bu paket içinde gerçek verilerle sınıflandırılan 10 vaka

`run-pcloud-case-reconciliation.ps1` ile, HB-2026-155/159-162'de bilinen 22
gerçek farkın dağıldığı 10 vaka klasörü tek tek, salt-okunur taze taramadan
geçirildi:

- 7/10 vaka: `conflict` (2 stale_target, 1 stale_target, 1 stale_target
  [+10 metadata_only], 7 stale_target, 2 rename_artifact+23 unknown [bkz.
  aşağıdaki not], 1 unknown, 2 stale_target [+2 metadata_only]).
- 3/10 vaka: `unknown`, gerekçe `PCLOUD_DATABASE_SNAPSHOT_UNSTABLE` —
  taramanın YAPILDIĞI ANDA gerçek, eşzamanlı pCloud yazma aktivitesi
  sürüyordu (yeniden denemede de aynı sonuç — geçici değil, gerçek).
- 0/10 vaka: `ready` veya `syncing`.

**Not (rename_artifact+unknown çoğunluklu vaka):** bu vaka, bir önceki günkü bütün-ağaç taramasında
görülenden çok daha fazla fark gösterdi (kaynakta 26, hedefte yalnız 3
dosya, 24'ü `missing`). Dosya adı deseni (`OLAY YERİ 101-115`, standart
EVRAK evrak seti) yakın zamanda kaynağa yapılan toplu bir kanıt yüklemesiyle
tutarlı — hedefin henüz yetişmediği, GÜVENLİ yönde (kaynak var, hedef yok —
üzerine yazılma riski yok) bir durum. `syncing` yerine `unknown` olarak
sınıflandırıldı çünkü 24 dosyanın TAMAMINDA canlı pCloud task kanıtı yoktu —
fail-closed, zorla çözülmedi.

Tam yollar + PCloud detayı yalnız admin-only raporlarda (her vaka kendi
raporunu yazdı + konsolide indeks: `per-case-reclassification-index-*.json`).

## 8. Kapsam dışı / ertelenen: File Agent canlı entegrasyonu

`run-pcloud-case-reconciliation.ps1` net bir CLI sözleşmesi sunar (JSON
stdout + exit code: 0=ready, 2=ready-değil, 1=hata) ve File Agent'ın (
`services/file-agent`) kritik işlem öncesi bunu çağırabilmesi için hazırdır.
**Bu paket bu çağrıyı GERÇEKTEN YAPMAZ** — çünkü tek, gerçek, henüz
cevaplanmamış bir mimari/güvenlik kararı var:

**Açık karar:** File Agent, HB-2026-113/114/115/116 kararıyla kasıtlı olarak
`SeDenyInteractiveLogonRight` ile kısıtlı, ayrı bir servis hesabı
(`svc-hb-fileagent`) altında çalışır. pCloud'un yerel SQLite DB'si
(`%LOCALAPPDATA%\pCloud\data.db`) İSE pCloud masaüstü istemcisini çalıştıran
ETKİLEŞİMLİ kullanıcının (`-PCloudSyncAccount`) profili altındadır. Bugün
`svc-hb-fileagent`'ın bu dosyaya okuma erişimi YOKTUR (yalnız depolama
KÖKÜNE NTFS Modify erişimi var, HB-2026-115). Per-case freshness gate'in
gerçekten çalışması için ya:

1. `svc-hb-fileagent`'a `PCloudSyncAccount`'un `%LOCALAPPDATA%\pCloud\`
   klasörüne salt-okunur, en-az-yetkili NTFS erişimi açıkça verilmeli
   (HB-2026-113+'ün TERSİ yönünde, aynı titizlikte bir karar/uygulama
   gerektirir), VEYA
2. Kontrol, etkileşimli oturumda çalışan ayrı bir küçük yardımcı süreç/
   servis üzerinden (isimlendirilmiş boru/yerel HTTP) File Agent'a
   aktarılmalı, VEYA
3. Başka bir kabul edilebilir köprü tasarlanmalı.

Bu, AGENTS.md §7'nin "kritik işlem standardı" kapsamına giren, belgelerde
cevabı olmayan gerçek bir güvenlik/ürün kararıdır — bu paket kapsamında
TEK TARAFLI karar verilip uygulanmadı. Önerilen varsayılan: seçenek 1
(mevcut, kanıtlanmış en-az-yetki NTFS ACL desenini tekrar kullanmak), ama
kesinleştirme açık kullanıcı onayı gerektirir.

**Güncelleme (HB-2026-163, 2026-08-07):** seçenek 1 için tam PLAN + PREVIEW
hazırlandı ve gerçek makinede çalıştırıldı: `preview-file-agent-pcloud-db-
access.ps1` (+ `.tests.ps1`, 5 test). Gerçek ACL taramasıyla kanıtlandı:
ata zincirinde YALNIZ 5 düğüm (sürücü kökü + kullanıcı profili + AppData +
Local + pCloud klasörü) yeni Traverse ACE gerektiriyor, `C:\Users` zaten
`Everyone` üzerinden yeterli (bu ayrım ilk elle yapılan analizde YANLIŞ
tahmin edilmişti — `BUILTIN\Users` ile `Everyone`/`Authenticated Users`
karıştırılmıştı; aracın kesin SID bazlı simülasyonu bu hatayı yakaladı).
Toplam 6 ACE planı çıkarıldı (5 Traverse + 1 Read+Synchronize, hiçbiri
yazma/silme biti içermiyor, hem statik hem çalışma zamanı öz-kontrolüyle
doğrulandı). **Apply YAPILMADI** — bu hâlâ ayrı, açık bir kullanıcı kararı
gerektiriyor; bu güncelleme yalnız "plan hazır ve doğrulandı" durumunu
kaydeder.

**Güncelleme (HB-2026-164, 2026-08-07):** ayrı bir Apply+Rollback aracı
(`apply-file-agent-pcloud-db-access.ps1`, + `.tests.ps1`) hazırlandı;
yalnız preview raporunun ürettiği exact ACE'leri kabul eder, Apply öncesi
preview'ı taze yeniden çalıştırıp raporla karşılaştırır, her dokunulacak
düğümün ACL'ini raporun baseline'ıyla karşılaştırır (drift'te fail-closed),
rollback tam SDDL'yi birebir geri yükler. `NT AUTHORITY\LOCAL SERVICE`
hedef kimlikle sentetik ortamda GERÇEK ACL mutasyonu + gerçek rollback +
WAL/SHM mirasının gerçek kanıtı uçtan uca doğrulandı (5 test). Servis
hesabı bağlamında Zamanlanmış Görev tabanlı gerçek okuma testi denendi;
bu makinede `SeBatchLogonRight` eksikliği/servisin Disabled olması
nedeniyle tamamlanamadı — bu YENİ bir hak sessizce verilerek gizlenmedi,
dürüstçe raporlanır. Gerçek `svc-hb-fileagent` ACL'ine hâlâ **Apply
YAPILMADI** — gerçek makinede yalnız (değişmeyen) preview aracı tekrar
çalıştırıldı, sonuç aynı: 6 ACE hâlâ eksik.

`services/file-agent`'ın TypeScript kodu bu paketle HİÇ değiştirilmedi.

## 9. D9 planına etkisi

`docs/D9_OPERATIONAL_CUTOVER_PLAN.md` §0/Adım 0 artık bu belgeye referans
verir: global gate hâlâ mevcut, hâlâ doğru, ama artık D9 Apply sırasının
TEK ön koşulu değil. D9'un geri kalanının (Adım 1-6) bu yeni modele göre
YENİDEN sıralanıp sıralanmayacağı — ayrı, açık bir kullanıcı kararı
gerektirir; bu paket yalnız temeli kurar ve gerçek verilerle doğrular.
