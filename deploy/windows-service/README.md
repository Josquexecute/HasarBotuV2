# HasarBotu V2 — Windows servis ve depolama geçiş araçları (D5–D9)

## IP bağımsız ofis bağlantısı (2 Kasım 2026)

Yeni bağlantı yolu: masaüstü → doğrulanmış LAN HTTPS (`8443/TCP`) →
`127.0.0.1:3100`. `hasarbotu-office-gateway` Caddy'yi `0.0.0.0` üzerinde
dinletir; DHCP adresine bağlanmaz. `hasarbotu-network-discovery` ayrı
`43110/UDP` portunda nonce ile eşleşen keşif yanıtı verir. Bu yanıt yalnız
adres ipucudur. İstemci, dağıtıma eklenen ofise özel CA ve sabit HTTPS sunucu
adıyla sertifikayı, ardından `/health` servis kimliğini doğrular. Keşif kullanıcı
yetkisi vermez; API'nin oturum, Google, rol ve dosya erişim kontrolleri korunur.
CA özel anahtarı istemciye veya Windows kök sertifika deposuna aktarılmaz.

| Yöntem | Değerlendirme |
| --- | --- |
| Yönetilen DNS + güvenli dinamik kayıt | VLAN'lar için uygun; DNS/DHCP yöneticisi ve dinamik kayıt altyapısı gerekir. Mevcut sunucu adı çözümlemesi hızlı aday yoludur. |
| DNS-SD/mDNS | Standart ve aynı bağlantıda kullanışlı; multicast geçişi ve Windows sağlayıcısı her ağda garanti değil. Yeni Bonjour bağımlılığı eklenmedi. |
| Uygulama içi UDP keşfi + TLS | Aynı IPv4 LAN'da ek DNS, IP veya istemci yönetici izni gerektirmez. Multicast yerine alt ağ broadcast'i ve mevcut DNS birlikte kullanılır. Kimlik yalnız TLS ile doğrulanır. |

