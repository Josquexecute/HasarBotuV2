# Ofis ana sunucusu için kullanım hazırlığı — 11.10.2026

> Bu tarihsel belgedeki kurum, hesap ve yol adları anonimleştirilmiştir. Gerçek bağlantı değerleri özel ofis yapılandırmasından alınır.

Ana sunucu **DESKTOP-EFN2G33** olacaktır. Geliştirme **51793-22893** üzerinde
devam eder. Ofis evrak kökü `C:\HasarBotuStorage\OFIS`.
İki bilgisayarda bağımsız üretim veritabanı kullanılmaz.

## Gerçek ofis kurulumu — güncel durum

13.10.2026 bildirim revizyonu iki bilgisayara **0.1.5** olarak kuruldu.
Güncel canlı durum: **399 dosya, 1.454 not, 74 görev, üç hesap**, 53 migration.
Bildirim sahipliği, şirket hesabı yönetici onayı, düzenlenebilir ofis kuralları/
yetkiler ve tarihli işlem kayıtları etkin. Kaynak istisnaları ve yeniden başlatma
kabulü halen açıktır. Kaynak taramasında engelli dosyalar 25'ten 17'ye düştü.
Son bildirim/kurulum/kaynak kanıtları:
[Bildirim merkezi ve kaynak engelleri — 13.10.2026](NOTIFICATION_CENTER_AND_BLOCKERS_2026-10-13.md).
Önceki API/yetki/yedek revizyonu:
[Gerçek kullanım düzenlemeleri — 13.10.2026](REAL_USE_REFINEMENTS_2026-10-13.md).
Aşağıdaki ayrıntılı kurulum maddeleri önceki 0.1.3 kabulünün tarihsel kaydıdır.

Ofiste canlı kurulum ve onaylanan veri birleştirmesi tamamlandı. Aşağıdaki
hazırlık geçmişindeki aday veritabanı sayıları canlı sistemin sayıları değildir.

- Ana API: `https://desktop-efn2g33.tail276cda.ts.net`; yalnız Tailscale ağı.
  Gerçek TLS doğrulaması, anonim erişimin 401 olması, oturumun iptali ve
  Secure/HttpOnly/SameSite=Strict çerezi doğrulandı. İnternete port açılmadı.
- Canlı veritabanı: **399 dosya, 1.452 not, 74 görev, üç aktif gerçek hesap**.
  Kullanıcının kesin hash onayıyla 219 yeni dosya, 922 not, bir tamamlanmış
  görev ve 205 tarihsel kapanış aktarıldı. Hatalı aktarım sıfır; tekrar planında
  oluşturulacak/güncellenecek iş sıfır. Önceden bulunan 180 dosya ve kayıtların
  değişmemesi gereken alanları snapshot hash'leriyle korundu.
- **399 dosyanın tamamının eksperi aynı gerçek hesap**. Kaynakla eşleşmeyen
  12 eski açık dosyanın eksper alanı, kullanıcının ortak eksper talimatıyla
  denetim kaydı oluşturan API üzerinden tamamlandı; kapalı dosya/tür değişmedi.
  Eşleşmiş 387 dosyanın sorumlu dağılımı 327 Ömer, 24 Enes ve 36 belirsiz.
  Eski 12 dosyanın sorumlusu da belirsiz: toplam **48** ayrı listelenir.
  Mevcut ofis yöneticisinin kimliği ve
  parolası korundu; iki yeni hesabın kullanıcı tarafından kaydedilen parola
  hash'leri taşındı. Kullanıcı, gerçek hesabıyla giriş yaptığını ve dosyaların
  göründüğünü ayrıca doğruladı: **kullanıcı giriş kabulü PASS**.
- Gerçek `svc-hb-fileagent` hesabı Session 0'da 387 klasörü doğruladı.
  **25.865 evrak** hash'lenerek takibe alındı. Servis yeniden başlatıldıktan
  sonraki kontrolde dosya/gözlem/bildirim sayısı değişmedi; tüm revizyonlar 1,
  otomatik evrak incelemesi ve başarısız iş sıfır.
