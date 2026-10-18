# Değer kaybı işlem seçimi ve resmî kaynak kontrolü — 18.10.2026

## Doğrulanan kapsam

SEDDK'nın 05.11.2025 tarihli **2025/25** sayılı Genelgesi ve ekindeki rapor
şablonu doğrudan kurumun sitesinden indirildi; beş sayfası görsel olarak okundu.
Şablonun basılı dördüncü sayfasındaki parça tablosu **Onarım+Boya,
Değişim+Boya, Boya, Değişim, Boyasız Onarım** işlemlerini ayrı gösterir.
Aynı bölüm parça türünün ve tekrarlanan hasarın değerlendirilmesini ister.
Piyasa araştırması bölümü kaza öncesi ve onarım sonrası ikinci el satış değeri
arasındaki farkı esas alır. Şablon tek başına her boyasız onarımın veya her
plastik parçanın hukuken sıfır değer kaybı doğurduğu sonucunu vermez.

- [SEDDK 2025/25 ve rapor şablonu](https://seddk.gov.tr/upload/2025-25%20say%C4%B1l%C4%B1%20Genelge%20-%20Copy%201.pdf)
- [SEDDK 12.06.2026 resmî açıklaması](https://www.seddk.gov.tr/UploadContent/Documents/Bas%C4%B1n%20Duyurusu.12.6.pdf): gerçek zarar ilkesi, standartlaştırılmış hesap/rapor ve maddi hasarla birlikte değer kaybı değerlendirmesi.
- [12.06.2026, 33278 sayılı Resmî Gazete değişikliği](https://www.resmigazete.gov.tr/eskiler/2026/06/20260612-3.htm): A.5/a piyasa farkı ve araç/hasar geçmişi; madde 6 eski Ek-1'i kaldırır; madde 8 yürürlük 01.07.2026. Resmî Gazete sunucusu araştırma aracından erişilemedi; metni aynı başlık ve sayıyla yayımlayan [meslek odası PDF kopyası](https://iousaieo.org.tr/wp-content/uploads/2026/06/resmigazete.gov_.tr_eskiler_2026_06_20260612-3.htm.pdf) okundu. SEDDK sitesindeki eski genel şartlar PDF'si güncel konsolide metin kabul edilmedi.
- [Sigorta Tahkim Komisyonu karar dergisi 65](https://www.sigortatahkim.org/content/CmsFiles/karardrgs65.pdf), PDF sayfa 68–69: somut uyuşmazlıkta marka, model, hasar, işlem, kilometre, yaş ve geçmiş hasar değerlendirilerek kaza öncesi ve onarılmış piyasa değerleri farkı esas alınır. Yayımlanmış bir karar, her dosya için sabit tazminat veya evrensel katsayı garantisi değildir.

## Uygulama kararı

- Yerel `datalist` yerine mevcut `SearchableSelect` kullanılır. Liste ekran
  yüksekliğine göre yukarı/aşağı açılır; yüksekliği sınırlıdır ve kaydırılır.
  Türkçe arama, fare ve klavyeyle seçim korunur.
- Tek fiziksel parçada **Onarım + Boya** veya **Değişim + Boya** seçilir.
  API'ye mevcut sözleşmenin desteklediği iki atomik işlem gönderilir;
  katsayılar mevcut hesap motorunca bir kez toplanır. Değişim ve onarım
  aynı parçaya birlikte eklenmez. Boya tam/lokal olarak seçilebilir.
- Boyasız onarım ana işlem listesindedir. Eski yalnız onarım davranışı
  uyumluluk için korunur; boya kendiliğinden varsayılmaz. Parçanın katalogda
  desteklemediği işlem birleşimleri sunulmaz.
- **Özel işlem** başlığı kaldırılır. Malzeme, aksesuar ve üstyapı seçimleri
  işlemden ayrı **Parça niteliği** altında korunur. Mevcut referans hesapta
  etkileri bulunduğu için sessizce silinmez; tek başlarına tazminat hakkını
  belirlemedikleri açıklanır. Boyasız onarımdan standart işleme geçiş,
  eski hariç tutma seçimini de temizler.
- Eski onarım/değişim ve ayrı boya satırları, parça niteliği ve önceki durumu
  eşleşiyorsa tek satırda gösterilir; API girdisi ve parasal değerleri korunur.
  Tutarsız eski satırlar sessizce birleştirilmez veya silinmez.
- Mevcut Excel referans motorunun katsayıları bu arayüz düzeltmesinde
  değiştirilmez. Sonucu **Tahmini değer kaybı** olarak gösterilir; piyasa
  araştırması gerektiren kesin eksper/Tahkim sonucu gibi sunulmaz. Bu
  değişiklik bir tazminat hukuku veya hesap motoru migrasyonu değildir.
  Kapsamlı geçmiş değerlendirmeler ve rapor API'leri korunur.

## Doğrulama ve dağıtım

- Node 24.21.0: tüm workspace typecheck, ESLint ve üretim build PASS.
- Arayüz testleri: **575 PASS, 8 atlandı**. Altı isteğe bağlı canlı kabul ve iki
  bu değişiklik dışındaki veritabanlı UI testi çalıştırılmadı. Etkilenen
  hesap ekranı/ayrıştırıcı/seçim bileşeni/dosya detayı testleri ayrıca 40/40 geçti.
- Gerçek UI → masaüstü köprüsü → kimlik doğrulamalı API → geçici PostgreSQL:
  **22/22 PASS**. Onarım+boya iki atomik işlem olarak ulaştı ve yalnız onarıma
  göre tutarı değiştirdi. Tek fiziksel satır, lokal boya, gezinmede durumun
  korunması ve eski tutarın temizlenmesi doğrulandı. 1440×700, 1024×600,
  768×700 ve 390×600 ekranlarda açılır liste ekran içinde kaldı ve gerçek fare
  tekerleğiyle kaydı. JavaScript hatası ve değerlendirme/rapor yazımı yok.
- Windows x64 NSIS **0.1.47** paketi üretildi. Gerçek paket açılışı, 60 UI
  dosyasının hash eşleşmesi, ofis profili, köprü ve tepsi davranışı PASS.
  Windows yayınlayıcısının entegrasyon testi 1/1 PASS.
- Ofis kanalı **0.1.47**, **2026-10-18T08:19:10.822Z** tarihinde yayımlandı.
  Paket **105,170,984 bayt**; SHA-256
  `eb2d1a178d315b5fa0bb61a411e8f5acecd92d29dff23f1090dcb78a6c79f492`.
- Çalışan eski **0.1.46** istemcisi yeni sürümü **available** olarak gördü;
  kimlik doğrulamalı indirme HTTP 200, tam boyut ve aynı SHA-256 ile doğrulandı.
  Önceki 0.1.46 manifesti ve değiştirilemeyen kurulum dosyası korundu.
  Kullanıcıların çalışan uygulamalarına zorunlu kurulum yapılmadı.
- Ofisteki beş uygulama servisi ve API sağlıklı. Geçici tanılama görevi
  kaldırıldı, inspector portu kapatıldı. Backend dağıtımı veya veritabanı
  değişikliği gerekmedi; gerçek dosya kaydı değiştirilmedi.

Özel kaynak PDF, ekran görüntüleri, test ve dağıtım kanıtları Git dışındaki
`.local/value-loss-ui-20261018/` dizinindedir.