Referanslar: [RFC 6763](https://www.rfc-editor.org/rfc/rfc6763),
[Caddy dinleme adresleri](https://caddyserver.com/docs/caddyfile/concepts).
Eski adrese takılan TCP/TLS el sıkışması ayrıca 5 saniyede sonlandırılır;
[Node HTTP soket zaman aşımı](https://nodejs.org/docs/latest-v24.x/api/http.html#requestsettimeouttimeout-callback)
tek başına bağlantı kurulmasını sınırlandırmaz. Yazma isteği yeniden oynatılmaz.
Desteklenen ağda RFC1918 IPv4 erişimi, sunucuda Domain/Private güvenlik duvarı
profili ve DNS **veya** UDP broadcast erişimi gerekir. Misafir ağı/istemci
yalıtımı, farklı VLAN ve IPv6-only ağlar otomatik keşif kapsamı dışındadır;
bu ağlar için yönetilen DNS ve yönetici tarafından sağlanmış erişim gerekir.

### Bir defalık sunucu kurulumu ve geçiş

Sunucuda Node.js 24, WinSW, Caddy ve OpenSSL gerekir. Yönetici aşağıdaki
betiği önce `-Apply` olmadan önizler, sonra `-Apply` ile çalıştırır. Yollar,
sunucudaki gerçek mevcut ikililere verilmelidir:

```powershell
.\install-office-network.ps1 -ApiOrigin https://desktop-efn2g33.tail276cda.ts.net `
  -WinSwExe C:\Tools\WinSW-x64.exe -CaddyExe C:\Tools\caddy.exe `
  -OpenSslExe 'C:\Program Files\Git\usr\bin\openssl.exe' -Apply
```

Varsayılan hedef `C:\ProgramData\HasarBotu\office-network` yalnız
Administrators/SYSTEM tarafından yönetilir. API servisi ön koşuldur. İki yeni
servis gecikmeli otomatik başlar; gateway API'ye, keşif gateway'e bağımlıdır.
WinSW 10/30/60 saniyelik kurtarma ve dönen günlükler sağlar. API zaten
PostgreSQL'e, file-agent API'ye bağımlıdır; mevcut hizmet hesapları, Disabled
başlangıç tercihleri, pCloud ve iş kuyrukları değiştirilmez. Gateway sağlık
doğrulaması sertifika hatasını tekrar deneyerek gizlemez; henüz hazır olmayan
dinleyici/API için en çok 30 saniye bekler. Sonuç `INSTALLED` üretim kabulü
anlamına gelmez.

Oluşan **yalnız** `client-profile.json` dosyasını özel dağıtım profili olarak
`HASARBOTU_DISTRIBUTION_PROFILE` ile paketlemeye ver. Paket sürüm 2 profili
zorunlu kılar; IP içeren eski profil yeniden yayımlanamaz. Mantıksal
`apiOrigin` mevcut değerle aynı kalmalıdır; böylece Chromium bölümü, sabit
loopback portu, çerezler ve yerel taslaklar korunur. CA/servis özel anahtarları
korumalı sunucu yedeğine dahildir; kayıp CA sessizce yeniden oluşturulmaz.

Eski istemcileri korumak için mevcut 443 hizmetini ve Serve/Funnel'ı bırak.
`-RepairLegacyCaddy` yalnız incelenen mevcut WinSW XML'i `--config` ile
mutlak dosya yolu kullanarak Caddy çalıştırıyorsa desteklenir; farklı biçim açıkça reddedilir.
Eski XML yedeklenir, özel Caddy şablonu korunur; supervisor mevcut RFC1918
adreslerini 5 saniyede gözler, yapılandırmayı Caddy ile doğrulayıp yalnız IP
değişiminde eski dinleyiciyi yeniden başlatır. Yeni 8443 listener bu sırada
bağımsızdır. Boş ağda eski IP'ye bind edilmez. Başka servislere veya 443'teki
Tailscale/IIS dinleyicisine wildcard bind eklenmez.

Yeni CA 10 yıl, sunucu sertifikası 397 gün geçerlidir. SYSTEM zamanlanmış
görevi başlangıçta ve her gün kalan süreyi kontrol eder, 30 gün kala aynı CA
ile yeniler. Değişmez sertifika/anahtar çiftleri ve atomik Caddyfile geçişi
yarım güncellemeyi önler; önceki Caddyfile/sertifika işaretçisi tutulur.
Yenileme sonrası sağlık başarısızsa önceki çifte geri dönülür. CA bitimine
90 gün kala otomatik kök değiştirilmez; önce istemcilere yeni güven kökünün
dağıtıldığı planlı bir geçiş gerekir.

Tanı: `office-network.mjs wait client-profile.json` TLS/API'yi doğrular;
WinSW `logs/`, `certificate-status.json` ve istemcinin `connection-status.json`
dosyaları kimlik bilgisi içermeyen sonuçları kaydeder. Eski hosts, portproxy
ve güvenlik duvarı kuralları üretim geçişi doğrulanmadan silinmez. Yeni
istemci bunları kullanmaz. Geri alma için yeni servisleri/görevi durdur,
korunan eski XML/Caddyfile'ı geri yükle ve eski hizmeti başlat; veritabanı
migrasyonu veya hasar dosyası değişimi yapılmaz.

### Ofis dışı erişim ve Google dönüş adresi

Kaynakta mevcut fotoğraf Worker'ı Serve/Funnel üzerinden 3200'e gider ve
masaüstü API'sini kasten sunmaz. Bu adres `remoteOrigin` olarak kullanılamaz.
Mevcut uzaktan erişim kuralları değiştirilmedi. LAN gateway ana API'yi 3100'e
iletir, fotoğraf sayfalarını 404 ile ayırır. Field portalın kendi yetkileri
ve mevcut genel adresi korunur.

İlk kurulumda eski mantıksal adres `.ts.net` ise mevcut aynı HTTPS origin'i
profile isteğe bağlı `remoteOrigin` olarak taşınır; LAN önce seçilir ve
Tailscale gerekmez. Bu yedek yol yalnız eski, çalışan tailnet erişimini korur;
Funnel'ın fotoğraf yanıtı ana API kabul edilmez. Bağımsız alan adı hazır
olunca yönetici `-RemoteOrigin` ile günceller; sonraki kurulum/yenileme bu
değeri korur ve eski Tailscale yoluna geri dönmez.

Tailscale'siz dış erişim için yönetilen bir HTTPS alan adı ve erişilebilir
gateway gerekir. CGNAT altında [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/get-started/)
mevcut API'ye `http://127.0.0.1:3100` üzerinden giden, dışarı doğru şifreli
tünel sağlayabilir; alan adı/Cloudflare hesabı, sunucuda connector hizmeti ve
dışarı bağlantı izni gerekir. Ayrı API hostname'i kullan; fotoğraf Worker'ının
allowlist'ini genişletme. API son kullanıcı yetkilerini doğrulamaya devam
eder. API hostname'i profilin `remoteOrigin` alanına eklenir; dış TLS standart
genel CA ile doğrulanır. Loopback dışındaki origin TLS denetimi kapatılmaz.

**3 Kasım 2026 — masaüstü girişinde public callback artık zorunlu değil.**
Google Console'da aynı kurumsal projede ayrı **Desktop app** OAuth istemcisi
oluştur. Web istemcisini Desktop app gibi kullanma veya LAN IP'sini web
redirect listesine ekleme. Sunucunun mevcut güvenli ortamına
`GOOGLE_DESKTOP_CLIENT_ID` ve Google bu istemci için sağlıyorsa
`GOOGLE_DESKTOP_CLIENT_SECRET` ekle; bunlar istemci paketine girmez. Workspace
uygulama erişim politikası ve kurumsal onay operatör tarafından tamamlanır.
Mevcut web/Gmail istemcisi, `GOOGLE_REDIRECT_URI`, alan adı, şifreleme anahtarı
ve kullanıcı yetkileri korunur. Migration `0075_google_desktop_loopback`
önce API veritabanına uygulanmalıdır; eklenen nullable sütun 0.1.90 ile uyumludur.

API `HOST=127.0.0.1` üzerinde kalır. Aynı sunucu ortamına
`TRUST_LOOPBACK_PROXY=true` ekle: yalnız ilk loopback proxy atlamasının istemci
adresi kabul edilir; doğrudan ağ istemcisinin sahte `X-Forwarded-For` başlığına
güvenilmez. Yeni gateway bu başlığı kendi gördüğü adresle değiştirir, sahte
forwarded host/protocol başlıklarını kaldırır. Böylece on farklı personel
tek proxy IP'sinin Google/parola giriş kotasını paylaşmaz; IP başına sınır
korunur. Varsayılan ayar kapalıdır; `After` kontrolü ofis için açık olmasını
ister. Public API bind üzerinde bu ayar yapılandırma hatasıyla reddedilir.

0.1.91 giriş ekranı `/google/status` yanıtında `desktopEnabled=true` görünce
sistem tarayıcısını Desktop app istemcisiyle açar. Google dönüşü
`http://127.0.0.1:<mevcut-köprü-portu>/api/v1/google/desktop/callback` olur.
Köprü yalnız aynı yerel alıcıda başlatılmış, son 10 dakikalık state'i kabul
eder; başka istemcinin akışını ve tamamlanmış callback'in tekrarını API'ye
iletmez. Sayfa yenileme bu bağı korur; uygulama tamamen kapandıysa bekleyen
native giriş yeniden başlatılır. Açılmış oturumun kalıcılığı bundan ayrıdır.
Kodu doğrulanmış LAN TLS üzerinden API'ye iletir. Kod değişimi, PKCE,
tek kullanımlık state, nonce, Google imzası ve **masaüstü istemci audience**
doğrulaması sunucuda kalır. Sonuç ekranı oturum açmaz; `/google/complete`
yalnız ilk uygulamanın HttpOnly çereziyle oturum açar. Kullanıcı hâlâ etkin
olmalı ve ofis yetkisi taşımalıdır. Native yol yalnız giriş içindir; Gmail/SBM
bağlama ve web/saha girişleri mevcut web callback'ini kullanır. Eski API veya
Desktop app ayarı yoksa eski web yolu korunur; bu durum Tailscale'siz yeni
giriş kabulü sayılmaz ve `After` ön kontrolü bunu engeller.

Desteklenen LAN'da masaüstü giriş dönüşü için public DNS, tünel, tarayıcıya özel
CA yükleme veya Tailscale gerekmez. İstemci tarayıcısı Google'a, sunucu Google
token/JWKS uçlarına internet üzerinden erişebilmelidir; API'ye LAN erişimi de
ayrıca gereklidir. Gerçek Workspace hesabı/Console kaydı bu ortamda sınanmadı.
Google'ın [masaüstü PKCE/loopback rehberi](https://developers.google.com/identity/protocols/oauth2/native-app)
ve [kimlik doğrulama kuralları](https://developers.google.com/identity/openid-connect/openid-connect)
bu istemci türünü ve doğrulama gereksinimlerini açıklar.

### 0.1.91 kontrollü ofis geçişi ve geri dönüş

1. Çalışan 0.1.90 yükleyicisini, feed manifestini, API dağıtımını ve veritabanı
   yedeğini koru; ilk geçiş boyunca feed'i değiştirme. Aşağıdaki `Before`
   kontrolünü sunucuda çalıştır. `/` yanıtının 404 olması arıza değildir.
2. Google Desktop app kaydını ve sunucudaki ortam ayarlarını tamamla. Mevcut
   servis dağıtım aracıyla API/ortak paket adayını ayrı hedefte hazırla; bakım
   sırasında `npm run migrate:up --workspace @hasarbotu/database` ile yalnız
   mevcut operatör DB ortamını kullanarak migration'ları uygula. Önce migration,
   sonra yeni API; 0.1.90 istemcileri çalışmayı sürdürür. Bu işlem burada yapılmadı.
3. Yukarıdaki `install-office-network.ps1` komutunu önce önizle, sonra
   `-Apply -RepairLegacyCaddy` ile uygula. Üretilen `rollbackReceipt` yolunu
   koru. Eski 443/Serve/Funnel/IIS yollarını ve hosts kayıtlarını kaldırma.
4. Aynı dizindeki `set-office-service-recovery.ps1` betiğini önce önizle,
   sonra `-Apply` ile çalıştır. PostgreSQL dahil sekiz mevcut hizmetin SCM
   kurtarması 10/30/60 saniye + **none** olur. WinSW XML'leri de güncellenir;
   SCM son eylemi tekrarladığı için yalnız üç restart yeterli değildir.
   Eksik/farklı isim varsa envantere göre açık `-Services` listesi ver; araç
   eksikleri atlamaz. Çalışan süreç, hesap, bağımlılık, Manual/Disabled tercihi
   değiştirilmez. Ayrı kurtarma receipt'i oluşur.
5. Sunucudan **yalnız** gerçek `client-profile.json` dosyasını güvenli biçimde
   al; `HASARBOTU_DISTRIBUTION_PROFILE` ile gerçek ofis adayını yeniden paketle
   ve imzala; mevcut `HASARBOTU_DISTRIBUTION_ROOTS`/paket klasör köklerini de
   0.1.90 ile koru. Buradaki `.test` CA'lı yerel yükleyiciyi personele dağıtma.
   Mantıksal `apiOrigin` 0.1.90 ile aynı kalır; NSIS kaynak profili yeniler,
   kullanıcı profili, sabit köprü portu, çerez ve taslaklar korunur. İstemcide
   JSON düzenleme/UAC/hosts işlemi gerekmez. İlk normal açılış Windows oturum
   başlangıcını kaydeder; sonraki Windows kapatma tercihi korunur.
6. `After` kontrolünü gerçek adayın hash'i ve güvenilen yayıncı thumbprint'iyle
   çalıştır. Ön kontrol gerçek Google onayını ve istemci kabulünü **PENDING**
   bırakır. Tek pilot bilgisayarda aşağıdaki kabulü tamamla; sonra mevcut
   kimlikli ofis yayın prosedürünü uygula. Kullanıcılara zorla kurulum yapma.

```powershell
# $origin mevcut mantıksal origin; $node gerçek Node 24 yolu.
.\test-office-network-readiness.ps1 -Stage Before -ApiOrigin $origin -NodeExe $node
.\set-office-service-recovery.ps1                 # önizleme
.\set-office-service-recovery.ps1 -Apply          # ayrı rollbackReceipt kaydet
.\test-office-network-readiness.ps1 -Stage After -ApiOrigin $origin -NodeExe $node `
  -Installer $installer -ExpectedSha256 $sha256 -ExpectedSignerThumbprint $publisherThumbprint
```

Geri dönüş sırası: feed'i değiştirmediysen 0.1.90 aynen kalır. Önce hizmet
kurtarmasını `set-office-service-recovery.ps1 -RollbackReceipt $recoveryReceipt`
ile önizle, `-Apply` ile geri al; sonra
`rollback-office-network.ps1 -Receipt $networkReceipt` ve `-Apply` kullan.
İkinci araç eski Caddy XML/aktif yapılandırmasını, önceki ağ dosyalarını,
zamanlanmış görevi ve çalışma durumlarını geri getirir; yalnız yeni ağ
hizmetlerini/kurallarını kaldırır. Hatalı ilk kurulumdan sonra tekrar kurulum
desteklenir. Hash/ACL/makine uyuşmazlığı reddedilir; servis kurtarma aracı
sonraki operatör XML/politika değişikliğini ezmez. API dosyalarını mevcut
dağıtım receipt'iyle geri al; **0075 sütununu ve iş verisini silme**. İstemci
pilotu gerekiyorsa korunan 0.1.90 NSIS ile aynı dizine geri kur, `userData`yı
silme. Feed'e sürüm düşürme manifesti yayınlama. NSIS geri kurma kabulü gerçek
pilot Windows profilinde ayrıca yapılmalıdır.

**Ofis kabul listesi:** Tailscale kurulu olmayan temiz Türkçe Windows profili;
ilk kurumsal giriş + yetkisiz/kapalı hesap reddi; 0.1.90 üstüne yükseltmede
oturum/taslak/pCloud/SBM/rapor/dosya işlemleri; istemci oturum açılışında otomatik
başlama; LAN kablosu/internet kesilip gelmesi; DHCP'de `.100 → .108` ve yeni
adres; çok adaptör/VLAN/güvenlik duvarı; sunucu ve istemci reboot; Caddy/API/PG
çökmesi ve kurtarma bütçesinin dolması; sertifika yenileme/yanlış CA reddi;
3100 ana API / 3200 fotoğraf ayrımı; pilot rollback. Son aşamada eski kurulu
istemcinin kimlikli feed'de yeni sürümü görmesini ve indirdiği gerçek paketin
boyut/SHA-256/imzasını doğrula. Yerel sentetik testler bu kabulün yerine geçmez.

Dış gereksinimler: gerçek ofis CA profili ve sunucu yöneticisi, Google Console /
Workspace onayı, güvenilen kod imzalama sertifikası ve zaman damgası hizmeti,
gerçek pilot Windows bilgisayarı. Ofis dışı Tailscale'siz **API erişimi** için
ayrıca operatörün alan adı/tünel hesabı gerekir; native OAuth bunu sağlamaz.

Üretim geçişi şu an **PENDING**: 2 Kasım 2026'da kayıtlı yönetim SSH adresi ve
bildirilen iki LAN adresinde 22/443 erişimi sağlanamadı. Gerçek sunucu DHCP
değişimi, Windows yeniden başlatma, gerçek kurumsal Google girişi, eski
kurulu istemcinin feed/indirme doğrulaması ve ofis yayını yapılmış sayılmaz.

Bu dizin Faz A ofis dağıtımı için WinSW servis şablonları
ve salt-okunur/planlı PowerShell araçları içerir. Tam prosedür için:

**→ [`docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md`](../../docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md)**

`automatic-folder-discovery.mjs` klasör taşıma/yeniden adlandırma bildirimleriyle taramayı
başlatır; iki tutarlı gözlem arasındaki doğrulama beklemesi 1 saniyedir. Bildirim desteği
yoksa yapılandırılmış periyodik tarama sürer; `status.json` içindeki `watching` ve
`watchErrorCode` durumu gösterir. Eski, işaretsiz workspace'lerin kaybolan konumları
tekil vaka ve kayıtlı içerikle doğrulanır. İsteğe bağlı mutlak `attestationStoreDirectory`
ayarında eski konuma ait değişmez pCloud dosya kimliği/revizyonu kanıtı bulunursa eksik
tarihsel belgeler kimlik devamlılığını engellemez; geçmiş ve dosya kayıtları korunur.

## Kapanış sonrası kaynak kurtarma

Klasör kimliği düzeltmesi `repair-folder-identity.mjs` ile ayrı operatör bakım akışıdır:
`node repair-folder-identity.mjs <config.json> plan <decision.json> <plan.json>` yalnız okur;
`apply <plan.json> <approval.json> <receipt.json>` ve `rollback <receipt.json> <approval.json>` açık onay ister.
Karar iki vaka UUID'sini, `duplicate_claim`/`distinct_claims` ilişkisini, her vaka için resmî kanıt referansını ve hedef pCloud kimliği/yolunu içerir;
belirsiz ilişki uygulanmaz. Mükerrer kaydın eşlemesi kaldırılacaksa kayıt önceden arşivli olmalıdır; kayıt/not/evrak/geçmiş silinmez, fiziksel taşıma yapılmaz.
Yapılandırma `runtimeDirectory`, `sourceRoot`, `pcloudDatabasePath`, `topLevelFolderName`, `organizationId`, `actorUserId`,
`evidenceFile`, özel ACL'li `backupDirectory`, `pgDumpPath`, `pgRestorePath` ve `maintenanceWindowConfirmed` alanlarını taşır.
`DATABASE_URL` yerel DB'yi, `RESTORE_TEST_DATABASE_URL` boş ve adı `_test` ile biten ayrı geri yükleme DB'sini göstermelidir.
Kanıt `folder-identity-evidence/1` biçiminde hedeflerin `sourceFolderId`, `relativePath`, sıralı `directories` ve `files[{path,size,sha256}]` listeleriyle `absentPaths` listesini içerir.
Onay `operatorId`, `approvedAt`, `approvedPlanHash`; geri alma onayı `approvedReceiptHash` kullanır.
Araç gerçek DB yedeğini geri yükleyip planı karşılaştırır, klasörleri bağımsız kopyalayıp hash'ler, geri alma makbuzunu commit öncesinde diske kalıcı yazar.
Sürüm/içerik/iş kuyruğu/kimlik değişirse durur; çalışan ilgili akışlar operatör bakım penceresinde durdurulmalıdır.
Test: `TEST_DATABASE_URL` ve `TEST_PG_BIN` ile `node --test deploy/windows-service/repair-folder-identity.test.mjs`.

File Agent, doğrulanmış klasör taşımasından sonra kaynak içeriği silmek yerine kaynak ebeveynindeki `_HASARBOTU_OFFICE/cleanup/<operationId>-<operationVersion>` dizinine atomik taşır. Bu alan tarama dışında tutulur ve otomatik silinmez. Taşıma sırasında içerik değişirse veya kaynak yeniden oluşursa işlem manuel kurtarma ister; audit kaydındaki `safeOutcomeCode` ve saklanan içerik birlikte incelenmelidir. Saklanan kaynaklar, hedef bütünlüğü ve ofis saklama politikası doğrulandıktan sonra yetkili operatör tarafından yönetilir.

File Agent dağıtımı `THIRD-PARTY-NOTICES.txt` içindeki tam LGPL-3.0/GPL-3.0 metinlerini ve sabitlenmiş libheif-js/libheif derleme-kaynak bağlantılarını korur. Kapanıştaki harici paketlerin kendi `LICENSE`/`NOTICE` dosyaları da tam dizin kopyasıyla taşınır; sentetik dağıtım testi bunların SHA-256 eşleşmesini doğrular. Derlenmiş tüm codec bileşenlerinin ticari dağıtım ve karşılık gelen kaynak sağlama koşulları ayrıca doğrulanmalıdır.

## İçerik

| Dosya | Amaç |
|---|---|
| `hasarbotu-api.winsw.xml` | API için WinSW servis **şablonu**. Makineye özgü yer tutucu (`__NODE_EXE__`, `__APP_DIR__`) içerir; olduğu gibi kurulmaz. |
| `hasarbotu-file-agent.winsw.xml` | File Agent için WinSW servis **şablonu**. Aynı yer tutucu modeli. |
| `install-services.ps1` | Şablonları render edip WinSW ile kurar. `-Apply` verilmeden yalnız PLAN yazdırır, hiçbir değişiklik yapmaz. `-Services Api`/`-Services FileAgent`/(varsayılan) ikisi (HB-2026-142, D9): tek-servis seçici — seçilmeyen servise ait hiçbir dosya/dizin okunmaz/doğrulanmaz/değiştirilmez. Zaten SCM'de kurulu bir servis seçilirse (idempotency) `-Apply` olmadan bile fail-closed reddedilir; bu betik var olan bir servisi asla yeniden `install` etmez. |
| `install-services.tests.ps1` | Bağımlılıksız test script'i (Pester gerektirmez). `-Services` yokken eski davranışın korunduğunu, tek-servis modunda diğer servise hiç dokunulmadığını, boş `-Services`in reddedildiğini ve idempotency guard'ını (bu makinedeki gerçek `hasarbotu-file-agent` servisiyle) test eder. |
| `deploy-service-artifacts.ps1` | Servis KURMAZ, env YAZMAZ, servis BAŞLATMAZ (D9 ikinci küçük paket, HB-2026-143) — yalnız bir servisin build çıktısını (`dist\` + `package.json` + varsa `THIRD-PARTY-NOTICES.txt`, allowlist) bir dağıtım dizinine fail-closed, idempotent, atomik şekilde hazırlar. Eksik build/artifact/reparse-point/disk alanı/yazma izninde `-Apply` ile bile UYGULANMAZ. Hedef zaten aynı içerikteyse (`already_up_to_date`) hiçbir şey değiştirmez. Önceki dağıtım varsa **kopyalamadan**, atomik `Directory.Move` ile Administrators-only+zaman damgalı+hash manifestli bir yedeğe taşınır; yeni içerik önce staging dizininde hash doğrulanır, sonra atomik olarak hedefe taşınır, sonra hedefteki her dosya YENİDEN okunup bağımsız doğrulanır. `-Rollback -RollbackBackupPath <yol>` ile (yedek bütünlüğü kendi manifestine karşı doğrulanarak, mevcut içerik de ayrıca yedeklenerek) geri alınabilir. **Kapanış-farkındalı (HB-2026-144):** opsiyonel `-DependencyClosureManifestPath`/`-RepoRoot` verilirse (bkz. `resolve-runtime-dependency-closure.mjs`), workspace-internal paketlerin kendi `dist/`+`package.json`'ı ve harici paketlerin TAM dizini de dahil edilerek gerçekten kendi kendine yeten (self-contained) bir dağıtım üretir; derin iç içe override zincirlerinde Windows MAX_PATH'i fail-closed tespit eder; kilit dosyasında görünmeyen, derlenmiş koddaki `new URL('../...', import.meta.url)` veri dosyası referanslarını (`ExtraDataReferences`) tespit edip GERÇEK hedefe göre eksikse `-Apply`'ı net bir mesajla reddeder (otomatik kopyalamaz — hedef tek bir `-TargetDir`in dışına çıkabilir). Parametreler verilmezse davranış HB-2026-143 ile birebir aynıdır. |
| `deploy-service-artifacts.tests.ps1` | Bağımlılıksız test script'i (30 test). Taze dağıtım, eksik dist/package.json/ebeveyn/reparse-point blocker'ları, allowlist dışı dosyaların (node_modules, .env, src) KESİNLİKLE kopyalanmadığı, idempotency (ikinci `-Apply` hiçbir şey değiştirmez), gerçek yedekleme+ACL+bağımsız hash doğrulaması, rollback önizleme/uygulama, bozuk-yedek reddi, kapanış-farkındalı dağıtım (workspace-internal+harici paket doğru yollarla, iç içe node_modules çift-sayılmadan, MAX_PATH fail-closed, ek veri referansı blocker'ı) senaryolarını test eder. |
| `resolve-runtime-dependency-closure.mjs` | Salt-okunur (HB-2026-144): `package-lock.json`dan (lockfileVersion 3, CANLI `node_modules` introspeksiyonu DEĞİL) bir servisin GERÇEK çalışma zamanı bağımlılık kapanışını Node'un kendi modül çözümlemesiyle (nested override'lar dahil) birebir eşleşen şekilde hesaplar. Workspace-internal/harici paketleri sınıflandırır, `link: true` workspace stub'larını gerçek hedefe yönlendirir, platform/mimari ile uyumsuz `optionalDependencies`i eler, her harici paketin diskteki sürümünü kilitle karşılaştırır (`lockIntegrityOk`) ve derlenmiş çıktıyı statik tarayarak kilit dışı veri dosyası referanslarını (`ExtraDataReferences`) tespit eder. |
| `resolve-runtime-dependency-closure.test.mjs` | Sentetik lockfile fixture'ı (hoisted/nested override/optional platform filtresi/devDependencies dışlanması/link-stub yönlendirmesi) ve GERÇEK monorepo `package-lock.json`ına karşı entegrasyon testi (api/file-agent için beklenen paket varlığı/yokluğu + lock integrity) içerir (16 test). |
| `smoke-test-deployed-service.mjs` | Bir self-contained deploy artifact'ının `dist/index.js`'ini, ana giriş-noktası koruması sayesinde gerçek servis başlatmayı TETİKLEMEDEN `import()` ederek, repo köküne/`node_modules`'a/`NODE_PATH`'e hiç erişimi olmayan izole bir Node sürecinden module-resolution + native-addon yüklemesinin (argon2, `@napi-rs/canvas`, tesseract.js vb.) gerçekten çalıştığını kanıtlar. |
| `smoke-test-deployed-service.test.mjs` | Sentetik fixture'larla başarı (iç içe bağımlılık + main-guard'ın gerçek başlatmayı tetiklemediği), eksik `dist/index.js`, çözülemeyen bağımlılık ve eksik `-TargetDir` senaryolarını test eder (4 test). |
| `provision-extra-data-references.ps1` | Servis KURMAZ, env YAZMAZ (D9 dördüncü küçük paket, HB-2026-145) — `resolve-runtime-dependency-closure.mjs`in tespit ettiği `ExtraDataReferences`i (kilit dosyasında görünmeyen, derlenmiş koddaki `new URL('../...', import.meta.url)` ile repo köküne sabit kodlanmış veri dosyası referansları) GERÇEK, planlanan servis hedefine göre `deploy-service-artifacts.ps1` ile BİREBİR AYNI hesaplamayla türetilen konuma sağlar. Hiçbir veri yolu (`reference-data/` dahil) sabit kodlanmaz. Kaynak allowlist = referansı içeren dizinin TAMAMI; allowlist içindeki her `snapshot.json` adlı dosya `verify-value-loss-reference-data-identity.mjs` ile uygulamanın KENDİ kanonik hash algoritmasına karşı doğrulanır (genel SHA-256'nın ötesinde, "bu GERÇEKTEN doğru sürüm mü" sorusunu cevaplar). `-Apply`'dan hemen önce kaynağı TAZE yeniden tarayıp plan anı manifestiyle karşılaştıran eksik/fazla/değişmiş (TOCTOU) fail-closed koruması var. Staging+atomik replace, admin-only hash'li zaman damgalı yedek, idempotency, `-Rollback -RollbackBackupPath` — `deploy-service-artifacts.ps1` ile aynı ilkeler. Birden fazla FARKLI hedef köküne çözülen referans bulunursa (bugün yok) fail-closed reddeder (henüz desteklenmiyor). |
| `provision-extra-data-references.tests.ps1` | Bağımlılıksız test script'i (12 test). Önizleme, eksik kaynak dizini, tahrif edilmiş kimlik (SNAPSHOT_IDENTITY_MISMATCH) blocker'ı, boş `ExtraDataReferences` için `nothing_to_provision`, çoklu-farklı-hedef-grubu reddi, gerçek `-Apply` (doğru hedefe, bağımsız doğrulama), idempotency, gerçek yedekleme+ACL, rollback önizleme/uygulama, hedef önceden doğru içerikle sağlıyorsa idempotent, servis dağıtım kökü yoksa sağlık-tabanı blocker'ı senaryolarını test eder. |
| `verify-value-loss-reference-data-identity.mjs` | Salt-okunur (HB-2026-145): değer kaybı referans-veri snapshot'ının `identity`+kanonik JSON SHA-256'sını, `packages/domain`nin KENDİ sabitlerine (`VALUE_LOSS_SNAPSHOT_IDENTITY`, `REAL_MARKET_VALUE_LOSS_SNAPSHOT_SHA256`) karşı doğrular. `canonicalizeValueLossJson`, `packages/domain/src/value-loss-rule-snapshot.ts`nin kanonikleştirme algoritmasından BİREBİR kopyalanmıştır (sıradan `JSON.stringify` anahtar sıralamaz); SHA-256 `node:crypto` ile hesaplanır (domain paketinin elle yazılmış, sandbox-portable implementasyonuyla matematiksel olarak eşdeğer — aynı UTF-8 baytları için standart SHA-256 sonucu implementasyondan bağımsızdır). |
| `verify-value-loss-reference-data-identity.test.mjs` | Kanonik JSON sıralama, geçersiz/eksik/yanlış identity, tahrif edilmiş içerik red yolları ve **GERÇEK diskteki snapshot.json'ın domain paketinin GERÇEK sabitine pinlenmiş** doğrulamasını test eder (12 test). |
| `bootstrap-first-admin.mjs` | **Bu depodaki tek gerçek `INSERT` yolu olan Node aracı** (D9 beşinci küçük paket, HB-2026-147). İlk organizasyon + admin kullanıcısını uygulama anında elle girilen bilgilerle oluşturur; yalnız `organizations=0` VE `users=0` VE `admin` rolü seed edilmişken çalışır — bu koşul önce (preview/prompt öncesi) kontrol edilir, SONRA `bootstrapFirstAdmin`nin açtığı TEK transaction'ın İÇİNDE TAZE olarak yeniden kontrol edilir (TOCTOU koruması — başka bir sürecin arada eklediği rakip bir organizasyon satırı yakalanır, yarım kullanıcı kalmaz). Gerçek argon2id hash mekanizmasını (`@hasarbotu/api`nin `hashPassword`/`ARGON2_OPTIONS`) ve gerçek `@hasarbotu/contracts` doğrulamalarını (`userSummarySchema.shape.email`/`.displayName`, `passwordSchema`) YENİDEN KULLANIR — yeniden implemente etmez; organizasyon kodu/adı repo'da ayrı bir şema olmadığından migration'daki GERÇEK DB CHECK kısıtlarına karşı elle doğrulanır. Parola **asla** CLI argümanı/dosya/log olarak geçmez — yalnız ham (raw-mode, tam yankısız) terminalden okunur; `--apply` dışında hiçbir bayrak kabul edilmez ve TTY olmayan bir stdin'de (ör. yanlışlıkla script'ten çağrılırsa) prompt'a gelmeden fail-closed reddedilir (non-interactive/env-var bypass BİLİNÇLİ olarak yok). Organizasyon+kullanıcı+`user_roles`+iki `audit_events` (`details.bootstrap=true`) kaydı tek transaction'da yazılır; hata/yarışta tam `ROLLBACK`. Başarılı işlem sonrası parola/hash İÇERMEYEN bir kanıt raporu Administrators-only ACL ile `C:\ProgramData\HasarBotu\migration-preflight\`e yazılır (en iyi çaba — bu adım başarısız olsa bile DB işlemi zaten commit edilmiştir). |
| `bootstrap-first-admin.test.mjs` | 7 birim/CLI testi (validator'lar, `DATABASE_URL` eksikliği, bilinmeyen argüman reddi — DB gerektirmez, her zaman çalışır) + `TEST_DATABASE_URL` verildiğinde çalışan 8 GERÇEK PostgreSQL entegrasyon testi: başarılı bootstrap (parola GERÇEKTEN argon2 ile doğrulanabilir, `user_roles`='admin', 2 audit kaydı), ikinci çalıştırmanın tek-kullanımlık reddi, TOCTOU yarışı (araya elle eklenen rakip organizasyon satırı), geçersiz girdinin DB yazmadan önce reddi, DB CHECK ihlalinin ROLLBACK ile sıfır satır bırakması, CLI preview (sıfır yazma), CLI `--apply`+TTY-olmayan stdin (sıfır yazma, `STDIN_NOT_INTERACTIVE`). |
| `bootstrap-storage-root.mjs` | **İkinci gerçek `INSERT` yolu** (final production readiness denetimi, 2026-08-09). Repo-çapında kaynak taraması `storage_roots` (migration 0006) için HİÇBİR insert yolu olmadığını buldu — `storage/store.ts` ve `workspace/store.ts` yalnız SELECT eder (boşsa fail-closed `unknown_reference`/`unknown_root`), ve bu tablo `case_locations`, `case_workspace_provisionings`, `case_file_operations`/`case_lifecycle_operations`'ın (kaynak+hedef) FK'sini besler. Gerçek production DB'de gerçek `hasarbotu-office` organizasyonu için 0 satır doğrulandı — D9 zaten `HASARBOTU_AGENT_ROOTS`i (`office-primary`) File Agent tarafına yazmışken, DB tarafı hiç seed edilmemiş; ilk gerçek vakanın workspace provisioning/konum atama/dosya işlemi bu yüzden daha ilk adımda fail-closed reddedilirdi. B9 (`bootstrap-first-admin.mjs`) ile AYNI çözüm deseni: küçük, fail-closed, idempotent, test edilmiş CLI — yeni bir API ucu değil (kök kaydı nadir, yüksek-güven, yalnız-operatör bir işlemdir, `FILE_STORAGE_AND_AGENT_PLAN.md` §2 ile tutarlı). Parola taşımadığı için `bootstrap-first-admin.mjs`nin aksine TTY-only DEĞİLDİR — diğer deploy araçlarıyla (`deploy-service-artifacts.ps1` vb.) aynı düz `--apply` deseni. `@hasarbotu/contracts`nin GERÇEK `storageRootSchema.shape.rootKey`/`.shape.label`'ını (API'nin konum/workspace uçlarının kullandığı AYNI zod şeması) YENİDEN KULLANIR. Aynı (organizationCode,rootKey) için ikinci çağrı `already_exists` DÖNER (hata DEĞİL) — tek-kullanımlık admin bootstrap'ın aksine bir org'un ömrü boyunca birden fazla kök meşru olabilir; INSERT ayrıca gerçek eşzamanlı bir çakışmaya karşı `storage_roots_org_key_unique` ihlalini yakalayıp `already_exists`e çevirir (yalnız aynı-transaction TOCTOU kontrolüyle sınırlı kalmaz). Audit: `storage_root.created` aksiyonuyla `audit_events`e tek transaction'da yazılır; başarı sonrası secret İÇERMEYEN kanıt raporu Administrators-only ACL ile `C:\ProgramData\HasarBotu\migration-preflight\`e yazılır. **Gerçek production DB'ye karşı yalnız salt-okunur önizleme çalıştırıldı:** `Status:"ready"`, `OrganizationFound:true`, `AlreadyExists:false` — gerçek `--apply` HENÜZ çalıştırılmadı, kullanıcının onayını bekliyor. |
| `bootstrap-storage-root.test.mjs` | `bootstrap-first-admin.test.mjs` ile AYNI iki katmanlı desen: 7 birim/CLI testi (DB gerektirmez) + `TEST_DATABASE_URL` ile çalışan 10 GERÇEK PostgreSQL entegrasyon testi (organizasyon yok/var, başarılı apply+audit doğrulaması, idempotent ikinci çağrı, rakip-yazım benzetimi, geçersiz rootKey reddi, CLI preview/apply/idempotent-ikinci-apply). Gerçek `hasarbotu_test` veritabanına karşı 17/17 PASS. |
| `probe-p-drive-system-context.ps1` | Bir sürücü harfinin SYSTEM (Windows servis) bağlamından GERÇEKTEN görünüp görünmediğini geçici bir Görev Zamanlayıcı görevi ile ölçer. Görev KAYDI her durumda kaldırılır; sonuç/log `C:\ProgramData\HasarBotu\probe\` altında zaman damgalı, kalıcı audit kanıtı olarak bırakılır. |
| `setup-file-agent-service-account.ps1` | D6 için adanmış File Agent hesabı, LSA hakları, dar ACL ve WinSW kurulumunu planlar; yalnız açık `-Apply` ile değişiklik yapar ve hata halinde geri alır. |
| `preview-file-agent-pcloud-db-access.ps1` | File Agent'ın (`svc-hb-fileagent`) pCloud'un yerel DB'sine (`%LOCALAPPDATA%\pCloud\data.db`, interaktif `-PCloudSyncAccount` profili altında) cross-account salt-okunur erişimi için **yalnız PLAN + PREVIEW** aracı (HB-2026-162/163, mimari belgesi §8'in açık kararı). `-Apply` YOK — yapısal olarak (guard'lı değil, hiç mevcut değil) hiçbir ACL/pCloud/servis/env/dosya mutasyonu yapamaz. Gerçek DB kök klasöründen sürücü köküne kadar tam ata zinciri gerçek ACL ile taranır; her düğümde hedef hesabın SID'i + `Authenticated Users`/`Everyone` (her başarılı kimlik doğrulamada otomatik gelen well-known gruplar) için AÇIK DENY'in her zaman ALLOW'dan önce kazandığı bir simülasyonla "şu an erişim var mı" belirlenir (gerçek `runas` imkânsız — hesap kasıtlı `SeDenyInteractiveLogonRight` ve hiç bilinmeyen/saklanmayan parola ile korunuyor, bu sınır rapor içinde açıkça belirtilir). `pcloud-maintenance-window-gate.mjs`'in `captureDatabaseFiles()`'ının yalnız 3 bilinen dosya adını (`data.db`/`-wal`/`-shm`) doğrudan yol ile `stat`'ladığı, hiçbir zaman klasör listelemediği kaynak koddan doğrulanmıştır — bu yüzden `ListDirectory` HİÇBİR düğümde gerekli değildir. Çıkarılan en-az-yetki ACE seti: yalnız engelleyen ata dizinlerinde `Traverse` (bu-klasör-yalnız, miras yok) + pCloud klasöründe `Read, Synchronize` (dosyalara miras alınır — `-wal`/`-shm` silinip yeniden oluşsa bile otomatik kapsanır, standart NTFS mirası). Write/Modify/Delete/Create/AppendData/TakeOwnership/ChangePermissions biti hiçbir ACE'de YOKTUR — hem statik denetimle hem çalışma zamanı öz-kontrolüyle (`PLANNED_RIGHTS_CONTAIN_FORBIDDEN_BITS`) doğrulanır. Her düğümün mevcut tam SDDL'si admin-only hash'li rapora yazılır — rollback planı bu SDDL'yi birebir geri yüklemektir (hangi ACE'nin eklendiğini tahmin etmeye gerek yok); aynı aracın yeniden çalıştırılması drift kontrolüdür. |
| `preview-file-agent-pcloud-db-access.tests.ps1` | Bağımlılıksız test script'i (5 test), gerçek bir yerleşik hesabı (`NT AUTHORITY\LOCAL SERVICE` — yeni hesap oluşturmadan) sentetik, izole bir dizin ağacında hedef kimlik olarak kullanır: hiç izin yokken tam plan üretimi + hiçbir ACE'de yazma/silme biti olmaması (bağımsızca yeniden hesaplanarak) + gerçek diskte HİÇBİR ŞEYİN değişmediği; bir ata düğümünde önceden izin varsa yalnız o düğümün "granted" dönmesi ve plana dahil edilmemesi; aynı düğümde açık DENY'in açık ALLOW'dan önce kazanması; `-wal`/`-shm` yokken çökmeden `Exists:false` dönmesi; var olmayan servis hesabı adının fail-closed reddi. |
| `apply-file-agent-pcloud-db-access.ps1` | Yukarıdaki preview aracının ürettiği raporu tüketen **APPLY + ROLLBACK** aracı (HB-2026-164). Kendi ACE listesini asla uydurmaz — yalnız hash doğrulanmış preview raporunun `PlannedMinimumAces` dizisini kabul eder; her ACE `Traverse`/`Read`/`Synchronize` beyaz listesine karşı bit-bit yeniden doğrulanır (Write/Modify/Delete/Create/TakeOwnership/ChangePermissions kesinlikle reddedilir — `FullControl`'ün `Read`'in bitleriyle ÇAKIŞTIĞI gerçek bir hata burada bulunup düzeltildi, artık ayrı bir "izin verilenlerin dışında hiçbir bit yok" kontrolüyle bağımsızca doğrulanıyor), Identity parametreyle eşleşmeli, yol bağımsızca yeniden hesaplanan ata zincirinin dışına asla çıkamaz. `-Apply`'dan ÖNCE her zaman: orijinal preview scripti TAZE yeniden çalıştırılır (gerçek bir alt-süreç çağrısı, ayrı bir yeniden-uygulama değil) ve plan aynı çıkmazsa `PREVIEW_DRIFT_SINCE_REPORT` ile durur; her dokunulacak düğümün TAZE ACL SDDL'si raporun kaydettiği baseline ile karşılaştırılır, farklıysa `ACL_DRIFT_SINCE_PREVIEW_REPORT` ile durur — ikisi de sıfır mutasyonla. `-Apply` yalnız `AddAccessRule` ile EKLER (asla `SetAccessRuleProtection` ile sıfırlamaz); herhangi bir adım başarısız olursa o ana kadar uygulanan HER şey ters sırada, dokunulmadan önceki TAM SDDL'ye geri alınır. Apply sonrası: (1) her düğüm yeniden okunup ACE'nin gerçekten orada olduğu doğrulanır; (2) WAL/SHM sürekliliği GERÇEK bir kanıtla doğrulanır — pCloud klasöründe bir kullan-at dosya oluşturulur, ACE'yi miras aldığı kontrol edilir, silinir (başarısızlıkta rollback tetiklenir); (3) servis hesabı bağlamında GERÇEK bir Zamanlanmış Görev (Task Scheduler COM API, `TASK_LOGON_SERVICE_ACCOUNT`) ile salt-okunur DB okuma denenir — bu makinede `SeBatchLogonRight` eksikliği/servis Disabled olması nedeniyle şu an tamamlanamıyor; bu YENİ bir hak/izin OTOMATİK VERİLEREK gizlenmez, sonuç dürüstçe `Succeeded:false` + tam nedeniyle raporlanır (ACL değişikliği geri ALINMAZ — bağımsızca doğrulanmış zaten). `-Rollback` modu, önceki bir Apply kanıt raporundaki TAM SDDL'yi düğüm düğüm birebir geri yükler ve doğrular. Tüm adımlar Administrators-only+hash'li kanıt üretir. **(HB-2026-165 eklentisi:)** Apply sonrası ayrıca (4) GERÇEK 3 DB dosyasının (data.db/-wal/-shm) post-apply ACL'i üzerinde SID/effective-access SİMÜLASYONU çalıştırılır (preview'in kendi modeliyle, ama gerçek dosyalar üzerinde) — data.db için Read=granted/Write=not-granted zorunlu ve fail-closed, -wal/-shm yoksa tolere edilir; (5) rollback PAKETİ, `-Rollback`'in kullanacağı aynı hash-doğrulamalı yoldan geri okunup şeması doğrulanır (rollback GERÇEKTEN çalıştırılmaz — yalnız kullanılabilir olduğu kanıtlanır). **Gerçek Apply GERÇEK `svc-hb-fileagent` hesabına karşı çalıştırıldı (HB-2026-165, kullanıcı onayıyla)** — 6 ACE uygulandı, üç bağımsız yöntemle (aracın kendi kontrolü, taze preview, `icacls`+.NET sayısal okuma) doğrulandı; servis hesabı bağlamı gerçek probe'u File Agent kontrollü aktivasyonuna ertelendi. |
| `apply-file-agent-pcloud-db-access.tests.ps1` | Bağımlılıksız test script'i (5 test), `NT AUTHORITY\LOCAL SERVICE`yi hedef kimlik olarak kullanarak GERÇEK bir sentetik ağaçta GERÇEK ACL mutasyonu + rollback çalıştırır (preview aracının kendi testleriyle aynı desen; gerçek `svc-hb-fileagent`e veya gerçek pCloud verisine asla dokunmaz): tam Apply → 6 ACE'nin gerçekten diskte olduğu + WAL/SHM mirasının gerçekten kanıtlandığı → Rollback → SDDL'nin bit bit eski hâline döndüğü; `-Apply` verilmeden hiçbir şeyin değişmediği; kasıtlı olarak bozulmuş (WriteData enjekte edilmiş) bir raporun sıfır mutasyonla reddi; önizleme sonrası enjekte edilen ilgisiz bir ACL değişikliğinin (drift) sıfır mutasyonla reddi; `-ServiceAccountName` parametre uyuşmazlığının reddi. Bu test dosyasının geliştirilmesi sırasında aracın kendisinde 3 GERÇEK hata bulunup düzeltildi (yalnız testler sayesinde: `FullControl`'ün beyaz liste maskesiyle çakışması, çıplak sürücü harfi belirsizliği ata-zinciri kontrolünde tekrar ortaya çıkması, önizleme sarmalayıcısının başarı yolunda hiç `Status` alanı olmaması). **(HB-2026-165 eklentisi:)** TEST1'e rollback-paketi doğrulaması ve DB-file simülasyonunun hem data.db hem data.db-wal üzerinde Read=granted/Write=not-granted gösterdiğini kontrol eden 5 yeni assertion eklendi. |
| `preview-file-agent-controlled-activation.ps1` | File Agent KONTROLLÜ AKTİVASYON — PLAN + PREVIEW aracı (HB-2026-166). `-Apply` yapısal olarak yok; hiçbir env/servis/dosya/pCloud değişikliği yapmaz. 6 önkoşul kategorisini gerçek, salt-okunur kontrollerle doğrular — her biri `verified_ok`/`verified_with_note`/`deferred_to_real_activation`/`blocked_structural` olarak raporlanır: (1-6) pCloud DB salt-okunur erişim + yazma/silme yokluğu (orijinal preview aracını taze yeniden çağırır, ardından raporun kendi özetine güvenmeden Aces'i bağımsızca yeniden tarar — yalnız SERVİS HESABININ kendi ACE'lerine bakar, ilgisiz ön-var-olan Windows varsayılan ACE'leri (ör. `Authenticated Users`'ın `C:\` kökünde standart bu-klasör-yalnız AppendData'sı) yanlışlıkla engelleyici saymaz — gerçek bir test çalıştırmasında yakalanan gerçek bir yanlış-pozitif düzeltmesi); per-case freshness gate erişimi; storage root ACL; servis config/credential/ACL/env; startup/health/crash-restart/rollback tasarımı. **Gerçek, önceden bu bağlamda belgelenmemiş bulgu:** `run-pcloud-case-reconciliation.ps1` varsayılan olarak kaynağını `P:\...`a işaret ettiriyor — pCloud'un SANAL SÜRÜCÜSÜ, etkileşimli oturuma bağlı, Session 0'da (yani HERHANGİ bir Windows servisinden) GÖRÜNMEZ (aynı, zaten belgelenmiş kısıt — `hasarbotu-file-agent.winsw.xml`'in kendi başlık yorumu). Bu yüzden freshness gate'in MEVCUT CLI sözleşmesi bir servis içinden yapısal olarak çağrılamaz — `per_case_freshness_gate_access` her zaman `blocked_structural` raporlanır, gizlenmez. 7 aşamalı aktivasyon sırasını (env/root → service config → start → service-context DB probe → per-case freshness smoke → File Agent file-operation smoke → verify/rollback) yalnız PLAN olarak üretir; Stage 2 (gerçek `hasarbotu-file-agent` servisi API olmadan başlatılırsa sürekli `api_unavailable` döngüsüne girer — bunun yerine tek-seferlik, kendi kendini temizleyen bir "disposable probe vehicle" mi yoksa File Agent'ın kendi giriş noktasına opt-in bir self-test modu mu ekleneceği) ve Stage 5 (freshness gate yeniden tasarımı) açık, çözülmemiş mimari kararlar olarak işaretlenir, tek taraflı çözülmez. Administrators-only+hash'li kanıt raporu üretir. |
| `preview-file-agent-controlled-activation.tests.ps1` | Bağımlılıksız test script'i (5 test): sentetik negatif yol (her şey eksik → tüm yol-bağımlı önkoşullar `blocked_structural`, sıfır mutasyon); sentetik pozitif fixture (doğru 3-ACE depolama kökü + `NT AUTHORITY\LOCAL SERVICE`/`NETWORK SERVICE` hedef/sync kimlikleriyle gerçek DB preview → `verified_ok`); aktivasyon sırası yapısı (tam 7 aşama, doğru sıra/isim, freshness-gate aşamasının dürüstçe `blocked_structural` raporlandığı); tam çalıştırma boyunca sıfır mutasyon (gerçek `HASARBOTU_*` env değişkenleri ve gerçek `hasarbotu-file-agent` servis durumu değişmez); kanıt raporunun Administrators-only+hash-doğrulamalı olduğu. Gerçek `svc-hb-fileagent`e veya gerçek pCloud verisine asla dokunmaz. |
| `pcloud-source-attestation.mjs` (+ `.test.mjs`, 8 test) | Kaynak SHA-256 attestation kütüphanesi (HB-2026-167, Karar 1). Gerçek kaynak dosya baytlarından SHA-256 hesaplar, TEK bir tutarlı DB snapshot'ıyla (fileId, pCloudHash, DB-kayıtlı boyut) çözer, kaynak/DB boyut yarışını fail-closed yakalar. pCloud'un `file.hash` kolonunun düz bir SQLite `INTEGER` (64 bit tavan) olduğu — 256 bit gerektiren SHA-256'yı yapısal olarak barındıramayacağı — gerçek bir sorguyla kanıtlanıp modülün kendi başlık yorumunda belgelendi. Her attestation kaydı (FileId,PCloudHash)'ten deterministik türetilen ayrı bir dosya, SHA-256 sidecar ile tamper-evident. `enumerateFilesRecursive` bu modülden `pcloud-session0-freshness-gate.mjs` tarafından da paylaşılır. |
| `generate-pcloud-source-attestation.ps1` (+ `.mjs`) | ADMIN/etkileşimli-bağlam attestation üretici (P:\ erişimi GEREKTİRİR, `run-pcloud-case-reconciliation.ps1` ile aynı). Yalnız kendi attestation deposuna (Administrators-only oluşturulur) ve admin-only kanıt raporuna yazar — pCloud/kaynak/hedefe hiçbir yazma. Gerçek makinede sentetik fixture'la uçtan uca doğrulandı. |
| `pcloud-session0-freshness-gate.mjs` (+ `.test.mjs`, 6 test) | **Session-0-safe** per-case freshness gate (HB-2026-167, Karar 1) — `pcloud-case-reconciliation.mjs`'in yerini, gerçek bir Windows servisi içinden çağrılabilmesi gereken durumlar için alır. Girdiler: pCloud yerel DB (yalnız isim çözümleme + canlı task sayısı), hedef ağaç (gerçek yerel disk), attestation deposu — **P:\'ye sıfır bağımlılık**. `ready` yalnız attestation VARSA ve Sha256'sı taze hesaplanan hedef SHA-256'yla eşleşirse; yoksa canlı task'a göre `syncing`/`unknown`; uyuşmazlıkta veya conflict-name deseninde `conflict` (fail-closed). pCloud DB'nin hâlâ listelediği ama hedefte eksik bir dosyayı sessizce atlamayan (gerçek bir boşluk, test yazmadan önce bulunup düzeltilen) DB-yalnız recursive CTE içerir. CaseStatus her zaman en kötü dosya durumunu alır. |
| `run-pcloud-session0-freshness-gate.ps1` | Session-0-safe gate CLI sarmalayıcısı. `run-pcloud-case-reconciliation.ps1` ile AYNI çıkış kodu sözleşmesi (0=ready/2=not-ready/1=error) ama hiçbir `-SourceRoot` parametresi/varsayılanı yok — yapısal olarak P:\'ye çözülebilecek hiçbir şey yok. Admin-only kanıt raporu üretir. |
| `file-agent-disposable-probe-inner.ps1` | Disposable probe service'in GERÇEK yükü (HB-2026-167, Karar 2) — henüz çalıştırılmadı, yalnız sentetik fixture'la doğrulandı. **Bilerek Administrator gerektirmez** (svc-hb-fileagent düşük yetkili bir hesaptır). Gerçek DB okuma probu; gerçek yazma-reddi probu (`UnauthorizedAccessException` beklenir, simüle edilmez); `pcloud-session0-freshness-gate.mjs`'yi Administrator-gated `.ps1` sarmalayıcısı ÜZERİNDEN değil doğrudan (node) çağırır — gerçek, admin-olmayan bir File Agent çağrısını birebir taklit eder. |
| `preview-file-agent-disposable-probe-service.ps1` (+ `.tests.ps1`, 6 test) | Disposable probe service PLAN + PREVIEW (HB-2026-167, Karar 2) — `-Apply` yapısal olarak yok. 6 önkoşulu doğrular; planlanan WinSW XML'i (bir STRING, hiçbir yere kurulabilir dosya olarak yazılmaz) üretir: `Manual` başlangıç (asla Automatic), restart-on-failure yok, `<password>` elemanı hiçbir zaman yok. **Gerçek, yeni bulunan bir engel dürüstçe raporlanır:** aynı hesapla ikinci bir servis kaydı `sc.exe config`in hesabın SAM'deki gerçek parolasını gerektirdiği (HB-2026-118 bu parolayı hiç saklamadığı için) — `second_service_logon_credential: blocked_structural`. Sonuç dizini ACL'i de `deferred_to_real_activation` — yeni, dar bir svc-hb-fileagent yazma izni, henüz uygulanmadı. Gerçek makinede çalıştırıldı: 4/6 `verified_ok`, 1/6 `deferred_to_real_activation`, 1/6 `blocked_structural`. |
| `apply-file-agent-service-vehicle-probe.ps1` (+ `.tests.ps1`, 4 test) | HB-2026-167'nin "ikinci servis parola" engelini çözer (HB-2026-168) — **yeni servis kaydetmez**; mevcut Disabled/Stopped `hasarbotu-file-agent` kaydını GEÇİCİ, TAM GERİ ALINABİLİR probe vehicle olarak yeniden amaçlandırır (SCM'nin zaten sakladığı, HB-2026-118'den beri hiç değişmeyen oturum-açma kimlik bilgisini yeniden kullanır — parola sıfırlama yok, yeni hak yok). Çalışan (Running) bir servise asla dokunmaz. Admin-only+hash'li snapshot (WinSW XML ham baytları + registry'den SCM ImagePath/StartMode/StartName/DependOnService) İLK mutasyondan önce alınır. Geçici mutasyon: XML'de `<executable>`/`<arguments>` probe'a yönlendirilir, `<depend>` (örn. kurulu olmayan `hasarbotu-api`) geçici silinir, `start= demand`, `sc.exe start`. Sonra HER DURUMDA (finally): stop → XML'i TAM eski baytlarına geri yaz → `start= disabled` → dependency geri yüklenir → yeniden snapshot alınıp alan-alan karşılaştırılır — herhangi bir fark yüksek sesle raporlanır. Ayrı, bağımsız bir `-Rollback` modu da var (manuel kurtarma). **Gerçek sentetik WinSW test servisiyle uçtan uca kanıtlandı** (`NT AUTHORITY\LOCAL SERVICE`) VE **gerçek `hasarbotu-file-agent` üzerinde 5 kez Apply edildi (HB-2026-172, kullanıcı onayıyla)** — ilk 2 gerçek çalıştırmada 2 gerçek hata bulundu ve düzeltildi (`Start-Service` cmdlet'inin kendi Running-bekleme toleransı kısa ömürlü gerçek bir probe için yetersizdi → `sc.exe start`'a geçildi; `depend=''` bağımlılığı güvenilir temizlemiyordu → `depend='/'`'e geçildi, sentetik testin fixture'ı da bu sınıf hatayı bir daha maskeleyemeyecek şekilde sertleştirildi), her ikisinde de geri-yükleme YİNE DE tam ve bağımsızca doğrulandı. Sonraki 3 çalıştırmanın hepsinde `RestoredExactly=true` (5/5 ardışık), gerçek kimlik (`<makine>\svc-hb-fileagent`) doğrulandı, DB yazma-red kanıtlandı; HB-2026-173'ün attestation deposu ACL Apply'inden SONRAKİ son çalıştırmada `CaseStatus=ready` ile uçtan uca zincir KANITLANDI. Probe'un kendi tanısal (üretim kodu DIŞI) ham byte-okuma alt-kontrolü 5/5 gerçek çalıştırmada aynı paylaşım-ihlaliyle (ACL değil) başarısız oldu — üretim mekanizmasını (kopyala+yeniden-dene) yansıtmayan, dar kapsamlı, ayrı bir bulgu olarak kayda geçirildi. **Gerçek `hasarbotu-file-agent` her çalıştırma sonrası bağımsızca Disabled/Stopped + XML hash eşleşmesiyle doğrulandı.** |
| `preview-file-agent-attestation-store-access.ps1` (+ `.tests.ps1`, 4 test) | Attestation deposu (`C:\ProgramData\HasarBotu\pcloud-attestations`) için minimum Read/Traverse/Synchronize ACL PLAN + PREVIEW (HB-2026-169 Öncelik 4) — HB-2026-163'ün aynı SID-simülasyon modeli. `-Apply` yapısal olarak yok. Gerçek makinede çalıştırıldı: `C:` zaten yeterli (HB-2026-165), `C:\ProgramData`/`C:\ProgramData\HasarBotu` yeni Traverse gerektiriyor (`BUILTIN\Users`'ın mirası yardımcı olmuyor — svc-hb-fileagent HB-2026-113'te o gruptan bilerek çıkarılmıştı). 4 ACE toplam. **Apply edildi — bkz. `apply-file-agent-attestation-store-access.ps1` (HB-2026-173).** |
| `apply-file-agent-attestation-store-access.ps1` (+ `.tests.ps1`, 6 test) | `apply-file-agent-pcloud-db-access.ps1` (HB-2026-164) ile AYNI 7 katmanlı model — hash-doğrulanmış preview raporu okuma, `Traverse\|Read\|Synchronize` dışı her bit reddi, preview'i taze yeniden çalıştırıp sapma kontrolü, her düğümün canlı ACL'inin preview'daki taban ile SDDL-eşitliği, apply SADECE ekler, hata → tersten otomatik geri-yükleme, apply SONRASI gerçek bir "gelecek dosya" mirasılık kanıtı (depoya atılabilir bir dosya yaratılıp Read ACE'in miras alındığı doğrulanıp silinir) + SID-simülasyon Read=evet/Write=hayır (depo klasörünün kendisi ZORUNLU, depoda o an mevcut TÜM attestation dosyaları için de) + geri-yükleme paketinin hash-doğrulanmış yeniden-okumayla doğrulanması. Depo klasörü henüz yoksa Apply, Administrators-only olarak önce onu yaratır. Sentetik test (`NT AUTHORITY\LOCAL SERVICE`, 6 test — ilk-çalıştırma tam Apply+rollback, dry-run sıfır mutasyon, kurcalanmış ACE reddi, ACL sapması reddi, kimlik uyuşmazlığı reddi, ÖNCEDEN VAR olan depo + 2 mevcut dosyanın ikisinin de Read=evet/Write=hayır göstermesi) ilk denemede 0 hata ile geçti. **Gerçek `C:\ProgramData\HasarBotu\pcloud-attestations` üzerinde Apply edildi (HB-2026-173, kullanıcı onayıyla):** 4 ACE, sıfır blocker, gelecek-dosya mirasılığı kanıtlandı, depodaki 80 mevcut attestation dosyasının HEPSİ ayrı ayrı Read=evet/Write=hayır ile doğrulandı, geri-yükleme paketi hash-doğrulandı. `Get-Acl` ile bağımsız olarak da doğrulandı: atalarda sadece Traverse, depo klasöründe Traverse+Read/Synchronize — yazma/silme/sahiplik biti hiçbir düğümde yok. |
| `pcloud-source-attestation.mjs` — POST kimlik-fence eklentisi (HB-2026-169 Öncelik 5) | SHA-256 hesaplandıktan HEMEN SONRA fileId/pCloudHash/boyut TAZE, ayrı bir DB snapshot'ıyla yeniden çözülüp PRE değeriyle karşılaştırılır; kaynak dosya da taze yeniden stat edilir — herhangi bir fark (`IDENTITY_FENCE_*`) tüm işlemi fail-closed durdurur, uydurulmuş bir kimlikle attest etmez. Test-yalnız, opt-in-only `HASARBOTU_TEST_IDENTITY_FENCE_SYNC_MARKER` ile (repair-post-sync-stale-target-files.ps1'in aynı deseni) gerçek zamanlamayla, varsayıma dayanmadan test edildi: hem POST revizyon-değişimi hem POST kaynak-boyut-değişimi doğru reddedildi (11 test, 3 yeni). |
| `test-storage-sync-migration-preflight.ps1` | D7/D8 için tamamen salt-okunur envanter/kapasite/tam SHA-256 kapısıdır. Hashli ve Administrators-only exact ghost exclusion manifesti olmadan taramaya başlamaz. D8 başlangıcı yalnız admin-only bakım raporlu `D8BeforeSync` stage'idir; raporu tam hash öncesi/sonrası güncel doğrular. `AfterSync` yalnız bu stage'in hashli PASS raporunu kabul edip kaynak tam manifestinin senkron öncesi baseline ile değişmediğini doğrular. Wildcard, uzantı veya klasör kuralı kabul etmez. Yol veya dosya adı sızdırmadan JSON özet ve fail-closed çıkış kodu üretir. |
| `validate-storage-ghost-exclusion.mjs` | Exclusion manifestindeki tam 10 path/fileId kaydını strict şema ile doğrular ve her fileId+metadata bağını yerel pCloud DB'de `mode=ro&immutable=1` ile yeniden kontrol eder. Yalnız güvenli sayaç/kod çıktısı verir. |
| `invoke-storage-source-io-diagnostic.ps1` | D7 kaynak `IO_ERROR` kayıtlarını salt-okunur sınıflandırır. İlk hata ve üç kontrollü yeniden okumayı, offline/reparse, paylaşım kilidi ve yol uzunluğu bulgularıyla birlikte yalnız Administrators erişimli `C:\ProgramData\HasarBotu\migration-preflight` raporuna yazar; konsola dosya/yol adı vermez. |
| `test-pcloud-maintenance-window-gate.ps1` | D8 öncesi fail-closed uzak-yazar izolasyon kapısıdır. pCloud DB+WAL diff cursor/uzak envanterini ve kaynak envanterini birlikte izler; üretimde 600 saniyenin altına inemez. Create/modify/delete, yalnız cursor ilerlemesi veya kaynak hareketi sayacı sıfırlar. Başlangıç/son tam SHA-256 eşitliği olmadan D8 izni üretmez; sonucu admin-only rapor+sidecar olarak yazar. `-ProbeOnly` yazmasız uyumluluk kontrolüdür ve daima `BLOCKED/2` verir. |
| `pcloud-maintenance-window-gate.mjs` | Yukarıdaki kapının dependency'siz Node çekirdeğidir. Kilitli canlı SQLite'ı doğrudan açmak yerine kaynak DB+WAL'i yalnız OS temp alanına tutarlı snapshot alıp `quick_check` ile doğrular; temp snapshot her örnekten sonra silinir. Müşteri yolu/adı çıktısı üretmez. |
| `pcloud-maintenance-window-gate.test.mjs` | Sanal saat ve sentetik pCloud/source envanteriyle 600 saniye alt sınırı, cursor-only hareketi, create/modify/delete sayımı, timer reseti, başlangıç/son hash eşitliği, WAL snapshot ve kısa-süre bypass reddini test eder. |
| `pcloud-database-quiescence.ps1` | `D8BeforeSync`'in tam kaynak hash geçişinin hemen ardından, DB snapshot kontrolüne geçmeden önce pCloud yerel `data.db`/`-wal`/`-shm` için sınırlı (bounded) bir sakinlik bariyeri sağlar: 5 saniye aralıkla varlık+boyut+`LastWriteTimeUtc` örnekler, en az 3 ardışık aynı örnek olmadan geçit vermez, her değişimde ardışık sayacı sıfırlar, en fazla 180 saniye sonra `timeout` döner. Yan etkili üst seviye kod içermez; yalnız fonksiyon tanımları — hem `test-storage-sync-migration-preflight.ps1` hem de kendi test dosyası tarafından `dot-source` edilir. `withConsistentPcloudDatabase`'in (Node çekirdeği) kendi doğrulamasını ve 15 dakikalık tazelik kuralını değiştirmez; tamamen ayrı, ek bir katmandır. |
| `pcloud-database-quiescence.tests.ps1` | Yukarıdaki bariyer için bağımlılıksız test script'i (Pester gerektirmez). Enjekte edilebilir örnekleyici/uyku/saat sayesinde PASS/reset/timeout durum makinesini gerçek zaman beklemeden deterministik test eder; ayrıca Türkçe karakterli (`ı`/`İ`) manifest yollarının yalnız UTF-8 `File.ReadAllText` ile doğru okunduğunu ve `Get-Content` varsayılanının (sistem kod sayfası) bunu bozduğunu regresyon testiyle sabitler. |
| `test-pcloud-post-sync-rebaseline-gate.ps1` | D8 **post-sync** rebaseline kapısıdır (HB-2026-129). `test-pcloud-maintenance-window-gate.ps1`'in aksine, çalışması için aktif bir Add Sync eşlemesi **zorunludur** — eşlemeyi durdurmayı veya kaldırmayı asla gerektirmez ve hiçbir modda pCloud ayarı/eşleme/env/servise dokunmaz. Tam olarak bir `syncfolder` kaydının beklenen uzak kök+hedef yerel yolla eşleştiğini, sıfır bekleyen/delayed kuyruk (task/fstask/upload_tasks/localfileupload/uptask_fileupload/pagecachetask/`localfolder.taskcnt`) ve sıfır conflict-adı deseni olduğunu doğrular; ardından kaynak+hedef+uzak envanterde en az 600 saniye eşzamanlı sessizlik ve nihai tam kaynak==hedef SHA-256 eşitliği olmadan PASS üretmez. `-ProbeOnly` yazmasız uyumluluk kontrolüdür ve daima `BLOCKED/2` verir. |
| `pcloud-post-sync-rebaseline-gate.mjs` | Yukarıdaki kapının Node çekirdeğidir. `pcloud-maintenance-window-gate.mjs`'den kök çözümleme, WAL-dahil tutarlı DB snapshot, kaynak ağacı tarama/hash ve create/modify/delete fark sayımını **aynen** import edip yeniden kullanır — pre-sync gate'in kendisi hiç değiştirilmedi. Sessizlik takibi kaynak+hedef+uzak olmak üzere üç eksenlidir. |
| `pcloud-post-sync-rebaseline-gate.test.mjs` | Kök çözümleme, eksik/yanlış sync kaydı, bekleyen task, delayed öge, conflict-adı deseni, 600 saniye alt sınırı ve `ProbeOnly` red kodlarını sentetik SQLite ve dosya ağacıyla test eder. |
| `pcloud-stale-target-file-state.mjs` | Salt-okunur: tek bir göreli yol için pCloud'un **taze** current `file` satırını, tam `filerevision` geçmişini ve `task`/`fstask` referans sayısını döner. Hiçbir yazma yapmaz; `repair-post-sync-stale-target-files.ps1`'in her dosya öncesi tekrar doğrulaması için kullanılır. |
| `pcloud-stale-target-file-state.test.mjs` | Bilinen dosya için current row/revision/task referansı, task referansı varken >0 dönüşü ve olmayan dosya/klasör için `found=false`'ı sentetik SQLite ile test eder. |
| `repair-post-sync-stale-target-files.ps1` | **Bu depodaki tek gerçek yazma yolu olan araç** (HB-2026-130; HB-2026-149'da genelleştirildi; HB-2026-162'de 3. şema + identity fence eklendi). ÜÇ forensics şemasını destekler: eski `hasarbotu-56aag629-hasar-version-forensics/1.0.0` (`source_current_valid` sınıflı dosyalar, DEĞİŞMEDİ), genel `pcloud-post-sync-diff-forensics/1.0.0` (`Get-CandidateEntriesDiffForensics`, DEĞİŞMEDİ) ve `hasarbotu-pcloud-case-reconciliation/1.0.0` (`Get-CandidateEntriesCaseReconciliation`, yeni — yalnız `PatternClassification=='stale_target'` adaydır) — hangi şema verilirse ona göre fail-closed dallanır, başka bir şema reddedilir. Adapter'lar, `content_mismatch`+ilgili currency/pattern kanıtı+pCloud `CurrentRow`(kaynakla eşleşen)+`Revisions`de AYRI bir superseded kayıt(hedefle eşleşen, farklı hash)+`TaskReferenceCount=0` kanıtlanmadan hiçbir dosyayı aday yapmaz; `extra` (yalnız hedef, rename_artifact-eşli olanlar dahil) HER ZAMAN blocker (asla silinmez/değiştirilmez), `metadata_only` kapsam dışı, tanınmayan/eksik kanıt fail-closed blocker. Aday olan her dosya için taze yeniden doğrulama zorunludur: kaynak/hedef SHA-256 hâlâ rapor anındakiyle aynı, pCloud'da bu dosya için sıfır task/fstask referansı, pCloud'un current satırı (boyut+mtime) kaynakla eşleşiyor, `Revisions`de AYRI bir kayıt hedefin boyutuyla eşleşiyor (index sırasına GÜVENMEZ), hedef kilitli değil, kaynak bütünlüğü sağlam (uzantıya göre dağıtılır: `.jpg`/`.jpeg` SOI/EOI — değişmedi, `.png` imza kontrolü — yeni, diğerleri asgari sıfır-olmayan-uzunluk kontrolü — yeni). Yalnız hepsi geçerse `-Apply`: hedefi Administrators-only+hash'li yedekle, kaynağı hedefin dizininde stage edip hash/bütünlük doğrula, atomik replace ÖNCESİ pCloud'un canlı kimliğini (fileId/hash/size) İKİNCİ KEZ prob'layıp ilk problamayla karşılaştırır (HB-2026-162 identity fence) — kaynak arada değiştiyse yalnız o dosyayı, sınırlı sayıda (`-MaxIdentityRetries`, varsayılan 1) tazeden deneyerek yeniden dener; başarılıysa `[System.IO.File]::Replace` ile atomik değiştirir, sonra kaynak=hedef SHA-256'sını yeniden doğrular. Bir dosyanın engellenmesi (veya identity-fence tükenmesi) diğerlerini durdurmaz. pCloud ayarı, sync eşlemesi, env ve servis asla değişmez. |
| `pcloud-post-sync-diff-forensics.mjs` | Salt-okunur (HB-2026-131): `pcloud-post-sync-rebaseline-gate.mjs`'in yalnız toplu manifest hash uyuşmazlığı verdiği `SOURCE_TARGET_HASH_MISMATCH_AT_PASS` sonucunu dosya bazında izole eder. Kaynağı (ghost hariç) ve hedefi (hariçsiz) tek tek SHA-256 ile hash'ler, göreli yola göre `missing`/`extra`/`content_mismatch`/`metadata_only` sınıflandırır; her farklı dosya için pCloud'un current `file` satırını, tam `filerevision` geçmişini, `task`/`fstask` referans sayısını ve açık-handle olasılığını (salt-okunur `FileShare.Read` probu) ekler. Hiçbir dosya/DB yazma çağrısı içermez. |
| `pcloud-post-sync-diff-forensics.test.mjs` | Karışık (identical/missing/extra/content_mismatch/metadata_only) sentetik ağaç ve pCloud DB fixture'ıyla sınıflandırma, "hangi taraf güncel" mantığı, task referansı ve CLI çıkış kodlarını test eder. |
| `run-pcloud-post-sync-diff-forensics.ps1` | Yukarıdaki aracın Administrators-only sarmalayıcısıdır. Admin rolü ve hash'li/ACL'li ghost exclusion manifesti zorunlu kılar; tam sonucu (mutlak yollar dahil) yalnız `C:\ProgramData\HasarBotu\migration-preflight` altına hash'li rapor olarak yazar. Konsola yalnız göreli yol + sınıflandırma + sayaç özetini basar, mutlak yol asla yazdırmaz. |
| `pcloud-case-reconciliation.mjs` | Salt-okunur (HB-2026-162, `docs/D9_PER_CASE_RECONCILIATION_ARCHITECTURE.md`): global 600 sn bütün-ağaç sessizlik kapısını, TEK bir vaka klasörüne dar bir canlı pCloud kimlik denetimiyle değiştiren per-case reconciliation motoru. `buildDiffForensicsReport`'u `caseRelativePath` ile çağırır (yalnız o vaka taranır/hash'lenir, conflict-name taraması da o vaka köküne indirgenir), sonra her farkı `PatternClassification` (`stale_target`/`rename_artifact`/`unknown`) ve vakayı `CaseStatus` (`ready`/`syncing`/`conflict`/`unknown`) olarak sınıflandırır. `metadata_only` tamamen yok sayılır. `syncing` yalnız TÜM etkilenen dosyalarda canlı pCloud task kanıtı varsa ve hiç conflict-name yoksa verilir (fail-closed — tek takılı dosya tüm vakayı `conflict`'e düşürür). Hiçbir silme/yazma yeteneği yoktur; `extra`/`unknown` yalnız sınıflandırılır, asla otomatik işlem görmez. |
| `pcloud-case-reconciliation.test.mjs` | 10 test: fark yok → ready; 0-byte ve klasik stale_target; syncing (tüm dosyalar canlı task); karışık syncing+stuck → fail-closed conflict; aynı vaka içi SHA-256 eşleşmesiyle rename_artifact; eşleşmeyen extra → unknown (dokunulmadığı doğrulanır); metadata_only'nin tamamen yok sayılması; vaka klasörü tek/iki tarafta eksik (+ PowerShell wrapper StrictMode regresyon kontrolü — eksik JSON alanı gerçek veriyle bulunan bir hatanın regresyon testi); CLI çıkış kodu. |
| `run-pcloud-case-reconciliation.ps1` | Yukarıdaki aracın Administrators-only sarmalayıcısıdır; File Agent'ın (henüz bağlanmamış, bkz. mimari belgesi §8) kritik işlem öncesi çağıracağı CLI sözleşmesi (çıkış kodu 0=ready, 2=ready-değil, 1=hata). `-CaseRelativePath` zorunlu (tek vaka ile sınırlı, INV-3). Admin rolü ve hash'li/ACL'li ghost exclusion manifesti zorunlu kılar; tam sonucu yalnız admin-only rapora yazar, konsola yalnız göreli yol + sınıflandırma + `CaseStatus` özetini basar. Konsol/rapor çıktısı boyunca `[Console]::OutputEncoding` UTF-8'e sabitlenir (script ömrü boyunca, yalnız node çağrısı etrafında değil) — gerçek verilerle test edilirken bulunan bir Türkçe karakter bozulması regresyonunun düzeltmesi. |
| `pcloud-task-queue-forensics.mjs` | Salt-okunur: `PCLOUD_PENDING_TASKS_FOUND` teşhisi (HB-2026-134 devamı). Belirlenen bir pencere boyunca (varsayılan 15 dk) pCloud'un `task`/`fstask`/`upload_tasks` kuyruk tablolarından tekrar tekrar tutarlı salt-okunur anlık görüntü alır, her satırın kimliğini (tablo+id) örnekler arasında izler, itemid/fileid/folderid'i bilinen ghost kök altında göreli yola çözer, ve `genuine_transfer`/`recurring_retry`/`metadata_churn`/`remote_writer`/`unknown` olarak sınıflandırır. pCloud'un dokümante edilmemiş `type`/`status` kodlarının anlamını UYDURMAZ — yalnız gözlemlenebilir sinyallerden (aynı kaydın kalıcılığı, `upload_tasks.error_code`, uzak/yerel ağaç değişimi) çıkarım yapar. Gate/PostSyncRebaseline/AfterSync'i asla çalıştırmaz, hiçbir yazma yapmaz. |
| `pcloud-task-queue-forensics.test.mjs` | Yol çözümleme, her 5 sınıflandırma kategorisi ve karışık task/fstask/upload_tasks fixture'ıyla uçtan uca yakalamayı test eder. |
| `run-pcloud-task-queue-forensics.ps1` | Yukarıdaki aracın Administrators-only sarmalayıcısıdır. Tam sonucu (çözülen yollar + pCloud'un ham text1/text2/fname/fpath alanları dahil) yalnız admin-only rapora yazar; konsola yalnız göreli yol + ham type/status kodu + sınıflandırma basar, pCloud'un literal metin alanlarını asla yazdırmaz. |
| `repair-post-sync-stale-target-files.tests.ps1` | Bağımlılıksız test script'i (16 test). Legacy şema: preview'ın sıfır yazması, `-Apply`'ın yedek+atomik-replace+doğrulamayı doğru yapması, task-referansı/kaynak-değişimi/"hedef artık eski değil" bloklarının dokunmadan reddetmesi, PowerShell 5.1 dizi-sarma tuhaflığı (`{value:[...],Count:N}`) regresyonu. Genel şema (HB-2026-149): tek raporda 7 farklı sonuç — önizlemede TAM doğru sayılar, `-Apply`de yalnız GERÇEK adayın değişmesi; bilinmeyen şema sürümünün reddi; legacy şemanın adapter eklendikten sonra da değişmediği; pCloud'un eşit-`ctime`li `filerevision` kayıtlarını current-önce sırayla döndürdüğü GERÇEK üretim durumunun yeniden üretimi. Yeni (HB-2026-162): case-reconciliation şeması (JPEG/PNG/PDF karışık aday + rename_artifact/unknown blocker'ları + bozuk-PNG reddi), identity-fence "başarılı yeniden deneme" ve "tükenmiş yeniden deneme → yalnız o dosya bloke, diğerleri etkilenmez" — deterministik test-opt-in senkron noktasıyla (`HASARBOTU_TEST_IDENTITY_FENCE_SYNC_MARKER`, üretimde no-op) zamanlama-bağımsız kanıtlanır. |
| `cleanup-post-sync-target-only-files.ps1` | **Bu depodaki ikinci gerçek yazma yolu olan araç — bu sefer SİLME** (D9 B10, HB-2026-157). `pcloud-post-sync-diff-forensics/1.0.0` raporundaki yalnız `extra` (`target_only_no_source_counterpart`) sınıflı kayıtları işler; `content_mismatch`/`metadata_only`/başka her şey bu aracın hiç konusu değildir, dokunulmaz ve raporlanmaz. Her aday için taze yeniden doğrulama zorunludur: hedef SHA-256 hâlâ rapor anındakiyle aynı, kaynak HÂLÂ o yolda yok, pCloud'un canlı ağacında HÂLÂ o yolda hiçbir nesne yok (`found:false` yeniden doğrulanır — canlı nesne varsa `PCLOUD_OBJECT_NOW_FOUND` ile geri çekilir), hedef kilitli değil. Yalnız hepsi geçerse `-Apply`: hedefin GEÇERLİ içeriğini sync kökünün (`C:\HasarBotuStorage\...`) TAMAMEN DIŞINDA bir dizine (varsayılan `C:\ProgramData\HasarBotu\migration-preflight\pre-delete-backups\...`) Administrators-only+hash'li yedekler (yedek dizini sync kökü içindeyse `BACKUP_DIRECTORY_INSIDE_SYNC_ROOT` ile fail-closed reddeder), sonra `[System.IO.File]::Delete` ile siler, sonra dosyanın gerçekten yok olduğunu bağımsız doğrular. Bir dosyanın engellenmesi diğerlerini durdurmaz. pCloud ayarı, sync eşlemesi, kaynak içerik, env ve servis asla değişmez. |
| `cleanup-post-sync-target-only-files.tests.ps1` | Bağımlılıksız test script'i (8 test): preview'ın sıfır yazması VE `extra` olmayan kayıtları tamamen yok sayması; `-Apply`'ın yalnız kanıtlanmış orphan'ı silip yedeklemesi; pCloud'un canlı nesne bulduğu (`PCLOUD_OBJECT_NOW_FOUND`), kaynağın yeniden ortaya çıktığı (`SOURCE_NOW_EXISTS`) ve hedefin forensics anından beri değiştiği (`TARGET_CHANGED_SINCE_FORENSICS`) durumlarda dokunmadan reddetmesi; yedek dizininin sync kökü içinde verilmesinin fail-closed reddi; ikinci `-Apply` çalıştırmasının (dosya zaten silinmiş) hiçbir hata vermeden sıfır silme yapması. |
| `register-file-agent-interactive.ps1` | D9 Adım 6b — File Agent kaydı (HB-2026-176). Servis KURMAZ/BAŞLATMAZ; yalnız gerçek API'de bir agent kaydı oluşturur ve `HASARBOTU_AGENT_ID`/`HASARBOTU_AGENT_SECRET`'i belirtilen ortam değişkeni kapsamına (varsayılan Machine) yazar. İki katmanlı orphan-önleme: (1) kayıttan ÖNCE hedef env kapsamında yazma/okuma/silme yetkisi fail-closed kanıtlanır (probe değişkeni) — başarısızsa kayıt hiç denenmez; (2) kayıttan SONRA env yazımı/doğrulaması başarısız olursa yazılan değişkenler temizlenir VE aynı admin oturumuyla `PATCH /api/v1/agents/:agentId {status:'disabled'}` çağrılır — `services/api/src/agent/auth.ts` (`agent.status !== 'active'` → 403) ve `services/api/test/agent-jobs.test.ts` (`'devre dışı agent 403 alır'`) bu yolun kaynak+test ile gerçekten etkili olduğunu doğrular. Disable çağrısı da başarısız olursa kritik blocker + gerçek agent ID raporlanır (secret asla). Aynı isimde zaten AKTİF bir agent varsa (GET `/api/v1/agents` ile önceden kontrol edilir) kayıt fail-closed reddedilir. Parola yalnız interaktif `Get-Credential`/`SecureString` ile alınır; `-Credential` parametresi yalnız otomatik test içindir (PSCredential nesnesi, düz metin argüman DEĞİL). `SecureStringToGlobalAllocUnicode`'la ayrılan unmanaged bellek `finally` içinde kesin olarak `ZeroFreeGlobalAllocUnicode` ile serbest bırakılır. Secret hiçbir stdout/log/argv/audit kaydında görünmez. Başarı çıktısı yalnız `AgentId` + `CredentialsConfigured:true` — Administrators-only+hash'li kanıt raporu `C:\ProgramData\HasarBotu\migration-preflight\`'a yazılır. |
| `register-file-agent-interactive.contract.test.mjs` | 11 test. **Gerçek API sözleşme testleri**: `@hasarbotu/contracts`'ın GERÇEK zod şemalarını (`loginRequestSchema`/`agentRegisterRequestSchema`/`agentUpdateRequestSchema`/ilgili response şemaları) ve route sabitlerini (`AUTH_LOGIN_ROUTE`/`AGENTS_ROUTE`/`AGENT_DETAIL_ROUTE`) hem statik olarak (ps1'deki sabit route string'leriyle birebir) hem de dinamik olarak (her istek/yanıtı `.parse()` ile doğrulayan minimal bir http mock sunucusu üzerinden — şemalardan biri driftlerse test derhal kırılır) doğrular; bu makinede `TEST_DATABASE_URL` provizyonlanmadığı için gerçek DB-destekli Fastify app'i çalıştıramadığından seçilen, dürüstçe belgelenmiş bir tasarım kararıdır. **Sentetik rollback regresyon testleri**: `-ForcePreflightFailureForTesting`/`-ForceEnvWriteFailureForTesting` (yalnız test amaçlı, gerçek kullanımda asla verilmez) ile kısmi-yazım (ID başarılı/secret başarısız) senaryosu gerçekçi şekilde tetiklenir; ID'nin gerçekten temizlendiği, agent'ın mock sunucuda gerçekten `disabled` olduğu, disable çağrısı da başarısız olursa gerçek agent ID'nin kritik blocker olarak raporlandığı bağımsızca doğrulanır. ÖNEMLİ mimari not: mock http sunucusu ile PowerShell alt-sürecini çağıran kod AYNI Node sürecinde/event loop'unda çalıştığından `spawnSync` KULLANILMAZ (event loop'u tamamen bloke edip mock sunucunun hiçbir isteği kabul edemediği bir kendi-kendine kilitlenmeye yol açar — ilk taslakta gerçekten bulunup düzeltildi); bunun yerine async `spawn()` kullanılır. Testler `-EnvScope Process` ile çalışır — gerçek Machine env'e asla dokunmaz. |

## Bakım aracı dosya yolu güvenliği

`repair-post-sync-stale-target-files.ps1` ve `cleanup-post-sync-target-only-files.ps1`, aynı dizindeki `storage-path-safety.psm1` modülünü gerektirir. Dağıtımda bu modülü de kopyalayın. Denetim, Windows kısa/uzun yol adlarını normalleştirir; kök dışına taşan, komşu dizin ön ekiyle eşleşen veya junction/reparse-point içeren adayları reddeder. Yedek dizini hem kaynak hem hedef ağacının dışında olmalıdır.

`storage-path-safety.tests.ps1` bu sınırları gerçek junction fixture ile test eder ve `npm run check:deploy` tarafından çalıştırılır. WinSW test ikilisi varsayılan konum dışındaysa yalnız test sürecinde `HASARBOTU_TEST_WINSW_PATH` ile yolunu belirtin. Servis-vehicle testi ayrı, geçici bir servis kurup kaldırır; aynı test servisi zaten varsa üzerine yazmaz.

## Bu repo'da OLMAYANLAR (bilinçli)

- **WinSW ikili dosyası commit edilmez.** Kaynak koddan derlenmiş bir
  yürütülebilir dosyayı sürüm kontrolüne eklemek AGENTS.md'nin genel
  hijyeniyle çelişir. Resmi ve imzalı ikili
  [github.com/winsw/winsw/releases](https://github.com/winsw/winsw/releases)
  adresinden indirilip yalnız KURULUM MAKİNESİNDE tutulur.
- **Secret/DATABASE_URL/mutlak `P:\` yolu.** Şablonlarda yalnız
  `NODE_ENV=production` gibi secret OLMAYAN ortam değişkenleri vardır.
  Gerçek değerler makine kapsamlı ortam değişkeni olarak RUNBOOK'ta
  ayrı ayarlanır — `services/api/src/config.ts`'in zaten uyguladığı
  "process ortamından oku, repo'ya/`.env`'e yazma" kuralıyla birebir
  tutarlıdır.
- **Kendiliğinden gerçek kurulum/geçiş.** Araçlar açık `-Apply` olmadan
  kurulum yapmaz; D7/D8 preflight aracı ise hiçbir modda yazma yapmaz. Bu
  makinedeki gerçek D6 sonucu ve D7 salt-okunur ölçümü runbook/karar
  günlüğünde ayrıca kayıtlıdır. pCloud ayarı, veri kopyalama,
  `HASARBOTU_AGENT_ROOTS` değişikliği ve servis başlatma bu araçların
  kendiliğinden yaptığı işlemler değildir.
- **Bakım kapısının Add Sync yetkisi yoktur.** Kapı yalnız ölçer ve kanıt
  üretir. pCloud UI ayarı, `Add Sync`, kaynak/hedef dosya, registry/env ve
  servis durumu üzerinde yazma yolu içermez. `D8BeforeSync PASS/0` olmadan
  runbook D8 başlangıcına izin vermez.

## Private storage configuration

Maintenance scripts no longer embed an organization or pCloud folder name. Set `HASARBOTU_AGENT_PCLOUD_TOP_LEVEL_FOLDER` to the existing source folder name, or supply an explicit `-TopLevelFolderName` where supported. Set `HASARBOTU_OFFICE_STORAGE_ROOT` or pass `-StorageRoot` for the existing local mirror. Missing required pCloud names fail closed; the readiness inspector emits a blocked diagnostic report when its storage root is unconfigured. These settings do not rename source folders, change root identifiers or migrate business records.

Office source refresh reads its protected sibling `configuration.json`: `expectedComputerName`, `runtimeRoot`, `organizationId`, `databaseName` and `sourceRoot` are required; `storageRootKey` selects a root when several exist, and optional `statusFile` preserves an operator status file. Credentials remain in the existing machine/service environment. The machine and local database checks remain mandatory; organization filters are parameterized. Deploy `office-source-refresh.cjs`, `office-source-refresh-config.cjs` and `run-office-source-refresh.ps1` together. Keep the current pCloud source and freshness checks; this is not a storage migration.

The hidden task launcher is built from `office-source-refresh-launcher.cs` using Windows' existing C# compiler. `set-office-source-refresh-launcher.ps1 -SourceRefreshDirectory <directory> -BackupDirectory <new-backup-directory>` previews both existing task actions; add `-Apply` to build and verify the GUI executable and migrate the tasks. It preserves task XML and the previous launcher, rolls back partial changes, and verifies source/binary hashes on repeated runs. VBScript is no longer required. `node --test deploy/windows-service/office-source-refresh-launcher.test.mjs` covers configuration, the actual runner, native process exit propagation and task migration/rollback.

Automatic folder discovery keeps polling after the known temporary `source_changed` and `source_unavailable` conditions, preserving their safe diagnostic codes. Unknown failures still stop the process; a changing pCloud snapshot remains blocked until a consistent snapshot is available.