- API ve File Agent `C:\ProgramData\HasarBotu\runtime-20261011` korumalı
  dizininden otomatik çalışır. Node 24.21.0, 51 migration ve gerçek dağıtımın
  bağımlılıkları doğrulandı. API PostgreSQL'e, File Agent API'ye bağımlıdır.
  Worker'ın kod/yapılandırma izinleri yalnız okuma/çalıştırmadır.
- Her iki bilgisayara **0.1.3** kuruldu. Kullanım başlangıcı masaüstündeki
  **`HasarBotu - Ofis.bat`**. Geliştirme ortamı korunur. Bu bilgisayarda gerçek
  kurulu uygulamanın UI varlıklarını sunması ve ofis HTTPS API'sine iletmesi
  doğrulandı; ofis bilgisayarındaki gerçek kurulu istemci de aynı kontrolden
  geçti. Kullanıcı giriş ve dosya listesini elle doğruladı; otomatik görsel
  UI kontrolü yapılmadı.
- `HasarBotu-Office-Daily-Backup` görevi SYSTEM hesabıyla her gün **03:00**
  çalışır; başlangıçtan önceki yedekler de korunur. İlk canlı kullanım yedeği
  ayrı `_test` veritabanına geri yüklendi: **123 tablonun bütün satır sayıları
  ve hash'leri birebir aynı**. Parolalar komut argümanına/rapora yazılmaz.
  Yedek yolu `C:\ProgramData\HasarBotu\backups\daily-20261011`;
  otomatik yedek silme uygulanmadı.
- Ofis masaüstünde **`HasarBotu - İnceleme Listeleri`**: 48 belirsiz sorumlu,
  12 kaynak eşleşmesi olmayan korunmuş eski dosya, dokuz sorunlu kaynak ve
  V1 kimlik kaydı olmayan 169 klasör ayrı metin/JSON listelerindedir.
  Kullanıcı kararıyla servis eşleştirmeleri atlandı.
- Gerçek P: kaynağından alınan bağımsız SHA-256 kanıtıyla örnek klasörün üç
  dosyası, gerçek servis hesabının Session 0 tazelik kontrolünde **ready**.
  420 MB SQLite'ın her dosyada kopyalanmasını önleyen sınırlı toplu üretim,
  bütün dosyaları son revizyon/boyut kontrolünden geçirmeden hiçbir kanıt
  döndürmez. **19/19 attestation testi PASS**. Yenileme seçimi değişmemiş
  kaynak revizyonlarının mevcut hash doğrulamalı kanıtını kullanır; hedef
  klasördeki değişiklikler bağımsız kaynak kanıtı olarak kullanılamaz.
- İlk toplu pCloud işi 274 klasörde 19.313 kaynak dosyasını doğruladıktan sonra
  `EIO` kaynak okuma hatasıyla durdu. Son RUNNING raporu terminal hata ile
  uzlaştırılıp PARTIAL olarak kaydedildi; başarı sayılmadı. Yeni iş okunamayan
  kaynakları dosya yolu/nedeniyle ayrı raporlar ve diğer klasörleri kontrol
  eder. Hiçbir durumda doğrulanmamış kısmi kanıt döndürülmez.
- `HasarBotu-Office-Source-Attestations` gerçek interaktif `user` oturumunda
  yüksek yetkiyle bağımsız P: kaynağını okur. **07:15–19:15 arasında saatte bir**
  ve kullanıcı girişinden iki dakika sonra çalışır; çakışan işler başlatılmaz.
  Manuel tetikleme: ofis masaüstündeki `HasarBotu - Kaynak Doğrula.bat`.
  İş yalnız kendi kanıt/rapor dizinlerine yazar, kaynak/hedef evraklara yazmaz.
  Güvenlik kapısı geçersiz/eski/eksik kanıtı kabul etmeye devam etmez.

