# HasarBotu V2 Dağıtım ve Operasyon Planı

## 1. Amaç ve kapsam

Bu belge, UI-first prototipten sonra gerçek altyapının iki aşamalı işletim modelini tarif eder. Kod, servis veya kurulum betiği oluşturmaz. Birinci aşama ofiste geçici merkezi Windows 11 bilgisayarı; ikinci aşama kalıcı sunucuya kontrollü geçişi kapsar.

Bağlayıcı sınırlar:

- Ana iş verisi PostgreSQL'de tutulur.
- Belge ve fotoğraflar pCloud ile eşlenen ofis depolama kökünde bulunur; veritabanında yalnız göreceli yol tutulur.
- Fiziksel klasörlerde kritik yazma, taşıma ve yeniden adlandırmanın tek sahibi File Agent'tır.
- UI doğrudan PostgreSQL'e veya dosya sistemine erişmez; Merkezi API üzerinden çalışır.
- Geçici kurulum kalıcı mimariyi değiştirmez; yalnız barındırma konumudur.
- RPO, RTO, sertifika otoritesi ve kesin yedek saklama süreleri ürün/operasyon kararı verilene kadar açık kapıdır.

## 2. Faz A — Ofiste geçici merkezi Windows 11 bilgisayarı

### 2.1 Topoloji

```text
Ofis istemcileri / ileride Electron kabuğu
                 |
        HTTPS veya güvenli ofis LAN'ı
                 |
        Merkezi Windows 11 bilgisayarı
        +-- Merkezi API
        +-- PostgreSQL
        +-- File Agent
        +-- pCloud yerel eşleme kökü
        +-- servis logları ve sağlık kontrolleri
```

Bu bilgisayar kişisel günlük kullanım makinesi değil, geçici merkezi servis bilgisayarı gibi yönetilmelidir. Uyku ve hazırda bekletme kapatılmalı; plansız yeniden başlatma ve kullanıcı oturumu bağımlılığı önlenmelidir.

### 2.2 Ağ ve adlandırma

