# Ofis klasörü ve kapanış

Ofisin çalışma alanı `P:\BARAN GLOBAL EKSPERTİZ\2026 OFİS` olarak yapılandırılmıştır. Desktop varsayılanı bu klasördür; kayıtlı göreli yolda `2026 OFİS` varsa tekrar eklenmez. Ofis varsayılanı eski yerel kök kaydından önce denenir. Merkezi file agent kökü `P:\BARAN GLOBAL EKSPERTİZ` olur; mevcut göreli yollar, belge kimlikleri ve geçmiş konumlar topluca yeniden yazılmaz. Eski `C:` çalışma kopyası silinmez. Servis hesabıyla P: okuma/yazma probu ve 27 TST025 klasöründe 67 gerçek dosyanın güncellik doğrulaması başarılıdır.

Otomatik keşif yapılandırmasında `yearFolder: "2026 OFİS"` yalnız bu yıl klasörünü taratır. pCloud klasör kimlikleri ve depolama köküne göre tam göreli yollar korunur. Başka yıllardaki mevcut kayıtlar silinmez.

Doğrulanmış, aktarılmış bir dosyada `2026 OFİS/Ekim 2026/27TST025` kapanış hedefi `2026 OFİS/Ekim 2026/KAPALI DOSYALAR/27TST025` olur. Ay klasörü zaten doğrulandığı için bilinmeyen ihbar tarihi uydurulmaz. Sigorta şirketi ve dosya adındaki ekler korunur. `_EKSİK DOSYALAR` gibi ay içermeyen konumda gerçek ihbar tarihi gerekir; rastgele arşiv ayı seçilmez. Yeni, aktarılmamış çalışma alanlarının tarih kontrolü korunur.

Klasörü elle `KAPALI DOSYALAR` içine taşımak programdaki dosyayı kapatmaz. Sabit kaynak kimliğiyle konum uzlaştırılır. Kullanıcı kapanışı onayladığında zaten kapalı klasördeki içerik yerinde doğrulanır; iç içe arşiv klasörü oluşturulmaz. Böyle kapatılan bir dosya yeniden açılırsa ay klasörüne geri taşınır.

“Eksiklerle kapat” evrak engelini gerekçeli ve kayıtlı olarak aşabilir; fiziksel klasör doğrulamasını, sürüm kontrolünü ve kullanıcı onayını aşmaz. Önizleme dosyayı kapatmaz veya klasörü taşımaz. **Onayla ve Kapat** işi file agent kuyruğuna gönderir. Kopyalama/taşıma ve dosya doğrulaması tamamlandığında konum ile açık/kapalı durumu güncellenir.

409 yanıtları sürüm değişikliği, dolu hedef, geçersiz klasör ve devam eden işlem olarak ayrı açıklanır. Gerçek sürüm çakışmasında **Güncel Veriyi Yükle** pencereyi kapatmadan sürümü yeniler; kapanış seçimi ve gerekçe korunur. Yeni önizleme ve onay gerekir.

0.1.25 doğrulaması: yaşam döngüsü, keşif ve Gemini API testleri 26/26; ilgili frontend testleri 16/16; domain testleri 6/6; klasör açma testleri 13/13 başarılı. İzole gerçek Electron/API/PostgreSQL arayüz kontrolünde 15 kontrol başarılıdır. Genel desktop paketinde 150 test geçti, platform/ortam koşuluna bağlı 10 test atlandı; son kök önceliği değişikliği ayrıca 13 testle doğrulandı. Typecheck, derleme ve paketlenmiş Windows uygulamasının açılış/tepsi kontrolü başarılıdır. Güncelleme TLS üzerinden hash ile doğrulanarak özel ofis kanalına yayımlandı. Bu kontroller gerçek bir kullanıcı dosyasını kapatmaz.
