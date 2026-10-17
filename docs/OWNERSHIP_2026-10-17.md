# Sahiplik ve dağıtım doğrulaması 17 Ekim 2026

HasarBotu V2'nin özgün kodu, dokümantasyonu, özgün HB simgesi ve Windows paket bilgileri **Ömer Faruk İŞLEYEN** adına düzenlendi. Proje lisansı özel mülkiyet ve tüm hakların saklı olduğu hükmünü korur. Giriş ekranı, üst çubuk, README, dokuz çalışma alanının paket metadatası ve Windows yürütülebilirlerinin şirket/telif alanları aynı sahibi belirtir.

## İnceleme kapsamı

Git kapsamındaki dosyalar ile bu çalışmada eklenen dosyalar içerik taramasına alındı. Eski kurum kimliği kaynak örneklerinden, test verilerinden ve tarihsel notlardan kaldırıldı; anonimleştirilen tarihsel notlar açıkça işaretlendi. Görsellere gömülü eski logolar özgün vektör ve PNG HB simgesiyle değiştirildi. SVG'nin yan menüde daralarak kaybolması gerçek arayüz testiyle yakalandı ve sabit ölçülerle düzeltildi.

İki Word ihbar şablonunun başlığı tam adla değiştirildi, kurum eki ayrı metin parçalarından da temizlendi. Her biri tek sayfa olarak render edilip gözle kontrol edildi. XLSX ve Word ZIP üyeleri ayrıca incelendi. Referans PDF ve ona bağlı OCR görselindeki eski kişi adı sentetik eksper adıyla anonimleştirildi; belge akışı, temel vaka alanları ve kaynak kuruluşun telif bildirimi korundu. PDF'nin iki sayfası ve OCR ayrıştırması doğrulandı. Tasarım arşivindeki HTML içerikleri ve 20 PNG OCR taraması incelendi.

Bu çalışma bir veri taşıma işlemi değildir. Teknik programlama adları, bağımlılık adları ve bağımsız sigortacı/tedarikçi adları sahiplik etiketi olarak değerlendirilmez. Tasarım örneğindeki tedarikçi adı ve sigortacı kataloğundaki bağımsız kuruluş adı bu kapsamdadır. Git geçmişi, önceki değişmez sürümler ve geri dönüş yedekleri korunur.

## Mevcut izin ve özel yapılandırma

Kullanıcı, mevcut Touch çizimi için yazılı kullanım izni olduğunu bildirdi ve karakterin korunmasını istedi. Çizim değiştirilmedi. Karakterin ve diğer üçüncü taraf bileşenlerin lisans/telif bildirimleri kendi dosyalarında korunur; proje lisansı bu hakların devredildiği anlamına gelmez.

Google giriş alan adı artık korumalı sunucu yapılandırmasındaki GOOGLE_LOGIN_DOMAIN değerinden gelir. Ofiste önceki tam alan adı korundu; OAuth alan adı, imzalı hd ve e-posta alan adı denetimleri doğrulandı. Google/Gmail etkin ve dört uygulama servisi çalışıyor. Mevcut gerçek hesaplar ve yetkiler değişmedi.

Ofis klasör eşlemeleri özel dağıtım girdisine taşındı. Paket, mevcut kayıtlı kök anahtarlarını ve fiziksel yolları koruyan özel eşlemeyi içerir. Bu teknik uyumluluk değerlerinde eski kurum metni bulunabilir; kaynak ağacı anonimdir. pCloud klasörleri, dosya yolları ve üretim kayıtları yeniden adlandırılmadı. Bakım araçları özel pCloud/ayna kökü ayarlarını ortamdan veya açık parametreden alır. Kurulumsuz kök denetimi engelli rapor üretir.

## Doğrulama

| Kontrol | Sonuç |
| --- | --- |
| Frontend | 532 PASS; varsayılan koşuda atlanan 6 canlı HTTP testi ayrıca 6 PASS |
| Domain / contracts / database / desktop bridge | 651 / 304 / 83 / 17 PASS |
| API / File Agent / masaüstü | 657 / 315 / 173 PASS |
| Dağıtım ve bakım araçları | 205 PASS, 0 atlanan |
| Gerçek Windows yayıncı entegrasyonu | 1 PASS |
| Sahiplik ve logo arayüzü | Yan menü, giriş ekranı, gerçek çıkış ve yeniden yükleme PASS |
| Statik denetim ve derleme | TypeScript, ESLint, üretim derlemesi PASS |
| Windows paketi | x64 NSIS; gerçek açılış, 59 UI dosyasının eşleşmesi, bağlantı profili ve klasör eşlemesi PASS |
| PowerShell | Değişen 14 araç ve geri dönüşlü dağıtım betiği: 15/15 sözdizimi PASS |

Toplam **2944 başarılı test**. İlk koşudaki PDF metin sırası ve eski Google test düzeneği hataları giderildi; etkilenen test grupları yeniden başarılı çalıştırıldı. Görsel incelemede bulunan SVG ölçü hatası için gerçek arayüz regresyon kontrolü eklendi.

## Ofis teslimi

**0.1.37**, 2026-10-17T11:58:11.261Z tarihinde mevcut kimlik doğrulamalı ofis kanalına yayımlandı. Kurulum dosyası **105,162,642 bayt**, SHA-256:

`541077afcabbb0d3ceedfbbceced38e0cd9d799b1b7c6026076eb92751534ea4`

Ofiste çalışan **0.1.36** istemci üretim güncelleme IPC'si üzerinden available sonucu ve 0.1.37 sürümünü gördü. Kimlik doğrulamalı HTTP 200 indirmesi 105,162,642 baytla ve aynı SHA-256 ile doğrulandı. Çalışan istemciye kurulum zorlanmadı.

Önceki 0.1.36 manifesti ve değişmez kurulum dosyası korundu. Sunucuda yalnız Google yapılandırmasını kullanan derlenmiş modül ve korumalı API servis ayarı güncellendi; önceki dosyalar geri dönüş için saklandı. Veritabanı migration'ı yok. Son kontrolde API sağlıklı, dört uygulama servisi Running ve klasör keşfinin taze sonucu PASS. Geçici doğrulama görevi ve tanılama dinleyicisi kaldırıldı.

Yerel kanıtlar: .local/ownership-20261017/ altındaki validation-report.json, package-results.json, backend-proof.json, publication-proof.json, update-check-proof.json, final-health-proof.json ve ui-evidence/. Özel bağlantı değerleri, sırlar ve tam kurum klasör eşlemeleri Git dışında tutulur.
