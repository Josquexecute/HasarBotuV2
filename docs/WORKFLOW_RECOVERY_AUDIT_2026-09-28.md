# İzole iş akışı ve hata kurtarma denetimi — 2026-09-28

## Ortam ve kapsam

- Node 24.21.0; ayrı PostgreSQL kümesi: `.local/workflow-audit-postgres`, yalnız `127.0.0.1:55439`.
- Ayrı `workflow_audit_test`, `workflow_regression_test`, `workflow_live_test` veritabanları; geçici sentetik dosya kökleri.
- Üretim/pilot verisi kullanılmadı. Harici AI ve pCloud hizmetlerinin canlı çalışması bu denetimin kapsamı dışındadır; ilgili sınırlar mevcut test çiftleriyle sınanır.
- Yeni birleşik senaryo: API ile dosya oluşturma → klasör planı/onayı → gerçek Agent ile klasör hazırlama → belge doğrulama → gerekçeli eksik evrakla kapanış → taşımadan sonra kuyruktaki fotoğrafı doğrulama → yeniden açma. Her aşamada API, veritabanı ve fiziksel dosya sonucu kontrol edilir.
- Mevcut paket testleri normal kapanış, Kasko kontrolleri, değer kaybı, ücret onayı/raporlama, yetki/kiracı sınırları, oturumlar, PDF/OCR, e-posta taslakları ve masaüstü akışlarını kapsar.

## Yeniden üretilen ve düzeltilen sorunlar

| Sorun | Yeniden üretim | Düzeltme |
|---|---|---|
| Sonlanan taşıma işi kapanışı `moving` durumunda bırakıyordu. | Hedefte yabancı içerik, plan sonrasında kaynak değişimi, son başarısız sonuç ve fiziksel taşıma sonrası son lease'in kaybı. | Terminal hata bağlı lifecycle kaydına ve audit'e aynı transaction içinde aktarılır. Son lease kaybında fiziksel sonuç belirsiz olduğu için manuel kurtarma gerekir. Geçici hata yeniden denemeyi ve aktif işlem korumasını sürdürür. |
| Doğrulama işi `dead_letter` olduğunda belge/fotoğraf sonsuza kadar `pending` kalıyordu. | Belge ve fotoğraf için son başarısız sonuç ve lease süresinin dolması: dört senaryo. | Yalnız hâlâ `pending` hedefler `failed` yapılır. Tükenen lease'in hata nedeni ve audit kaydı eklenir. Daha önce doğrulanmış kayıtlar korunur; tekrar bildirim audit'i çoğaltmaz. |
| Kapanıştan sonra dosya işleri ve metadata okuması eski fiziksel yolu kullanıyordu. | Kapanış taşımasının arkasında bekleyen fotoğraf doğrulaması, dosya hedefte bulunmasına rağmen `missing` dönüyordu. | Kayıtlı kanıt değiştirilmeden, tamamlanmış sistem taşıma geçmişi üzerinden güncel kök/yol çözülür. Belge, fotoğraf, PDF çıkarımı ve OCR işlerinin claim yanıtı ile metadata okuma uçları bu çözümü kullanır. |

Yol çözümünün ek kontrolleri: kökler arası taşıma, kapanış/yeniden açma zinciri, taşıma sonrasında kaydedilen dosyalar, benzer adlı komşu klasörler, başka dosya/kiracı ve fiziksel taşıma olmayan manuel konum ataması.

## Regresyon kanıtı

- 13 yeni test senaryosu eklendi.
- Önceki Agent koduyla çalıştırılan 34 hedefli testte **9 hata, 25 başarılı** sonuç alındı: `.local/workflow-audit-confirmed-red.log`.
- Düzeltilmiş birleşik iş akışı ve yol sınırları: **7/7 başarılı** (`workflow-audit-workflow.log`).
- Gerçek fiziksel hata/kesinti senaryoları dahil lifecycle: **10/10 başarılı** (`workflow-audit-lifecycle-physical.log`).
- Canlı HTTP API istemcileri ayrı izole veritabanıyla **6/6 başarılı** (`workflow-audit-live.log`).
- Tip kontrolü ve derleme başarılı; değişen dosyalarda ESLint uyarısı/hatası yok. Genel lint: 0 hata, önceden mevcut 12 uyarı.
- Windows servis/depolama doğrulaması başarılı (`workflow-audit-deploy.log`).

### Son geniş koşu

| Paket | Başarılı test |
|---|---:|
| UI | 358 |
| Canlı HTTP istemcileri (ayrı koşu) | 6 |
| Domain | 568 |
| Contracts | 282 |
| Database | 80 |
| Desktop bridge | 14 |
| API | 419 |
| File Agent | 105 |
| Desktop / gerçek Electron | 114 |
| **Toplam** | **1946** |

Başarısız test yoktur. Ana koşuda ortam koşullu olarak atlanan altı canlı istemci testi ayrı HTTP API koşusunda çalıştırılmıştır. Veritabanı ve masaüstü entegrasyonları atlanmamıştır.

Sonuç: **PASS**. Loglar `.local/workflow-audit-final-tests.log`, `workflow-audit-live.log`, `workflow-audit-typecheck.log`, `workflow-audit-api-typecheck.log`, `workflow-audit-build.log`, `workflow-audit-lint.log`, `workflow-audit-changed-lint.log` ve `workflow-audit-deploy.log` dosyalarındadır. Test kümesi denetim sonunda durdurulmuştur; izole veriler ve loglar yerelde korunur.

## Tekrar çalıştırma

Node 24 ile, yalnız ayrılmış ve adı `_test` ile biten bir veritabanı kullanın. Entegrasyon testleri bu veritabanının `public` şemasını sıfırlar.

```powershell
$env:TEST_DATABASE_URL = '<izole-test-veritabani-url>'
npm run test --workspace @hasarbotu/api -- agent-jobs case-lifecycle workspace-provisioning
npm test
npm run typecheck
npm run lint
npm run build
npm run check:deploy
```

Migration, bağımlılık veya üretim yapılandırması değişikliği gerekmez. Kayıtlı belge/fotoğraf yolları append-only kanıt olarak korunur; okuma ve çalıştırma sırasında güncel fiziksel konuma çözümlenir.