Kanıtlar: `.local/local-tracking-20261011/office-live-data-repeat-acceptance.json`,
`office-post-import-https-acceptance.json`, `office-service-gate-acceptance.json`,
`office-post-import-backup-restore-acceptance.json` ve
`installed-office-client-runtime-acceptance.json`. Özel evrak/hesap listeleri,
ham kaynaklar ve yedekler Git'e dahil edilmez.

Açık kabul: tüm pCloud kaynaklarının tazelik doğrulaması ve ofis Windows
yeniden başlatması sonrası otomatik açılış.
12.10.2026 tarihinde kurumsal Google girişi ve salt okunur Gmail bağlantısı
ofis sunucusunda kuruldu; ilk posta taraması ve kurulu masaüstü köprüsü
doğrulandı. Kullanıcı gerçek kullanım testine Google hesabıyla giriş yaparak
başladığını bildirdi; aynı giriş sunucunun denetim kaydında doğrulandı.
76 mesaj inceleme listesinde; SBM otomatik uygulama kapalı.
Güncel kabul, aktarım düzeltmesi ve kurtarma kanıtları:
[Google ofis kurulumu](GOOGLE_OFFICE_SETUP_2026-10-12.md).

## Önceki hazırlık geçmişi

- Kaynak veritabanının tutarlı PostgreSQL snapshot yedeği ayrı ve boş bir
  veritabanına geri yüklendi. **123 tablonun tüm satırlarının sayısı ve hash'i**
  kaynak snapshot ile birebir doğrulandı. Kaynak veritabanı değiştirilmedi.
- Üretim adayında **380 gerçek dosya ve üç gerçek kullanıcı** korundu. Kullanıcı
  parola hash'leri ve roller değişmedi. Parolalar bilinmediği için gerçek
  kullanıcı parolasıyla giriş kabulü henüz yapılmış sayılmaz.
- Eski test hesabı ve makine agent'ları kapatıldı; oturumlar temizlendi. Deneme
  dosyası `0051_case_archive` ile arşivlendi. Silinmesi değişmez takip tarihçesi
  tarafından engellendiği için tarihçe/FK bütünlüğü korundu. Liste, toplam,
  arama, vaka uçları, bildirimler ve agent taraması bu kaydı dışlar. Arşivleme
  kontrollü veri hazırlığı içindir; genel bir silme/arşivleme ekranı eklenmedi.
- Ortak eksper ve sorumlu eşlemeleri korundu. **36 sorumlusu belirsiz dosya**
  ayrı listede kalır. Kullanıcı kararı gereği servis eşlemesi yapılmaz.
  **165 kayıtsız klasör ve üç sorunlu kaynak** kanıt eksikliği nedeniyle bekler.
- API ve tam File Agent bağımlılıklarıyla ayrı dağıtım dizinine hazırlandı.
  Native modüller ve referans veriler repo `node_modules` dizinine ihtiyaç
  duymadan yüklendi. `0051` dahil 51 migration pakette bulunur.
- Eşzamanlı sorumlu güncellemesi sırasında tarama, vaka satırını gereksiz
  kilitlemez. Önce 500/lock-timeout ile yeniden üretilen durum, konum kilidi
  korunarak düzeltildi; gerçek PostgreSQL eşzamanlılık testi ve 51 takip/
  arşivleme kontrolü geçti.
- Dağıtılmış gerçek API, geri yüklenen aday veritabanı üzerinde HTTP ile
  doğrulandı: 380 görünür dosya, üç aktif gerçek kullanıcı, arşiv dosyasına
  404, korunmuş tarihçe ve kapalı eski agent'lar. Denetim için kısa süreli
  sunucu oturumu kullanıldı ve ardından temizlendi; otomatik kullanıcı girişi
  üretim davranışına eklenmedi.
- **Node 24.21.0 ile toplam 2.050 PASS, 6 SKIP.** Frontend 371/6 skip,
  domain 568, contracts 291, database 81, desktop bridge 14, API 494,
  File Agent 114, desktop 117. Atlanan altı frontend kontrolü başarılı sayılmaz.
  API typecheck, değişen TypeScript ESLint ve tam build PASS.
  Tam suite ardından son tarama kilidi düzeltmesi için tüm API suite'i
  yeniden çalıştırıldı; diğer alt sistemlerde kaynak değişmedi.
