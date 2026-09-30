# Google, evrak ve Tramer takibi

Bu dosya uygulama ve doğrulama kaydıdır. Gerçek hesap/e-posta ile sınanmayan maddeler tamamlandı sayılmaz.

| # | Gereksinim | Kabul kanıtı | Durum |
|---|---|---|---|
| 1 | Tanımlı kurumsal kullanıcıyla Google girişi; mevcut rol ve sorumluluk korunur | RSA imza doğrulama; yanlış domain/nonce/audience, doğrulanmamış e-posta, pasif/tanımsız çalışan reddi; mevcut kullanıcı/rol ile oturum | Yerel testler geçti; gerçek Google girişi açık |
| 2 | Girişten bağımsız Gmail okuma izni ve bağlantı sağlığı | Ayrı izin akışı; şifreli refresh token; izin kaybı ve tekrar bağlantı; eski çalışan yetkisinin tekrar kontrolü | Yerel testler geçti; gerçek Gmail izni açık |
| 3 | Merkezi klasör keşfi, değişiklik ve kopyalama kontrolü | Gerçek Windows dosyaları; geçici ad, büyüyen dosya, açık yazıcı, hash sırasında değişiklik, yeniden başlatma | İzole testler geçti; gerçek servis kökleri açık |
| 4 | Dosya sorumlusuna evrak bildirimi ve insan onayı | Eksiklik onay öncesi açık; yalnız sorumlu onayıyla mevcut; yeni sürümde yeniden kontrol; silinen evrak mevcut sayılmaz | İzole API/DB ve ekran testleri geçti |
| 5 | Bağımsız Tramer sorumlusu ve kişisel iş listesi | Sekretere ayrı görev; dosya sorumlusu değişmez; yetkisiz/kiracı dışı atama reddi | İzole testler geçti |
| 6 | Başvuru numarası metin ve benzersiz | Baştaki sıfırlar; JS sayısal hassasiyetini aşan numara; eşzamanlı aynı numarada tek kabul | İzole testler geçti |
| 7 | Dört Tramer durumu | Numara → sonuç bekleniyor; terminal duruma otomatik geri dönüş yok; geç sonuç kontrol kuyruğunda | İzole testler geçti |
| 8 | Numara ile SBM sonucu eşleştirme | Sentetik Türkçe/HTML/plain MIME; gönderen/DMARC kontrolü; belirsizlik, eşleşmeme, çelişki; insan kontrolü | Gerçek SBM örnekleri yok; otomasyon varsayılan kapalı |
| 9 | Kalıcı bildirim ve uygulama içi uyarı | UI kapalıyken gerçek HTTP üzerinden kayıt; API yeniden başlatma; özel okunma/sunulma durumu; dosya bağlantısı | İzole API/DB ve ekran testleri geçti |
| 10 | Bağımsız merkezi takip ve kesinti kurtarma | API Gmail işçisi; File Agent klasör tarayıcısı; kalıcı mesaj kayıtları; tam tarama; servis son başarı/yanıt süresi | Yerel süreç/HTTP testleri geçti; gerçek Windows servis dağıtımı açık |
| 11 | Bekleyen işler ve geçmiş | Aktör, zaman, numara, kaynak hesap, durum geçişleri; mevcut append-only audit | İzole testler geçti |
| 12 | İzole regresyon ve hata kurtarma | Veritabanı, gerçek dosya, gerçek HTTP, sentetik sağlayıcı arızaları ve ekranlar | 1.992 test geçti; gerçek dış hizmet pilotu açık |

İlk inceleme: mevcut auth parola/oturum tabanlı; mevcut bildirimler türetilmiş operasyonel uyarılar; File Agent yalnız kuyruğa verilen işleri işler. Bu özellikler yeni takipten bağımsız korunur.

## Kullanım

- Dosya → **Operasyon → Evrak ve Tramer takibi**: sorumlu atama, numara kaydetme, iptal, evrak kontrolü ve geçmiş.
- **Bildirimler → Evrak ve Tramer takibi**: kişisel bekleyen Tramer işleri, kontrol bekleyen evraklar, okunmamış bildirimler, SBM kontrol kuyruğu ve bağlantı sağlığı.
- Google giriş düğmesi yalnız tam sunucu yapılandırması varsa etkinleşir. Google sayfası sistem tarayıcısında açılır. Callback uygulama oturumu vermez; yalnız başlangıçtaki HttpOnly akış çerezini taşıyan uygulama tamamlamayı tüketip oturum alabilir.
- Gmail bağlantısı yönetici/eksper/dosya yöneticisi rolüyle ayrı başlatılır. E-postanın geldiği hesap dosya sorumlusu olarak kullanılmaz.
- İlk klasör taraması mevcut, henüz takip edilmemiş dosyalar için de kontrol kayıtları oluşturur. Yeni/değişen takipli evrak insan onayı olmadan gereksinimi karşılamaz. Fiziksel doğrulama ve içerik onayı ayrıdır.
- Merkezi klasör takibi ilk bağlantısını kaydettiğinde, eski metadata API'sinden eklenen ve yalnız fiziksel olarak doğrulanan evrak da insan kontrolü olmadan gereksinimi karşılayamaz. Takip devreye alınmamış kurulumların eski işleyişi korunur; takip devreye alındıktan sonra servisin kesilmesi onay şartını kaldırmaz.

