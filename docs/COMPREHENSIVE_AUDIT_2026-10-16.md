# Kod ve güvenlik denetimi — 16 Ekim 2026

**Yerel doğrulama: PASS. Genel ürün/ofis kabulü: PARTIAL.** Yeniden üretilen sorunlar düzeltildi; son koşularda **2.826 test ve 523 PowerShell doğrulaması başarılı**, başarısız kontrol yok. Dört PowerShell senaryosu gerçek makine önkoşulları nedeniyle atlandı. Bu sonuç, yazılımdaki kalan hata oranının %0,01 olduğunun ölçümü veya garantisi değildir.

## Kapsam

- Başlangıç commit'i `7156499`; çalışma ağacı temizdi. Değişiklikler yereldir.
- React oturumu, domain/contracts, PostgreSQL/Fastify, File Agent, Electron köprüsü ve Windows bakım/dağıtım araçları incelendi. Çalışan davranışlar geniş test zinciriyle korundu.
- Node.js **24.21.0**, PostgreSQL **18.4**, Windows x64. Veritabanı testleri loopback üzerinde ayrı `*_test` veritabanlarında, sentetik kullanıcı ve dosyalarla çalıştırıldı.
- Gerçek ofis veritabanına, evraklarına ve mevcut uygulama kurulumuna yazılmadı. Servis testleri ayrı bir geçici servis kullandı; gerçek ürün servisleri değiştirilmedi.

## Düzeltilen sorunlar

| Alan | Kök neden ve düzeltme | Regresyon kanıtı |
| --- | --- | --- |
| Giriş sınırlandırması | Süresi geçen IP kayıtları bellekte kalıyordu. Süresi dolan kayıtlar temizlenir; kapasite 10.000 anahtarla sınırlıdır. Yeni anahtar kabul etmek için etkin sınırlar silinmez. Geçersiz limitler reddedilir. | [Auth birim testleri](../services/api/test/auth-unit.test.ts). |
| Giriş yarışı ve hesap kilidi | Parola doğrulanırken hesabın kapatılması, parolanın değişmesi veya kilitlenmesi eski hesap bilgileriyle oturum açılmasına izin verebiliyordu. Oturum üretiminden önce kullanıcı satırı kilitlenip durum/parola/kilit/roller yeniden okunur. Süresi geçmiş kilidin sayacı sıfırlanır; eşzamanlı hatalar tek kilit başlangıcı üretir. | [Gerçek PostgreSQL yarış testleri](../services/api/test/auth-concurrency.test.ts); düzeltme öncesi hatalar yeniden üretildi. |
| Frontend oturumu | Geç dönen oturum ve izin sorguları yeni giriş/çıkış durumunu ezebiliyordu. İstek sürümü ve devam eden oturum değişikliği kontrolü eklendi. | [Oturum testleri](../src/app/session.test.tsx): geç yanıt, çıkış ve izin yenileme yarışları. |
| Masaüstü dosya sunumu | Statik dosya kökü içindeki junction üzerinden kök dışındaki dosya HTTP 200 ile okunabiliyordu. Gerçek yol çözülüp kök sınırı doğrulanır; doğrulanan yol sunulur. | [Köprü testleri](../packages/desktop-bridge/test/bridge.test.ts): dış junction artık 404; kök içi bağlantılar korunur. |
| HTTP başlıkları | `Connection` başlığında belirtilen ek başlıklar köprüden aktarılabiliyordu. Her iki yönde bağlantıya özel başlıklar da çıkarılır. | [Başlık politikası testleri](../packages/desktop-bridge/test/policy.test.ts). |
| Kimlik bilgisi taşıyan HTTP istekleri | OAuth, AI ve Agent istekleri yönlendirmeyi takip ederek sırları veya belge içeriğini başka hedefe gönderebiliyordu. Kimlik bilgisi taşıyan isteklerde yönlendirme reddedilir. Agent çağrıları sonlu zaman aşımı kullanır. | [OAuth](../services/api/test/google-transport.test.ts), [AI](../services/api/test/external-providers.test.ts), [Agent](../services/file-agent/test/api-client.test.ts): iki gerçek HTTP sunucusuyla sızıntı ve bekleyen istek testleri. |
| Windows dosya adları | Çok uzantılı cihaz adları ve üst simgeli COM/LPT adları atlanıyordu; çok uzun uzantı indirme sınırını aşabiliyordu. Domain ve masaüstü normalleştirmesi düzeltildi. | [Domain](../packages/domain/test/storage-path.test.ts) ve [indirme](../apps/desktop/test/downloads.test.ts) testleri. |
| OOXML kaynak tüketimi | ZIP açılımı, XML derinliği ve düğüm üretimi sınırsızdı. Bozuk özniteliklerde tekrar eden son ek taraması vardı. Açılım öncesi ZIP bütçesi, XML bütçesi ve konuma bağlı öznitelik eşleştirmesi eklendi. | [OOXML testleri](../services/file-agent/test/ooxml-readonly-extractor.test.ts): sahte 2 GiB başlık, fazla giriş, derin/geniş XML ve bozuk öznitelik; gerçek çalışma kitabı/parite testleri de geçti. |
| Envanter tarihleri | PostgreSQL `date` değerinin UTC'ye çevrilmesi günü geri kaydırıyordu; rapor tarihi ve gecikme hesabı farklı saat dilimleri kullanıyordu. Tarihler metin olarak okunur; gün hesabı İstanbul ofis saati ve enjekte edilen saat kaynağından yapılır. | [Envanter entegrasyon testleri](../services/api/test/case-inventory.test.ts): tarih, gece sınırı, gecikme ve birleşik filtreler. |
| XLSX içeriği | Geçersiz XML kontrol karakterleri, tek surrogate ve `_xHHHH_` dizileri dışa aktarımı bozabiliyordu. ST_Xstring kaçışları uygulandı; hücreler metin olarak tutulur. | [XLSX testleri](../services/api/test/xlsx-writer.test.ts); üretilen kitabın beş XML parçası ayrıca bağımsız ayrıştırıldı. |
| Windows bakım yolları | Kısa/uzun yol eşitsizliği geçerli işlemleri engelliyor; yalın ön ek karşılaştırması komşu dizin, `..` ve junction kaçışını kabul edebiliyordu. Normalize edilmiş kök sınırı ve reparse-point denetimi eklendi. Yedekler kaynak ve hedefin dışında olmalıdır. Manifest kökü gerektiğinde gerçek dizin kimliğiyle karşılaştırılır. | [Yol modülü testleri](../deploy/windows-service/storage-path-safety.tests.ps1), repair/cleanup `-Apply` testlerinde kök dışındaki dosyanın değişmediğinin kontrolü; kısa/uzun ad ve manifest kimliği regresyonları. |
| Paketleme bağımlılığı | `sprintf-js` kaynaklı sekiz geçişli uyarı vardı. `global-agent` altındaki logger `roarr@3.3.0` ile sınırlandı; mevcut indirme/proxy davranışı korundu. | `npm audit`: **0**; [gerçek Electron indirme/proxy/TLS testi](../scripts/electron-download-proxy.test.mjs), kilit dosyası kurulum provası ve NSIS paketi başarılı. |

