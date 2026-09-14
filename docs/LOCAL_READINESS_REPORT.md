# HasarBotu V2 — Yerel hazırlık raporu

Tarih: 2026-09-13. Kapsam: bu kaynak kopyasının geliştirme, statik inceleme ve
derleme hazırlığı. Production başka bilgisayardadır. Kullanıcı test aşamasını
sonraya bıraktı; bu rapor production kabulü veya bütün davranışların hatasızlık
garantisi değildir.

Sonraki adım tamamlandı: kullanıcının ayrı talimatıyla yerel test ortamı
kuruldu. Güncel ortam ve 93 hedef test / 23 bağlantı kontrolü sonucu
[test ortamı kılavuzunda](./LOCAL_TEST_ENVIRONMENT.md) kayıtlıdır. Aşağıdaki
UNRUN satırları ilk kod hazırlığı aşamasının tarihsel sonucudur.

En son yerel ek: [Windows yardımcısı](./DESKTOP_ASSISTANT.md). Güncel paket
`apps/desktop/release/assistant/HasarBotu-Setup-0.1.2.exe`; aşağıdaki son ekte
111 test ve 23 ortam kontrolünün kapsamı belirtilmiştir.

## Yapılan değişiklikler

- Node `24.21.0` / npm `11.19.0` proje içine kuruldu; resmi arşivin SHA-256
  değeri doğrulandı. Sistem Node'u ve mevcut kurulu uygulama değiştirilmedi.
- Güvenlik bulgularıyla sınırlı bağımlılık güncellemesi yapıldı: Fastify
  `5.10.0 → 5.12.1`, PDF.js `6.1.200 → 6.2.108`, Vitest ailesi
  `4.1.10 → 4.1.11`; `fast-uri`, `js-yaml` ve `@xmldom/xmldom` aynı sürüm
  serilerindeki düzeltmelere taşındı. Lockfile npm ile üretildi; zorlayıcı
  `audit fix --force` veya toplu major sürüm değişimi yapılmadı.
- npm kurulum betikleri gerekli paketlerin incelenmiş sürümleriyle sınırlandı.
  Son kurulumda incelenmemiş kurulum betiği kalmadı.
- File Agent'ın `HASARBOTU_AGENT_ROOTS` ayrıştırma hatası, ham JSON/yerel yol
  veya kök anahtarını hata mesajına taşımayacak şekilde düzeltildi. Altı
  geçersiz girdi ve bir geçerli yapılandırma için regresyon testi eklendi;
  **testler henüz çalıştırılmadı**.
- ESLint'in yerel yedek konfigürasyonunu ikinci TypeScript kökü sayması
  giderildi; `.local` ve paketleme çıktıları kaynak taramasından çıkarıldı.
  Kaynak lint kuralları gevşetilmedi.
- Electron paketleme filtresi tüm alt dizinlerdeki `.map` dosyalarını dışlar.
  İlk pakette bulunan 199 declaration map son pakette yoktur.
- README ve mimari belgesinin başlangıcı mevcut yerel storage mimarisine
  uyarlandı. [Geliştirme komutları](./LOCAL_DEVELOPMENT.md) eklendi.

## Doğrulama

Komutlar proje kökünde, yerel Node 24 seçilerek çalıştırıldı. PASS satırları
çıkış kodu 0 ile tamamlandı; eski 2.350 test kaydı bu çalışmanın sonucu değildir.

| Kontrol | Sonuç |
|---|---|
| Güncel lockfile ile temiz `npm ci` ve workspace prepare | PASS |
| Tüm workspace'lerde `npm run typecheck` | PASS |
| `npm run lint` | PASS — 0 hata, 13 mevcut uyarı |
| `npm run build` ve içerdiği bundle kontrolü | PASS |
| JavaScript/TypeScript sözdizimi taraması | PASS — 892 dosya |
| PowerShell AST sözdizimi taraması | PASS — 41 betik |
| `npm audit` | PASS — ilk 7 bulgu, son 0 bulgu |
| Windows x64 NSIS paketleme | PASS |
| Paket/source build karşılaştırması | PASS — 245 dosya, 0 fark |
| Paket içinde `.map`, credential/env/log dosya adları taraması | PASS — 0 eşleşme |
| Unit/component/API/DB/File Agent/Electron testleri | UNRUN — kullanıcı sonraya bıraktı |
| `npm run check:deploy` | UNRUN — betik testleri de çalıştırdığı için sonraya bırakıldı |
| Gerçek API, görsel UAT, install/launch/uninstall | UNRUN |

Statik incelemede API route kayıtları, oturum/rol kapıları, karantina
API/contract/UI bağlantısı, legacy case detayları, Electron güvenlik ayarları,
File Agent yapılandırması/yol çözümleme ve PDF girişleri gözden geçirildi.
Otomatik sözdizimi, tip ve lint taraması tüm ilgili kaynaklara uygulandı;
bütün dosyaların satır satır bağımsız insan denetiminden geçtiği iddia edilmez.