- Ayrıca gerçek Electron/Chromium üzerinde `cookieSecure=true` ile sentetik
  yönetici girişi, kullanıcı oluşturma, yeni kullanıcı girişi ve sayfa
  yenilemesinde oturumun korunması geçti. Bu yerel bridge kabulüdür; ofisin
  uzak HTTPS sertifika/güven kabulünün yerine geçmez.
- Windows x64 NSIS masaüstü kurucusu üretildi. PE x64 ve paket main/version
  doğrulandı. Kurucu 0.1.3 sürümündedir; Authenticode imzası yoktur.

## Paket ve veri ayrımı

Kod/kurucu paketi:
`C:\HasarBotuPilot\office-handoff-20261011\HasarBotu-Ofis-Hazirlik-20261011.zip`.
İçindeki `artifact-manifest.json` dosya boyutlarını ve SHA-256 hash'lerini taşır.
Paket müşteri verisi, giriş parolası/hash'i, oturum veya agent secret içermez.

Veri yedeği korumalı dizinde ayrı tutulur:
`C:\HasarBotuPilot\local-tracking-20261011\private\production-transition-20261011`.
Bu yedek kaynak snapshot anını temsil eder. Canlı geçiş sırasında son yedek ve
yeniden doğrulama gerekir; yeni kullanıcı/dosya değişiklikleri eski hazırlık
yedeğiyle ezilmez. Üretim hedefi boş olmayan bir veritabanıysa önce yedek ve
çakışma incelemesi yapılır; üzerine otomatik geri yükleme yapılmaz.

## Ofiste yapılacak ilk işlem

1. Hazırlık ZIP'ini ofis bilgisayarına götürüp bir klasöre çıkarın.
2. **`OFIS_KONTROL.bat` dosyasına çift tıklayın.**
3. Aynı klasörde oluşan **`ofis-kontrol-sonucu.json`** dosyasını geliştirme
   bilgisayarına getirin.

Ön kontrol yerel IP, mevcut PostgreSQL/HasarBotu servisleri, dinleyen ilgili
portlar, Node sürümü, evrak klasörü ve olası pCloud veritabanı yollarını toplar.
Servis kurmaz; evrak, veritabanı, güvenlik duvarı veya router ayarı değiştirmez.
Yanlış bilgisayar/eksik kök/yanlış Node varsa açık BLOCKED üretir. Kullanıcı
hesabında ön kontrol geçmesi Windows servis hesabı kabulü değildir.

## Canlı kullanım kabulü açık

Verilen adres internet çıkış IP'sidir. Bu bilgisayardan 443/5986/3389 üzerinde
kontrollü bağlantı denemeleri zaman aşımına uğradı; bilgisayar adı çözümlenmedi.
Ofis bağlantısı/yönetim erişimi henüz mevcut değildir. Yerel IP/VPN veya
ofiste çalışan bir yönetim oturumu belirlendiğinde kurulum devam eder.

Hedefte mevcut veritabanı envanteri ve doğrulanmış yedeği, veri çakışmalarının
incelenmesi, minimum gerekli DB yetkileri, makineye özel agent, servis hesabı evrak
erişimi, güvenilir HTTPS ve istemci bağlantısı kabul edilmelidir. Yerel API
loopback sınırı ve uzak istemcide HTTPS zorunluluğu korunur.

Tam File Agent kritik yazma işlemleri pCloud güncellik kanıtı olmadan güvenli
biçimde reddedilir. Ofisin gerçek pCloud DB/attestation yapılandırması ve
Session 0 güncellik kabulü henüz yapılmadı. Google/Gmail/otomatik SBM ve
yapılandırılmamış AI sağlayıcıları ayrı kurulum/kabul bekler. Mevcut gelişim
bilgisayarında yeniden başlatma kabulü geçti; ofis yeniden başlatma, kesinti
toparlanması ve üretim yedek geri yükleme kabulü ayrıca yapılacaktır.

