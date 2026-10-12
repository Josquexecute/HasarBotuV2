# Google ve Gmail bağlantısı — 12.10.2026

## Canlı kurulum

- Kurumsal hesap: `omerfaruk.isleyen@baranekspertiz.com`.
- Proje: **HasarBotu V2**, `baran-hasarbotu-v2-20261012`; kuruluş `baranekspertiz.com`.
- Gmail API **Enabled**, Google Auth Platform **Internal**. Politika kabulü ve OAuth istemcisi oluşturma kullanıcı tarafından tamamlandı.
- OAuth istemcisi: **Web application**, **HasarBotu V2 - Ofis API**. Tek callback: `https://desktop-efn2g33.tail276cda.ts.net/api/v1/google/callback`.
- Giriş kapsamları `openid email profile`; eklenen tek posta kapsamı `https://www.googleapis.com/auth/gmail.readonly`.
- Yapılandırmanın tek kaynağı korumalı ofis API WinSW XML’idir. Google sırları ve token şifreleme anahtarı yalnız SYSTEM/yöneticilerce okunabilir; File Agent erişemez. Machine ortamına ikinci bir Google yapılandırması yazılmadı.
- API ve File Agent yeniden başlatıldı; ikisi de **Running**, HTTPS Google durumu **enabled: true**. Sırlar, tokenlar ve özel yedekler Git dışında tutulur.

## Gerçek kabul

- Gerçek Google yetkilendirmesi, imzalı kimlik doğrulaması, mevcut çalışan hesabına eşleme, güvenli uygulama oturumu ve dosya listesine erişim **PASS**. Doğru organizasyon ve mevcut roller ayrıca doğrulandı; yeni rol atanmadı.
- Gmail hesabı **connected**. Gerçek Google izni ve yenileme tokenı kabul edildi; token veritabanında şifreli. İlk tarama ve servis yeniden başlatmasından sonraki tarama başarılı; son istemci kabulü 17:28 UTC.
- Gerçek SBM göndereni `sbm@sbm.org.tr`, önceki EML kabulüyle doğrulanmış adrestir. **76 mesaj inceleme listesinde**; bunların tamamı otomatik sonuç kabul edilmez. **SBM_AUTOMATIC_ENABLED=false**.
- Chrome özel Cloudflare DNS seçimi MagicDNS adını çözemedi. Kullanıcı Güvenli DNS açıkken mevcut hizmet sağlayıcısını seçti ve ofis durum sayfasında `enabled: true` gördüğünü doğruladı. uBlock da kullanıcı tarafından kapatıldı.
- Otomatik tarayıcı kontrolü ofis sayfalarında ayrıca `ERR_BLOCKED_BY_CLIENT` döndürdü. Manuel kullanıcı erişimi ve sunucudaki gerçek tamamlanmış OAuth akışı ayrı kanıtlarla doğrulandı; otomatik tarayıcı callback kabulü PASS gösterilmez.
- Kurulu **0.1.3** masaüstü istemcisinin gerçek loopback köprüsü: UI varlıkları 200, anonim dosya erişimi 401, Google etkinliği, sıkıştırılmış yanıtın JSON olarak açılması ve bağlı Gmail hesabı **PASS**. Tam takip yanıtı 746 ms.
- **Masaüstü Google giriş kabulü PASS — kullanıcı tarafından doğrulandı.** Kullanıcı gerçek kullanım testine Google hesabıyla oturum açarak başladığını bildirdi. Aynı hesabın yeni `auth.google_login` kaydı 17:40:45 UTC'de sunucuda doğrulandı; bu kabul otomatik görsel test olarak gösterilmez.
- 17:42 UTC kontrolünde Gmail **connected**, son başarılı tarama 17:41:48 UTC, hata alanı boş ve şifreli token mevcut. Google/Gmail kurulumunun kullanıcı kabulü tamamlandı; uygulamanın diğer iş akışlarının gerçek kullanım testi devam ediyor.

## Aktarım düzeltmesi

Genel takip yanıtı 14.568.808 bayttı. Sıkıştırmasız HTTPS aktarımı 15 saniyede yalnız 642.895 bayt alabildi ve zaman aşımına uğradı. Yalnız büyük, başarılı `/api/v1/tracking` JSON yanıtlarına istemcinin kabul ettiği gzip eklendi. İçerik ve sözleşme değişmez; gzip reddedildiğinde kimlik aktarımı korunur. Masaüstü köprüsü sıkıştırılmış baytları ve başlıkları aynen aktarır.

Ofise uygulanan iki derleme dosyası hash ile doğrulandı. Önceki ofis router dosyasıyla karşılaştırmada yalnız sıkıştırma kaydı eklendiği kanıtlandı; başka kaynak değişikliği bu dağıtıma dahil edilmedi. Gerçek HTTPS yanıtı **1.343.754 bayt**, tam JSON alma süresi **1.101 ms**.

Testler: **65/65 API** (13 gerçek, ayrı `_test` PostgreSQL testi dahil), **14/14 masaüstü köprü**; typecheck, ESLint, API build ve diff kontrolü PASS. Frontend değişmedi; yeni Windows kurulum paketi üretilmedi.

## Kurtarma

Google yapılandırması ve token anahtarının korumalı kurtarma kopyaları ofiste ve geliştirme bilgisayarında saklanır. Önceki API XML’i ve sıkıştırmadan önceki router geri dönüş için korunur.

Yeni canlı veritabanı yedeği ayrı `hasarbotu_office_google_20261012_test` veritabanına geri yüklendi: **123 tablonun tüm satır sayıları/hash’leri birebir eşleşti**. Geri yüklenen Gmail tokenı saklanan kurtarma anahtarıyla çözülebildi. Ofis veritabanına geri yükleme yapılmadı.

Yedek SHA-256: `2121f855dad6fed8f7e2ec05f7a4f6d22d4e1ad6c643428d8e1d56ab1c68f416`.

Git dışındaki `.local/local-tracking-20261011` kanıtları:

- `office-google-configuration-acceptance.json`
- `office-google-configuration-acl.json`
- `office-google-key-recovery-acceptance.json`
- `office-google-tracking-runtime-acceptance.json`
- `office-google-installed-client-acceptance.json`
- `office-google-user-acceptance.json`
- `office-post-google-restore-acceptance.json`