## Çıktı ve kalan işler

- Installer: `apps/desktop/release/HasarBotu-Setup-0.1.2.exe`.
  Masaüstü hedefi x64; paket imzasızdır. Sürüm yükseltilmedi ve kurulum yapılmadı.
- Derleme çıktıları kök ve workspace `dist` dizinlerindedir. Loglar, değişiklik
  öncesi yedekler, kaynak hash envanteri ve artefakt hash manifesti
  `.local/readiness` altında tutulur; Git kapsamı dışındadır.
- Git geçmişi olmayan kaynak kopyasında yeni geçmiş uydurulmadı; commit/push yoktur.
- Lint'in 11 uyarısı kullanılmayan eski disable yorumları, 2 uyarısı mevcut
  dosya bazlı React effect istisnalarıdır. Paketleme varsayılan Electron
  ikonunu kullanır; kurulumdaki mevcut V1/V2 isim ayrımı kabul aşamasında görülmelidir.
- Test DB/API/agent ortamı kurulmadı. Sonraki aşama sentetik PostgreSQL/storage
  ile yeni config regresyonunu ve etkilenen PDF/API testlerini, ardından root
  suite ve iki çözünürlük/iki temada masaüstü kabulünü çalıştırmaktır.

Bağımlılık bulgularının kaynakları: [Fastify](https://github.com/fastify/fastify/security/advisories/GHSA-w2qp-rph6-63g4),
[PDF.js](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j),
[Vitest](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9),
[js-yaml](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh).
PDF.js bildirimi scripting/viewer koşullarını, Fastify bildirimleri belirli
şema/proxy koşullarını tarif eder; bu kurulumda fiilen sömürüldükleri iddia edilmez.

## Windows yardımcısı eki — 2026-09-13

- Ayrı, şeffaf, üstte kalan Electron penceresi; sürükleme, kalıcı konum,
  klavye erişimi, mevcut uygulama kısayolları ve sistem tepsisinden geri açma.
  Ayrı sandbox preload/session; gönderen/frame/URL/komut doğrulaması.
- Vite'ın installer DLL'lerini izleyerek paketleme sırasında EPERM/EBUSY
  üretmesi ve test UI sürecini düşürmesi giderildi. `release` ve `.local`
  izleme dışındadır. Gerçek Vite watcher ile regresyon ve UI açıkken standart
  paketleme yeniden çalıştırıldı; ardından ortam kontrolü geçti.

| Güncel kapı | Sonuç |
|---|---|
| Desktop suite, gerçek PostgreSQL ve Electron dahil | PASS — 110/110, 0 skip |
| Vite watcher regresyonu | PASS — 1/1 |
| Desktop typecheck | PASS |
| Root lint | PASS — 0 hata, 13 mevcut uyarı |
| Root build; son Vite değişiminden sonra UI build/bundle | PASS |
| Standart NSIS x64 paketleme, UI açıkken | PASS |
| Paket/build dosya karşılaştırması | PASS — 251 dosya, 0 fark |
| Paket adlarında map/env/credential/log taraması | PASS — 0 eşleşme |
| Yerel PG/API/UI/File Agent kontrolü | PASS — 23/23 |
| Yardımcı light/dark Electron render, overflow | PASS |
| 1366×768 / 1920×1080 çalışma alanı geometrisi | PASS — otomatik birim testi |
| Fiziksel fare/dokunmatik, çok monitör ve iki çözünürlükte görsel kabul | BLOCKED — `@oai/sky` masaüstü kontrol modülü yüklenemedi |
| Installer install/uninstall ve production kabulü | UNRUN |
| Tam root test zinciri | UNRUN — bu değişiklikte desktop kapsamı çalıştırıldı |

Electron testinde donanım imleci deterministik verilerek gerçek
preload → IPC → native pencere hareketi ve dosyaya kayıt doğrulandı.
Pointer/klavye olayları ayrıca gerçek renderer kaynağından DOM testleriyle
kontrol edildi. Chromium `sendInputEvent` üzerinden fiziksel giriş denemesi
bu ortamda pointer olayı üretmedi; fiziksel kabul PASS sayılmadı.

Yeni aday: `apps/desktop/release/assistant/HasarBotu-Setup-0.1.2.exe`,
102.653.204 bayt, x64, **NotSigned**. SHA-256 ve dosya karşılaştırması
`.local/readiness/assistant-artifact-review.json` içinde kayıtlıdır.
Önceki paket ayrı dizininde korunur. Kaynak kopyasında `.git` yoktur;
commit/push, production deploy veya kurulum yapılmadı.