Kanıtlar: `.local/local-tracking-20261011/office-data-readiness.json`,
`office-runtime-validation.json`, `office-connectivity.json`,
`office-artifacts/*-smoke.json`, `office-artifacts/archive-verification.json`
`production-cookies-desktop-validation.json` ve
`production-full-tests.log` / `production-api-tests.log`.

**Durum: PARTIAL — yerel hazırlık doğrulandı; mevcut ofis kurulumunun bu sürüme
geçişi ve gerçek kullanım kabulü tamamlanmadı.**

## Ön kontrol düzeltmesi

Windows PowerShell 5.1, parametre varsayılanları değerlendirilirken
`$PSScriptRoot` değerini boş bırakabildiği için ilk çift tıklama çağrısı
`Join-Path` hatası verdi. Node ve çıktı yolları artık script gövdesinde çözülür.
Başlatıcı hata/engel çıkışını korur; başarısız çağrıda eski bir raporu yeni
üretilmiş gibi duyurmaz. BAT kaynağı `deploy/windows-service/office-check.bat`
üzerinden paketlenir; üretilen pakette adı `OFIS_KONTROL.bat` olur.

Gerçek Windows PowerShell 5.1 ve `cmd.exe` ile **5/5 regresyon PASS**:
parametre varsayılanları, parametresiz paket çağrısı, açık yol parametreleri,
farklı çalışma dizininden BAT çağrısı ve hata sonrası eski rapor korunması.
Önceki kontroller Node/çıktı yollarını açıkça geçtiğinden bu hatayı yakalamadı.

Küçük düzeltme paketi
`C:\HasarBotuPilot\office-handoff-20261011\HasarBotu-Ofis-Kontrol-Duzeltme-20261011.zip`
içindeki `inspect-office-readiness.ps1` ve `OFIS_KONTROL.bat` dosyaları,
ofiste açılan hazırlık klasöründeki aynı adlı iki dosyanın üzerine kopyalanır.
Sonra BAT yeniden çalıştırılır. Tam hazırlık ZIP'i de bu düzeltmeyle yenilendi.

## Gelen ofis raporu ve ağ tespiti

11.10.2026 15:00:38 UTC tarihli gerçek ofis raporunda hedef bilgisayar ve
evrak kökü kontrolü geçti. PostgreSQL 17, `hasarbotu-api` ve
`hasarbotu-file-agent` otomatik başlangıçla çalışıyor. API 3100 ve PostgreSQL
5432 yalnız loopback üzerinde dinliyor. Bu, yeni sürüm/veri geçişinin veya
servis hesabı evrak erişiminin kabul edildiği anlamına gelmez. Mevcut veritabanı
incelenip yedeklenmeden üzerine geri yükleme yapılmaz.

Rapordaki iki özel adrese bu geliştirme bilgisayarından bağlantı kurulamadı.
15:32:05 UTC tarihli bağımsız ağ raporu, ofisteki Tailscale adaptörünü,
otomatik çalışan servisini ve CLI `Running` durumunu doğruladı. IP aralığı
tek başına uygulama kanıtı sayılmadı. Ön kontrol 1.1.0 ağ kartı/adres eşleşmelerini, bilinen VPN
servislerini ve varsa Tailscale bağlantı durumunu/peer bilgisayarlarını toplar.
Servis komut satırı argümanları, Tailscale hesap bilgileri ve anahtarları rapora
yazılmaz. Tailscale sorgu hataları açık durum koduyla belirtilir; kurulum veya
oturum açma yapılmaz. Mevcut servislerin yalnız çalıştırılabilir dosya yolları
raporlanır. Ham ofis raporu yerel Git dışlama listesine alındı.

Bağımsız ağ kontrol paketi `HasarBotu-Ofis-Ag-Kontrol-Bagimsiz-20261011.zip`
yeni bir klasöre tamamen çıkarılır. İçindeki `OFIS_KONTROL.bat` çalıştırılıp
güncel JSON raporu getirilir. Önceki
PowerShell/BAT regresyonları ile Tailscale alan seçimi, oturum açılmamış durum,
CLI hatası ve bozuk çıktıda gizli veri sızmaması Windows üzerinde doğrulanır.