Test altyapısında ayrıca eksik/ignore edilmiş özel anahtara bağlı TLS fixture kaldırıldı. Test sertifikaları geçici olarak bellekte üretilir. Servis koruma testlerinin sürekli atlanmasına neden olan hemen kapanan/eksik bağımlılıklı fixture, kalıcı ama zararsız geçici payload ile düzeltildi. Çalışan servise hem Apply hem Rollback müdahalesinin reddedildiği gerçek SCM üzerinden doğrulandı. Mevcut 11 gereksiz ESLint bastırma uyarısı temizlendi.

### Yeni çalışma sınırları

OOXML okuma: kaynak **64 MiB**, tek ZIP girdisi **32 MiB**, toplam açılım **128 MiB**, **4.096** girdi; XML başına **256** derinlik ve **250.000** eleman sınırı. Aşan belgeler hata koduyla reddedilir. Bu sınırlar büyük belge kabul davranışını etkiler.

Bakım betikleri artık aynı dizindeki **`storage-path-safety.psm1`** dosyasını gerektirir; dağıtımda birlikte taşınmalıdır. Modül testi `npm run check:deploy` kapsamına alındı. Ayrıntı: [Windows araçları kılavuzu](../deploy/windows-service/README.md).

## Son doğrulama

| Alt sistem | Başarılı test |
| --- | ---: |
| Frontend | 475 |
| Domain | 636 |
| Contracts | 297 |
| Database | 83 |
| Desktop bridge | 17 |
| API | 640 |
| File Agent | 313 |
| Electron | 163 |
| Ayrı gerçek HTTP ortamı isteyen frontend testleri | 6 |
| Node operasyon/dağıtım araçları | 196 |
| **Tekrarsız toplam** | **2.826** |