## Dağıtım ve yapılandırma

1. Önce `0050_tracking` migration'ı uygulanmalı; sonra API ve File Agent birlikte güncellenmelidir. Mevcut migration testleri geri alma/yeniden uygulamayı doğrular. Üretimde veri içeren takip tablolarına `down` çalıştırılmamalıdır.
2. Google OAuth web istemcisinde callback tam olarak `GOOGLE_REDIRECT_URI` ile eşleşmelidir. Yol `/api/v1/google/callback`; üretim bağlantısı HTTPS olmalıdır. Masaüstü loopback köprüsü değişmez; OAuth callback merkezi API'ye ulaşır.
3. API servisinin korumalı ortamına `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_TOKEN_ENCRYPTION_KEY` verilir. Son alan rastgele üretilmiş 32 baytın 64 karakterlik hex gösterimidir. Anahtar mevcut tokenlar varken plansız değiştirilemez; değişirse hesapların yeniden bağlanması gerekir. Değerler repoya konmaz.
4. `SBM_SENDER_ADDRESSES`: gerçek sonuç gönderen tam e-posta adresleri, virgülle ayrılır. Alan boşsa Gmail bağlama devreye alınmaz. Tahmini SBM adresi kodda tanımlanmadı.
5. `SBM_AUTOMATIC_ENABLED=false` varsayılandır. Gerçek e-posta örnekleriyle ayrıştırma ve eşleştirme doğrulanmadan `true` yapılmamalıdır. Otomasyon kapalıyken sonuçlar kontrol kuyruğuna alınır; yetkili kişi numarayı ve sonucu doğrulayarak uygular veya gerekçeyle kapatır.
6. File Agent mevcut kök eşlemelerini kullanır. `HASARBOTU_TRACKING_ENABLED` varsayılan `true`; geçiş sırasında `false` ile kapatılabilir. API doğrudan mutlak klasör yolu almaz.
7. Masaüstü kapalı tutulup gerçek servis hesabıyla ekleme/değiştirme, servis kesintisi/yeniden başlama ve Google izin iptali pilotu yapılmalıdır. Bu oturumda üretim servisi değiştirilmedi ve üretim migration'ı çalıştırılmadı.

## Kurtarma ve sınırlar

- Klasör taraması 15 saniyelik çevrim ve en az 30 saniyelik kararlılık penceresi kullanır. Windows'ta açık yazıcıyla çakışan paylaşım izni hash okumayı engeller. Tarama öncesi/sonrası boyut ve zaman bilgileri de karşılaştırılır. Başarılı taramadan sonra kaybolan dosyaların eski onayı artık evrak gereksinimini karşılamaz.
- Dosyayı üreten süreç yazıcıyı kapatıp uzun süre sonra aynı ada yeniden yazıyorsa genel bir dosya izleyicisi son parçanın geldiğini kesin çıkaramaz. Bu üreticilerde tamamlanınca geçici addan nihai ada atomik rename sözleşmesi gerekir. Böyle bir üretici için yalnız kararlılık süresiyle yüzde yüz tamamlanma garantisi verilmez.
- API'ye ulaşmayan gözlem onaylanmış sayılmaz. Yeniden başlatmada tarama yeniden yapılır; aynı içerik yeni bildirim üretmez. A → B → A gerçek değişiklikleri ayrı revizyonlardır.
- Gmail worker yalnız tanımlı gönderenleri, tüm sayfalarıyla yeniden uzlaştırır; mesaj/hesap kimliği kalıcı tutulur. Böylece süresi dolan bir history cursor nedeniyle sonuç atlanmaz. Büyük posta kutularında tam tarama süresi ve kota tüketimi pilotta ölçülmelidir.
- Aynı numara ve normalize sonuç farklı hesaplardan gelirse tek durum değişikliği/bildirim yapılır; her hesap için mesaj kaydı korunur. Çelişkili veya terminal işlemi değiştiren sonuçlar kontrol kuyruğunda kalır.
- Gönderen tam adresi ve Gmail `Authentication-Results` DMARC doğrulaması uygun değilse otomatik uygulama yoktur. Gerçek SBM şablonları ve gerekli sonuç ayrıntıları henüz örneklenmedi; sentetik ayrıştırıcı testleri gerçek şablon kanıtı değildir.
- Bildirim alıcısı olay anındaki dosya sorumlusudur. Sorumlusu olmayan dosyanın olayı saklanır ve sorumlu tanımlanınca görünür. Uyarıyı kapatmak okundu işaretlemek değildir.