- Cihaza sabit DHCP rezervasyonu veya doğrulanmış statik yerel IP verilir.
- İstemciler IP yerine sabit yerel DNS adı kullanır; örnek ad ancak kurulum kararında belirlenir.
- PostgreSQL yalnız API ve yetkili bakım kaynağından erişilebilir; ofis istemcilerine genel olarak açılmaz.
- API portu Windows Güvenlik Duvarı'nda yalnız gerekli özel ağ profiline ve mümkünse ofis alt ağına açılır.
- File Agent dışarıdan dinleyen genel bir port sunmaz; iş kuyruğunu PostgreSQL/API sözleşmesi üzerinden alır.
- **Ölçülüp doğrulandı (HB-2026-108, 2026-07-29):** mevcut `P:\` pCloud sanal sürücüsü servis hesabından (hangisi olursa olsun) GÖRÜNMEZ — bu bir varsayım değil, gözlemlenmiş mimari kısıttır. Çözüm: pCloud senkronize klasör moduna geçiş (bkz. `docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md` §2). Veritabanındaki göreceli yol modeli değişmez.
  **Düzeltme (HB-2026-110/111, 2026-07-29):** bu makinede yapılan GERÇEK SYSTEM çalıştırması yukarıdaki "görünmez" iddiasını ÇÜRÜTTÜ — sürücü harfi bu pCloud kurulumunda (EldoS CBFS) GLOBAL ad alanında kayıtlı, SYSTEM görüp okuyup yazabiliyor. Senkron klasör geçişi kararı GEÇERLİLİĞİNİ KORUYOR ama gerekçesi kullanılabilirlik + ACL/en-az-yetkidir (SYSTEM görünürlüğü DEĞİL) — ayrıntı DECISION_LOG HB-2026-110/111.

### 2.3 Servis hesapları ve en az yetki

- API, PostgreSQL ve File Agent mümkünse ayrı, etkileşimli oturum açamayan hizmet hesaplarıyla çalışır.
- API hesabının dosya kökünde yazma yetkisi yoktur.
- File Agent hesabına yalnız tanımlı depolama kökünde gereken okuma/yazma/taşıma yetkisi verilir.
- PostgreSQL hesabı işletim sistemi yöneticisi değildir; uygulama veritabanı rolü migration rolünden ayrılır.
- pCloud istemcisi kullanıcı oturumuna bağımlıysa otomatik başlangıç ve kilit ekranı sonrası davranış ayrıca test edilir. Bu bağımlılık geçici fazın bilinen riskidir.

**D6 servis hesabı kararı (HB-2026-113, 2026-07-29 — PLAN, henüz uygulanmadı;
somut prosedür `docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md` §2c):**
File Agent için WinSW'nin varsayılanı olan LocalSystem YERİNE ayrı, yerel,
etkileşimli oturum açamayan bir servis hesabı (`svc-hasarbotu-fileagent`)
kullanılacaktır. Bu hesap: (1) yalnız "Log on as a service" hakkına sahiptir
(`SeServiceLogonRight`), (2) "Deny log on locally" ve "Deny log on through
Remote Desktop Services" haklarıyla etkileşimli/RDP oturumu YASAKLANMIŞTIR,
(3) hedef NTFS depolama kökünde (§2a) yalnız **Modify** (Tam Denetim/izin
değiştirme/sahiplik alma DEĞİL) yetkisine sahiptir, (4) File Agent uygulama
dizininde salt Read+Execute, yalnız kendi `logs` alt dizininde Modify'a
sahiptir. Bu, HB-2026-112'nin açık bıraktığı "adanmış servis hesabı" sorusunu
CEVAPLAR. API ve PostgreSQL hesap kararları bu kararın KAPSAMI DIŞINDADIR.

### 2.4 Servis başlangıcı ve yeniden başlatma

- PostgreSQL Windows hizmeti olarak otomatik başlar.
- API ve File Agent, WinSW ile otomatik başlar (HB-2026-108, 2026-07-29 — bkz. `docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md`).
- Servisler kullanıcı oturumu açılmadan çalışmalıdır.
- Başarısız başlangıçlarda artan gecikmeli sınırlı yeniden deneme uygulanır; sonsuz hızlı yeniden başlatma yapılmaz.
- Başlangıç sırası: PostgreSQL sağlıklı -> API hazır -> File Agent kuyruk tüketebilir. Her servis bağımlılığı hazır değilken güvenli biçimde bekler.
- Planlı yeniden başlatma öncesi File Agent yeni iş almayı durdurur, yürüyen işi tamamlar veya kurtarılabilir duruma yazar.

### 2.5 Sağlık ve hazır olma kontrolleri

API için ayrı uçlar planlanır:

- health/liveness: süreç ayakta mı,
- health/readiness: PostgreSQL bağlantısı, migration uyumu ve gerekli bağımlılıklar hazır mı,
- health/diagnostics: yalnız yetkili operatöre sürüm, kuyruk gecikmesi ve bağımlılık durumu.

File Agent için son heartbeat, sürüm, aktif iş, son başarılı işlem, son hata, depolama kökü erişimi ve kuyruk gecikmesi izlenir. pCloud eşitleme sağlığı kesin veri kaynağı gibi yorumlanmaz; yalnız operasyon sinyalidir.

### 2.6 Loglama ve gözlemleme

- API ve File Agent yapılandırılmış JSON log üretir; yerel dosya döndürme ve saklama sınırı tanımlanır.
- Loglar kullanıcı adı yerine güvenli kimlik, correlationId, requestId/jobId ve sonuç kodu içerir.
- Parola, oturum belirteci, e-posta gövdesi, tam mutlak dosya yolu ve hassas müşteri içeriği loglanmaz.
- Windows Olay Günlüğü servis başlatma/çökme sinyali için kullanılabilir; iş audit kaydının yerine geçmez.
- Disk doluluk, PostgreSQL boyutu, yedek tazeliği, başarısız iş sayısı ve API hata oranı için eşikler daha sonra operasyon kararıyla belirlenir.

### 2.7 Güç, internet ve yeniden başlatma senaryoları

- Merkezi bilgisayar ve ağ ekipmanı UPS ile korunmalıdır; otomatik güvenli kapanış doğrulanmalıdır.
- Windows saat eşitlemesi zorunludur; zaman sapması audit ve oturum kayıtlarını bozmamalıdır.
- İnternet kesintisinde yerel API/PostgreSQL işlevleri çalışabilir; Gmail, AI ve pCloud eşitleme beklemeye alınır ve kullanıcıya gecikme gösterilir.
- Elektrik dönüşünde servislerin kullanıcı oturumu olmadan doğru sırayla başladığı test edilir.
- Beklenmeyen yeniden başlatma sonrası açık File Agent işleri lease süresi ve idempotency anahtarıyla kurtarılır; aynı fiziksel işlem körlemesine tekrarlanmaz.

### 2.8 TLS ve ofis LAN sınırı

- LAN güvenilir kabul edilerek düz HTTP kalıcı çözüm yapılmaz.
- Tercih, ofis cihazlarının güvendiği yerel/kurumsal sertifika ile HTTPS'tir.
- Geçici kendinden imzalı sertifika seçilirse cihazlara güvenli dağıtım, yenileme ve parmak izi doğrulama prosedürü gerekir.
- Sertifika anahtarı kaynak kodda veya repository'de bulunmaz.

### 2.9 Faz A kurulum kabulü

- Temiz Windows açılışından sonra PostgreSQL, API ve File Agent otomatik başlar.
- Yetkisiz istemci PostgreSQL'e ve yönetim uçlarına erişemez.
- UI/API sağlık, oturum, salt okunur dosya listesi ve kontrollü bir test yazımıyla doğrulanır.
- Depolama kökü kesildiğinde File Agent işi bozmaz; güvenli hata ve yeniden deneme üretir.
- Günlük yedek oluşturma ve ayrı hedefe geri yükleme tatbikatı geçer.
- Güç/internet/reboot senaryoları kayıt altına alınır.

## 3. Docker değerlendirmesi

### 3.1 Olası yararlar

- API ve PostgreSQL sürümlerini tekrarlanabilir paketleme,
- kalıcı sunucuya geçişte ortam eşitliği,
- bağımlılık ve yapılandırma izolasyonu,
- standart sağlık kontrolü ve güncelleme prosedürü.

### 3.2 Windows 11 geçici merkezde riskler

- Docker Desktop lisans/işletim modeli ve kullanıcı oturumu bağımlılığı,
- WSL2/Hyper-V katmanının ofis desteğini ve kurtarmayı karmaşıklaştırması,
- pCloud sürücü eşlemesinin Linux container'a güvenilir aktarımının zorlaşması,
- File Agent'ın Windows ACL, uzun yol ve atomik taşıma davranışının container içinde farklılaşması,
- küçük ofiste tanılama için ek operasyon bilgisi gerektirmesi.

### 3.3 Geçici öneri

Faz A için PostgreSQL'in yerel Windows hizmeti, API ve File Agent'ın Windows hizmetleri olarak çalışması en düşük operasyon sürtünmesi olan adaydır. Bu kalıcı karar değildir. Faz B sunucu işletim sistemi ve operasyon yetkinliği belirlendiğinde API/PostgreSQL container seçeneği yeniden değerlendirilmelidir. File Agent depolama kökü Windows/pCloud bağımlılığı nedeniyle ayrı Windows hizmeti kalabilir.

## 4. Faz B — Kalıcı sunucuya geçiş

### 4.1 Değişmemesi gerekenler

- UI ve API sözleşmesi,
- domain kuralları ve iş akışları,
- veritabanı şeması/migration geçmişi,
- göreceli depolama yolları ve rootKey yaklaşımı,
- File Agent iş sözleşmesi ve idempotency modeli,
- audit olay formatı.

Yalnız endpoint, sır yönetimi, depolama kökü eşlemesi, servis barındırma ve operasyon politikası değişir.

### 4.2 Geçiş ön koşulları

- Hedef işletim sistemi, ağ, TLS, DNS, servis hesapları ve izleme kararı verilmiş olmalıdır.
- Kaynak ve hedef PostgreSQL sürüm uyumu doğrulanır.
- Tam yedek ve ayrı ortamda geri yükleme testi günceldir.
- Hedef depolama kökü aynı göreceli yolları sağlayacak şekilde hazırlanır.
- Bakım penceresi, sorumlu kişiler, iletişim planı, kabul testleri ve rollback eşiği yazılıdır.

### 4.3 Önerilen geçiş sırası

1. Hedef altyapıyı aynı uygulama sürümü ve yapılandırma şemasıyla kur.
2. Sağlık, güvenlik duvarı, TLS ve servis hesabı kontrollerini geç.
3. Kaynak sistemi yazma bakımına al; File Agent yeni iş almayı durdursun.
4. Kuyrukta yürüyen iş kalmadığını doğrula ve son tutarlı veritabanı yedeğini al.
5. Yedeği hedef PostgreSQL'e geri yükle; migration ve satır/özet kontrollerini yap.
6. Depolama kökünü hedef File Agent'a eşle; örnek göreceli yollar ve hash'ler ile salt okunur doğrula.
7. API DNS/endpoint yönlendirmesini hedefe geçir.
8. Oturum, dosya okuma/yazma, belge işlemi, audit ve kuyruk kabul testlerini çalıştır.
9. Tanımlı gözlem penceresi sonunda eski merkezi bilgisayarı salt okunur/kapalı bekleme durumuna al.
10. Sonuç ve kanıtları deployment audit kaydına bağla.

### 4.4 Rollback

- Hedefte kabul eşiği sağlanmazsa yeni yazımlar durdurulur.
- Hedefte üretim yazımı başladıysa veri ayrışması analiz edilmeden kaynak sistem tekrar yazılabilir yapılmaz.
- Güvenli rollback için tercih edilen pencere, DNS geçişinden önce veya hedef henüz yazım kabul etmemişken yapılır.
- Kaynak veritabanı ve eski File Agent bakım başlangıcındaki tutarlı durumda korunur.
- DNS/endpoint önceki adrese döndürülür, istemci cache süresi hesaba katılır.
- Başarısızlık nedeni giderilmeden ikinci deneme yapılmaz.

### 4.5 Paket 20 move/rename operasyon notu

- File Agent servis hesabının her tanımlı source/destination root için gerekli okuma, staging oluşturma, atomik rename ve yalnız onaylı move cleanup yetkileri ayrı doğrulanmalıdır; genel silme yetkisi/endpoint'i varsayılmaz.
- Güncelleme veya bakım öncesi `applying`, `verifying`, `switching_location` ve `cleanup_pending` operation/job'ları incelenir. Agent lease'i dolmadan aynı operasyon başka process tarafından körlemesine çalıştırılmaz.
- `cleanup_pending` hedef ve DB location'ın doğrulanmış olduğu, kaynak cleanup'ının beklediği durumdur; hedef silinmez veya DB geri çevrilmez. `manual_recovery_required` durumunda otomasyon durur, logical source/destination ve manifest sayaçlarıyla yetkili inceleme yapılır.
- Yerel mutlak root eşlemesi yalnız Agent service config'inde kalır. Runbook, log veya destek çıktısına credential/mutlak müşteri yolu kopyalanmaz. Üretim `P:\` üzerinde Paket 20 otomatik testi çalıştırılmaz; ayrı yetkili UAT plan/preview ile başlar.

## 5. İşletim runbook'ları

Gerçek uygulama başlamadan şu kısa runbook'lar oluşturulmalıdır:

- **servis başlatma/durdurma, sürüm doğrulama ve pCloud senkronize klasör geçişi — hazır: `docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md` (HB-2026-108, 2026-07-29).**
- API/File Agent güncelleme ve geri alma,
- migration önizleme/uygulama/doğrulama,
- PostgreSQL yedekleme ve geri yükleme,
- depolama kökü/pCloud kesintisi (ilk kurulum kısmı yukarıdaki runbook'ta; işletim-zamanı kesinti senaryosu ayrı runbook gerektirir),
- disk doluluk ve log temizleme,
- takılı File Agent işi inceleme,
- sertifika yenileme,
- hesap/rol acil iptali,
- merkezi bilgisayar kaybı ve felaket kurtarma.

Her runbook sahip, ön koşul, komut/işlem, beklenen çıktı, durdurma ölçütü, doğrulama ve audit kanıtını içerir.

## 6. Açık karar kapıları

| Kimlik | Karar | Seçenekler | Geçici öneri | Ne zaman kilitlenmeli |
|---|---|---|---|---|
| OPS-Q01 | Faz A servis sarmalayıcısı | WinSW / NSSM / görev zamanlayıcı | **Kilitlendi (HB-2026-108, 2026-07-29): WinSW.** Config/runbook `deploy/windows-service/`, `docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md` | Kilitlendi |
| OPS-Q02 | Faz A PostgreSQL | Yerel Windows / container | Yerel Windows hizmeti | Veritabanı paketi öncesi |
| OPS-Q03 | TLS otoritesi | Kurumsal CA / yerel CA / geçici sertifika | Yönetilen yerel veya kurumsal CA | LAN kabulü öncesi |
| OPS-Q04 | Sabit ad çözümleme | Yerel DNS / DHCP+hosts | Yerel DNS | Faz A kurulumunda |
| OPS-Q05 | İzleme | Yerel sağlık paneli / merkezi ajan | Önce sağlık+log+uyarı | Operasyon kabulünde |
| OPS-Q06 | Faz B barındırma | Windows / Linux / karma | Gereksinim ve ekip yetkinliğiyle seç | Kalıcı sunucu tedarikinden önce |
| OPS-Q07 | Bakım ve güncelleme penceresi | Mesai dışı / planlı dönem | Ofis operasyonuyla belirle | İlk gerçek sürüm öncesi |
| OPS-Q08 | RPO/RTO | İş etkisi seçenekleri | Ölçülmeden sayı kilitleme | Yedek uygulamasından önce |

## 7. Bu planın kabul ölçütü

- Faz A ve Faz B sorumlulukları ayrılmıştır.
- Geçici kurulum kalıcı mimariyi veya göreceli yol modelini değiştirmez.
- Ağ, hizmet hesabı, TLS, başlangıç, log, sağlık, güç ve yeniden başlatma davranışı tanımlıdır.
- Docker yarar ve riskleri açıkça değerlendirilmiş, zorunlu hale getirilmemiştir.
- Geçiş ve rollback adımları veri ayrışması riskini gözetir.
- Açık kararlar öneri olarak kalmış, yeni bağlayıcı ürün kararı alınmamıştır.

## 8. Gemini provider deployment runbook’u — Paket 31

1. API hizmet hesabı secret store/process environment katmanında `GEMINI_API_KEY` değerini kurar; değeri repository, `.env`, komut çıktısı, audit veya log’a yazmaz.
2. Açık etkinleştirme için `GEMINI_POLICY_PROVIDER_ENABLED=true` ve izinli `GEMINI_POLICY_MODEL` (`gemini-3.5-flash` veya `gemini-2.5-flash`) ayarlanır. Gerekirse bounded `GEMINI_POLICY_MAX_OUTPUT_TOKENS` verilir.
3. Organization `ai_provider_policies` kaydı ayrıca `enabled`, provider allow-list, per-request/monthly integer bütçe ve hard stop ile onaylanır. Server secret kurulumu organization izni sayılmaz.
4. Kontrollü restart öncesi eksik/kısmi config’in fail-closed olduğu; flag kapalıyken çekirdek API’nin başladığı test edilir.
5. Oturumlu `GET /api/v1/ai/providers` ile yalnız güvenli descriptor ve organization durumu doğrulanır. API key veya environment ham değeri hiçbir yanıtta görünmemelidir.
6. Production composition otomatik model/provider fallback yapmaz. Model değişimi açık config değişikliği, yeniden başlatma ve yeni smoke gerektirir.
7. Gerçek müşteri verisi ancak retention/egress, veri işleme hukuki onayı, secret rotation sahibi/süresi ve incident revoke prosedürü tamamlanınca açılabilir. Gemini ücretsiz katmanı müşteri verisi için kullanılmaz.
8. Kapatma/rollback: önce organization policy disabled yapılır, sonra deployment opt-in kaldırılır ve API restart edilir. Çekirdek case/document/policy-analysis akışlarının çalıştığı ve dış çağrı oluşmadığı doğrulanır.