İlk küçük ağ paketi yalnız önceki hazırlık klasörüne uygulanabilecek bir yamaydı;
ayrı çıkarılan klasörden çalıştırılınca `HOST_INSPECTION_SCRIPT_REQUIRED`
hatası verdi. Yeni başlatıcı `-NetworkOnly` kullanır; önceki host scriptine veya
Node/runtime dizinine ihtiyaç duymaz. Aynı ağ tespit kodu kullanılır. Rapor
`InspectionScope: NETWORK_ONLY` ve `ReadinessInspected: false` ile bu kontrolün
tam sunucu kabulü olmadığını belirtir. Eksik host scripti ve Node bulunan
gerçek BAT çalıştırması regresyon testine eklendi.

## Geliştirme bilgisayarının ofis ağına katılması

Bu bilgisayarda Tailscale bulunmadığı doğrulandı. Resmî kararlı dağıtımdan
1.104.1 Windows x64 MSI indirildi; SHA-256 dağıtım sunucusunun checksum değeriyle
eşleşti ve Authenticode imzası `Valid` / `Tailscale Inc.` olarak doğrulandı.
Yerel kurulum çıkışı 0, Windows servisi `Running`, CLI sürümü 1.104.1 ve
bağlantı durumu `NeedsLogin`. Yeniden başlatma istenmedi. MSI native Windows
dosya yollarıyla çalıştırıldı; ilk denemedeki slash biçimi kurulum servisi
tarafından yanlış çözümlenmişti.

Masaüstünde `HasarBotu - Ofis ağına bağlan.lnk` oluşturuldu. Kullanıcı aynı
Tailscale ağına giriş yaptı. Bağlantı sorunu bildirilince yerel tercihlerde
ofis bilgisayarının internet exit node olarak seçildiği ve bağlantının
`Stopped` durumda olduğu görüldü. `tailscale set --exit-node=` ile yalnız
exit node seçimi kaldırıldı; mevcut DNS/subnet tercihleri korundu. Bağlantı
yeniden açıldı. Gerçek kabulde `Running`, boş health listesi, ofis peer'inin
online olması, ofise doğrudan 8 ms Tailscale ping, public DNS ve HTTPS 200
doğrulandı. Varsayılan internet rotası yerel Ethernet üzerinden kaldı.

Ofiste SMB 445 erişilebilir; 22/443/5985/5986/3389/3100 bağlantıları reddediliyor.
Mevcut Windows oturumu ile ofis servis yönetimi denemesi `Access denied` döndü;
API yönetici paylaşımı da erişilebilir değil. Ağ bağlantısı kuruldu, Windows
yönetim oturumu henüz yok. Tailscale bağlantısı tek başına ofisteki loopback
API'yi uzak istemciye açmaz. Sonraki aşama yetkili Windows yönetim erişimiyle
mevcut veritabanının envanteri/doğrulanmış yedeği ve veri mutabakatıdır. Ofis
verileri değiştirilmedi. Yeni ağ raporu da yerel Git dışlama listesine alındı.

Kullanıcı ofis Windows hesabını Kimlik Bilgisi Yöneticisine kaydetti. Kayıt
metadata kontrolünde parola alanı boş bulundu; parola içeriği okunmadı veya
raporlanmadı. Gerçek `IPC$` oturum açma denemesi Windows 1327 hesap kısıtlaması
ile reddedildi. Kullanıcı ofis bilgisayarının parolasız açıldığını doğruladı.
Boş parola ile uzaktan giriş güvenlik politikası korunur. Kullanıcı ofisteki
hesabına Windows parolası ekleyip yerel kimlik kaydını güncelledikten sonra
kimlik doğrulama ve yönetici yetkileri ayrı ayrı yeniden test edilmelidir.
Kanıt: `.local/local-tracking-20261011/office-windows-auth-acceptance.json`.