İlk geniş `npm test` sonrasında API ve File Agent, son değişiklikleri içeren tam alt sistem koşularıyla yeniden doğrulandı. Ana zincirde ortam nedeniyle atlanan altı HTTP testi ayrı gerçek sunucuyla geçti. Hedefli tekrarlar toplama eklenmedi. UI → derlenmiş API → PostgreSQL → gerçek File Agent → fiziksel klasör akışındaki iki EKSİST testi de geçti; bunlar frontend toplamına dahildir.

- **16 PowerShell test paketi:** 523 başarılı doğrulama, sıfır başarısızlık; dört koşullu senaryo atlandı.
- **258 korumalı route/metot:** kimliksiz isteklerin tamamı HTTP 401; beklenmeyen veritabanı erişimi yok. Bu kontrol bütün yetki kombinasyonlarının kanıtı değildir.
- TypeScript, ESLint (**0 hata / 0 uyarı**), build, frontend bundle sınırları, `check:deploy` ve `git diff --check` başarılı. Son API/File Agent kaynakları ayrıca derlendi.
- Npm tüm bağımlılık taraması: **0 düşük / 0 orta / 0 yüksek / 0 kritik kayıt**. Kilit dosyası `npm ci --ignore-scripts --dry-run` ile doğrulandı.

### Yerel Windows paketi

NSIS x64 paketi ayrı dizinde üretildi: `.local/audit-20261016/release/HasarBotu-Setup-0.1.27.exe`.

- Boyut: **107.123.150 bayt**; Authenticode: **NotSigned**.
- SHA-256: `0cbe33b0a281b589ead063afd6ce1d4d4afc0bc6670a7ad9362d1d34ba0eb71a`.
- Gerçek paket açılışı, ofis bağlantı profili, **55 UI dosyasının hash eşleşmesi**, loopback üzerinden UI sunumu ve pencereyi kapatınca tepsiye geçme başarılı.
- Paket yayınlanmadı ve mevcut kullanıcı kurulumu üzerine yüklenmedi.

## Açık doğrulama sınırları

Dört PowerShell atlaması: kayıtlı PostgreSQL Windows servisiyle API preview başarısı; kurulu gerçek File Agent için idempotency; File Agent kurulu/API kurulu değil makine durumu; gerçek pCloud hizmet hesabı/veritabanı/izinleriyle olumlu readiness. Bu önkoşulları oluşturmak için üretim servisleri değiştirilmedi. Geçici WinSW servisiyle çalışma/geri alma testlerinde atlama kalmadı.

Gerçek ofis hesabıyla günlük işlemler, Gmail/Google onayı, ücretli AI çağrıları, canlı pCloud eşitlemesi ve mevcut kurulum üstüne yükseltme bu denetimin doğrulanmış sonuçları arasında değildir. Önceki rapordaki galeri, PDF'den otomatik ücret okuma ve kasko değer kaybı gibi ürün sınırları devam eder; bu çalışma bunları tamamlanmış özellik olarak sunmaz. [Önceki ürün sınırları](./COMPREHENSIVE_AUDIT_2026-10-15.md#açık-kalanlar-ve-ürün-sınırları). Önceki rapordaki sekiz bağımlılık uyarısı bu çalışmayla kapatıldı.

## Kanıt ve kaynaklar

Yerel kanıt dizini `.local/audit-20261016/`: `full-tests.log`, `api-verified.log`, `agent-verified.log`, `live-http.log`, `tools-verified.log`, `powershell-verified/summary.json`, `deploy-verified.log`, `lint-final.log`, `npm-audit-final.json`, `anonymous-routes.json`, `package.log`, `package-smoke.log`, `summary.json`. Önce/sonra regresyon logları aynı dizindedir. Gizli bağlantı profilleri ve test kimlik bilgileri rapora alınmadı.

- [Npm güvenlik bildirimi GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), [roarr 3.3.0 logger kaynağı](https://raw.githubusercontent.com/gajus/roarr/v3.3.0/src/log.ts).
- [Microsoft Windows dosya adı kuralları](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file).
- [Microsoft ST_Xstring kaçış kuralları](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/bd0aa042-434a-4ca7-b25f-4e1fd25a954d).
