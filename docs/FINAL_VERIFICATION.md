# Son kontrol ve GitHub aktarımı

2026-09-13. Kullanıcı son kontrollerin yapılmasını ve kodun kendi GitHub
hesabına yüklenmesini istedi. Mevcut `Josquexecute/HasarBotuV2` deposunun
`foundation/package-56-ai-evidence-enrichment` dalı ile kaynak eşleştirildi;
başlangıç commit'i `dce9912`. Önceki Git geçmişi korunur. Bu işlem production
deploy, version bump veya release yayını değildir.

## Kapsam

- Windows genelinde yardımcı pencere, güvenli ayrı preload/session,
  konum kaydı, mevcut uygulama kısayolları ve sistem tepsisi menüsü.
- Vite watcher'ın yerel DB/araç/installer dizinlerini dışlaması ve root
  arayüz testlerinin yalnız `src` dizininden toplanması. Diğer workspace
  testleri `npm test` zincirindeki kendi adımlarıyla çalışır.
- Mevcut hazırlıktaki dar bağımlılık güvenlik güncellemeleri, File Agent
  config hata redaksiyonu ve installer source map dışlama düzeltmesi.
- Windows `TEMP` yolunun 8.3 kısa adıyla kanonik uzun adını eşit kabul eden
  test varsayımları düzeltildi. File Agent assertion'ı gerçek yolları
  karşılaştırır; junction kök alias'ı için ek regresyon vardır. ACL testleri
  fixture yollarını preview ile aynı `GetFullPath` biçiminde oluşturur.
  Runtime yol/ACL güvenlik kuralları gevşetilmedi; hedef testler ve ACL
  rollback'in tam geri yükleme kontrolleri geçti.
- Windows dağıtım test çalıştırıcısı yalnız kendi process/child process
  `TEMP`/`TMP` değerlerini kanonik yola çevirir; makine ortamı değişmez.
  Servis planı testleri PostgreSQL Windows servisi, WinSW veya gerçek pCloud
  ACL önkoşulları bulunmadığında `blocked_structural`/başarısız önizleme
  davranışını doğrular. Bu makineye bağlı olumlu kabul adımları açıkça SKIP
  bildirilir; production hazırmış gibi geçirilmez.

## Kapılar

| Kontrol | Sonuç |
| --- | --- |
| Tam `npm test` zinciri | PASS: 2.394 başarılı, 6 atlanan; çıkış kodu 0 |
| Temiz kaynak kopyasında `npm ci` | PASS: bağımlılıklar ve prepare tamamlandı |
| Temiz kaynakta typecheck / lint / build | PASS; lint 0 hata, mevcut 13 uyarı |
| PostgreSQL + HTTP + File Agent ortam kontrolü | PASS: 23/23; tam test zincirinden sonra doğrulandı |
| `npm audit` | PASS: 0 bulgu |
| Windows x64 installer içerik kontrolü | PASS: 251 dosya eşleşti, 0 fark, 0 beklenmeyen dosya |
| Son ACL Apply/Rollback hedef testi | PASS: 6 senaryo, 0 hata; geçici sürücü temizlendi |
| Windows dağıtım araçlarının tam zinciri | PENDING: son ACL düzeltmesinden sonra tam `check:deploy` tekrarlanmadı |

Test dağılımı: UI 394, domain 810, contracts 330, database 78,
desktop-bridge 10, API 543, File Agent 118, desktop 111. UI'daki 6 live
adapter testi ayrı live konfigürasyonu verilmediği için SKIP; başarılı
sayısına dahil değildir. Electron testleri gerçek Electron sürecini kullanır.

ACL incelemesinde rollback'in değişmemiş sahipliği yeniden atamaya çalışması
ve Windows'un DACL auto-inheritance bayrağını normalleştirmesi bulundu.
Rollback sahiplik değişimini reddeder, DACL'yi kayıtlı biçimde geri yükler;
miras alınan haklar değiştiğinde alt dosyalara geri alma uygulanır.
Önceki testten kalan 10 izin kaydı tam olarak geri yüklendi ve doğrulandı.
Yeni ACL testleri geçici bir SUBST sürücüsünde çalışır; sistem kökü ve
kullanıcı profili test ancestor zincirinin dışında kalır. Windows'un
[miras aktarımı](https://learn.microsoft.com/en-us/windows/win32/secauthz/automatic-propagation-of-inheritable-aces)
ve [SetFileSecurity davranışı](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-setfilesecurityw)
düzeltmenin değerlendirilmesinde kullanıldı.

Node 24.21.0 / npm 11.19.0 ve ayrı PostgreSQL 17.11 test ortamı kullanıldı.
Loglar ve installer SHA-256 manifesti yalnız `.local/readiness` altında tutulur.
Son kullanıcı talimatıyla GitHub push işlemi kullanıcıya bırakıldı.

## Kalan kabul

Fiziksel fare/dokunmatik, çok monitör, 1366×768 / 1920×1080 görsel Windows
kabulü ve installer install/uninstall henüz tamamlanmadı. Bu oturumun
`@oai/sky` masaüstü kontrol modülü yüklenemedi. Otomatik Electron testleri
gerçek pencere/preload/IPC/menü/navigation/persistence zincirini çalıştırır;
donanım imleciyle manuel kullanıcı kabulünün yerine geçmez.

Gerçek V1 verileri ve beş karantina kaynağı başka bilgisayardadır. Yerel
kontroller ayrı, sentetik test DB'sini kullanır. Production verisi/servisleri
değiştirilmez. Installer adayı imzasızdır ve GitHub kaynak commit'ine dahil
edilmez. `.local`, DB/storage, parolalar, bağımlılıklar, loglar ve derleme
çıktıları `.gitignore` ile dışarıda kalır.