Kullanıcı Windows parolasını ekleyip kimlik kaydını güncelledi. Yeniden denenen
gerçek `IPC$` ağ oturumu başarılı oldu; 1327 engeli aşıldı. Buna rağmen servis
`OpenService` ve `C$` yönetici paylaşımı erişimleri reddediliyor. Ağ kimliği
doğrulandı; Windows uzaktan yönetici yetkisi hâlâ yok. Bunun kesin olarak UAC
token filtresinden mi yoksa hesap/servis yetkilerinden mi kaynaklandığı hedefte
henüz doğrulanmadı; `LocalAccountTokenFilterPolicy` veya UAC değiştirilmedi.

`HasarBotu-Ofis-Yonetim-20261011.zip` bağımsız yönetim paketi hazırlandı.
Ofiste `OFIS_YONETIM.bat` sağ tık / Yönetici olarak çalıştır ile uygulanır.
Paket Windows'un yerleşik OpenSSH Server bileşenini gerektiğinde Windows Update
ile kurar; yalnız Tailscale adresinde dinler. Kaynak IP, izin verilen Windows
hesabı ve Ed25519 anahtarı sınırlandırılır; SSH parola girişi ve TCP/agent
yönlendirmeleri kapalıdır. Önceden var olan SSH servis/config dizinine yazmaz.
Windows kurucusunun genel SSH firewall kuralı kapatılıp yalnız bu geliştirme
bilgisayarını kabul eden kural oluşturulur. Uygulama/veritabanı/evraklar değişmez.

Özel anahtar yalnız yerel admin/SYSTEM/geçerli kullanıcı ACL'li korumalı dizinde
kalır; pakette yalnız açık anahtar bulunur. Kurulum hatasında yeni SSH listener
ve kurallar kapatılır. `disable-office-management.ps1`, yapılandırma hash'leri
hâlâ bu kurulumla eşleşirse yönetim kanalını durdurur. Kullanıcının diğer SSH
yapılandırmaları üzerine yazılmaz. Tekrar çalıştırma mevcut kurulum için inceleme
ister; başarı varsaymaz.

**6/6 hazırlık testi PASS**: yanlış makinede `-Apply` durması, gerçek BAT hata
çıkışı, güvenli adres/account/path sınırları, Microsoft imzalı gerçek `sshd`
ile config/effective-settings kontrolü, SID tabanlı ACL kabulü ve kurucu hata
verdiğinde yeni SSH servisi/firewall kurallarının kapanması. Bu son test ayrıca
gerçek açık anahtarın Türkçe Windows kültüründe doğrulanmasını kapsar; Base64
kontrolü kültüre bağlı ignore-case yerine case-sensitive yapılır. Native config
test ikilisi yalnız yerel test içindir; üretim paketine dahil değildir. Paket
hash'leri ve yerel anahtar çifti/ACL ayrıca doğrulandı. Ofiste kurulum, gerçek
uzak anahtar girişi ve host key pin kabulü **PENDING**; yerel config testi uzak
yönetim yetkisinin geçtiği anlamına gelmez. `ofis-yonetim-sonucu.json` hedefte
üretilip getirildikten sonra host public key pinlenerek gerçek SSH kabulü yapılır.


## Önceki SSH servis raporu ve tekrar kontrol

Kullanıcının getirdiği 19:23 UTC raporu önce mevcut SSH kurulumu için inceleme
istedi. Tekrar kontrol paketi hesap/IP/config/key hash'leri, host key, native
sshd yapılandırması, korumalı ACL, listener ve firewall kapsamını doğruladı.
Sekiz hazırlık testi geçti; o aşamada gerçek uzak giriş henüz bekliyordu.

Ardından gerçek ofis anahtar girişi ve yönetici yetkisi doğrulandı; host key
pinlendi. Yukarıdaki canlı kurulum bu doğrulanmış kanal üzerinden yapıldı.
SMB/SCM erişimini açmak için UAC veya Windows parola ilkesi gevşetilmedi.