## Doğrulama kaydı

- Yeni API/Google/SBM testleri: `services/api/test/tracking-unit.test.ts`, `tracking-integration.test.ts`.
- Fiziksel Windows takip testleri: `services/file-agent/test/document-tracker.test.ts`.
- Ekran testleri: `src/features/tracking/TrackingWorkspace.test.tsx`; masaüstü Google host sınırı: `apps/desktop/test/external.test.ts`.
- Ayrı PostgreSQL veritabanı: `tracking_test`, yalnız yerel test kümesi. Üretim/pilot verisi kullanılmadı.
- Gerçek Google hesabı, gerçek SBM e-postaları ve üretim Windows servis pilotu tamamlanmadığı için toplam durum **PARTIAL**.

### Son test ve build sonuçları

| Katman | Başarılı test |
|---|---:|
| UI + canlı HTTP adaptörleri | 371 |
| Domain | 568 |
| Contracts | 282 |
| Database | 80 |
| Desktop bridge | 14 |
| API | 452 |
| File Agent | 110 |
| Desktop / Electron | 115 |
| **Toplam** | **1992** |

46 yeni test eklendi. UI/canlı HTTP birleşik koşusunda 369 test geçti; o koşuda TEST_DATABASE_URL verilmediği için atlanan iki UI→PostgreSQL testi ayrıca **2/2** çalıştırıldı. Tabloda atlanmış test başarılı sayılmadı.

- `npm run build`: başarılı. Başlangıç JS grafiği 467.693 bayt; 500.000 bayt sınırının altında. Yeni ekranlar ihtiyaç anında yüklenir.
- `npm run typecheck`: başarılı; son eklenen UI testleri ayrıca `tsc -b` ile doğrulandı.
- `npm run lint`: 0 hata, önceden var olan 12 uyarı. Yeni takip dosyalarında hedefli lint temiz.
- `npm run check:deploy`: başarılı. Bu kontrol gerçek üretim servis kurulumu/pilotu yerine geçmez.
- `git diff --check`: başarılı.
- Yerel loglar: `.local/tracking-all-ui-live-final.log`, `tracking-ui-db-final.log`, `tracking-full-tests.log` (Domain/Contracts/Database/bridge sonuçları), `tracking-api-final.log`, `tracking-agent-final.log`, `tracking-desktop-final.log`, `tracking-build-final.log`, `tracking-typecheck-final.log`, `tracking-lint-final.log`, `tracking-deploy-final.log`.

### Kapatılmayan kabul maddeleri

1. Gerçek kurumsal Google çalışan hesabıyla giriş, mevcut kayıt/rol ve dosya sorumluluklarının kontrolü. İlk bağlantıda yerel kullanıcı e-postası doğrulanmış kurumsal Google e-postasıyla eşleşmelidir; otomatik yeni çalışan oluşturulmaz.
2. Gerçek Google Cloud OAuth istemcisi, Gmail API ve izin ekranı kurulumu; gerçek posta hesabında izin verme/iptal/yeniden bağlama pilotu. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `SBM_SENDER_ADDRESSES` bu oturumda Process/User/Machine ortamlarının hiçbirinde tanımlı değildi.
3. Gerçek SBM sonuç örneklerinden kabul/red/iptal, baştaki sıfırlar, farklı alıcı hesapları ve çelişkili sonuç örneklerinin anonimleştirilmiş fixture'lara dönüştürülmesi; ayrıştırıcının gerçek sonuç alanlarına uyarlanması. **Otomatik SBM uygulaması etkinleştirilmedi.**
4. Hedef Windows servis hesabıyla gerçek klasörlere erişim ve yeniden başlatma/kesinti pilotu. Yazıcısını kapatıp sonra yeniden açan kopyalama kaynaklarında atomik nihai adlandırma sözleşmesinin doğrulanması.

Google uygulama sınırları için kullanılan birincil kaynaklar: [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [OAuth sunucu akışı](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail senkronizasyonu](https://developers.google.com/workspace/gmail/api/guides/sync).
