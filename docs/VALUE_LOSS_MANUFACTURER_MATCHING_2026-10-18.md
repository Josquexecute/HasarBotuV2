# Değer kaybı: üretici kaynakları ve doğrulanamayan parçalar

## Kapsam ve sınır

Kullanıcı, lisanslı SEİK/SBM veya üretici kataloğu erişimi bulunmadığını belirterek
açık resmî kaynaklarla ilerlenmesini istedi. Bu çalışmada bütün marka/model/VIN'ler
için eksiksiz parça kataloğu veya her modele uygulanabilir doğrulanmış katsayı
listesi elde edilemedi. **Tam üretici/VIN doğrulaması tamamlanmış değildir.**

Üç ayrı durum korunur:

- Kaynak Excel'deki sayısal katsayının doğrulanması.
- Bir parça kategorisinin üreticinin belirli model/yıl belgesinde bulunması.
- VIN'e, üretim tarihine, donanıma ve gerçek malzemeye uygun parçanın ve o araca
  uygulanacak katsayının doğrulanması.

İlk iki durum üçüncüyü kanıtlamaz. Kaynağı bulunamayan katsayı üretilmedi;
eksik katsayı sıfır kabul edilmedi ve benzer parçadan aktarılmadı.

## Açık resmî kaynak kontrolü

- [SEİK duyuruları](https://www.tobbseik.org.tr/index.php/duyurular): erişilebilen
  duyurular incelendi. Bu sayfadan bütün üretici/model parçalarını ve sayısal
  katsayılarını içeren bir veri kümesi doğrulanmadı.
- [TOBB sıralı atama duyuruları](https://www.tobb.org.tr/SigortacilikMudurlugu/SigortaEksperleri/Sayfalar/SEASDuyurular.php):
  arama dizininde 2026/7 duyurusu bulundu; doğrudan içerik alınamadı. Yerel HTTP
  istemcisi eksik TLS sertifika zinciri, diğer erişimler zaman aşımı/502 döndürdü.
  Sertifika kontrolü gevşetilmedi; duyurunun içeriği katsayı kanıtı sayılmadı.
- [SBM hasar sorgulama soruları](https://www.sbm.org.tr/tr/sss/?cat=10): parça
  ayrıntısının eksper raporunda belirtilen değişen parçalarla ilişkisi ve orijinal /
  eşdeğer ayrımı incelendi. Hasar sorgusu, üretici uygunluk veya sayısal değer kaybı
  katsayısı kataloğu olarak yorumlanmadı. Ücretli sorgu yapılmadı.
- [Tesla parça kataloğu](https://parts.tesla.com/) ve
  [partslink24](https://www.partslink24.com/partslink24/user/login.do) girişleri
  kontrol edildi. Bu oturumda VIN'e bağlı parça numarası doğrulaması yapılmadı.

Tesla'nın açık **2017–2023 Model 3** servis belgelerinden aşağıdaki dört kategori
eşleştirildi. Marka, model, yıl, araç türü ve kasa bağlamı denetlenir; başka yıl,
model, taraf veya kasaya tahmini eşleştirme yapılmaz.

| Uygulama kategorisi | Doğrudan üretici kaynağı |
| --- | --- |
| Motor kaputu | [Hood](https://service.tesla.com/docs/Model3/ServiceManual/en-us/GUID-485FE399-AB5A-4E92-A465-6E9A6A670B5B.html) |
| Sol ön çamurluk | [Fender Assembly — Front — LH](https://service.tesla.com/docs/Model3/ServiceManual/en-us/GUID-560AD448-8C36-45E7-9A51-A6F986A849D9.html) |
| Sol ön kapı | [Door — Front — LH](https://service.tesla.com/docs/Model3/ServiceManual/en-us/GUID-FFC0B263-F0FC-48C7-96AE-6C0CE39FA9BD.html) |
| Sol arka kapı | [Door — Rear — LH](https://service.tesla.com/docs/Model3/ServiceManual/en-us/GUID-DF610287-2E91-4316-8CA2-887841FAD5E2.html) |

Bu belgeler sayısal değer kaybı katsayısı yayımlamaz. Türkçe Excel kategorisindeki
“sac” ifadesi üretici malzemesi kanıtı değildir; kapı belgesi kapı sacının ayrı OEM
uygunluğunu kanıtlamaz. Bu nedenle dört eşleşme de **belge/kategori eşleşmesi**
olarak gösterilir ve üretici bağlamında piyasa değer farkını kullanır.

## Çalışan hesaplama

- Marka/model girildiğinde üretici bağlamı API'ye iletilir. Doğrulanmamış model
  katsayısı yerine bütün araç için piyasa farkı uygulanır; kaynak eşleşmesi varsa
  ilgili üretici belgesinin bağlantısı gösterilir.
- Marka/model girilmeden yapılan mevcut genel referans tahmini korunur ve üretici /
  VIN kontrolü yapılmadığı açıkça belirtilir.
- Referans hesabında işlem yeteneğinin listelenmesi yeterli değildir: gereken
  değişim, onarım seviyeleri ve seçilen boya modunun gerçek sayısal katsayıları
  denetlenir. Eksik, bozuk ve geçersiz değerler piyasa farkına yönlendirilir;
  kaynakta açıkça tanımlı sıfır geçerlidir.
- API, istemci referans hesabı istemiş olsa bile eksik eşleşmede mevcut piyasa
  değerleriyle otomatik hesaplar. Onarım sonrası değer eksikse sonuç üretilmez ve
  istenen alan belirtilir. Sonraki değerin önceki değeri aşması engellenir.
- Tek bir parça bile karşılanmıyorsa kısmi katsayı toplamı üretilmez. Piyasa farkı
  bir kez, araç bütünü için hesaplanır ve karşı taraf kusuru uygulanır.
- Eski istemci istek/yanıt biçimi, yetki/kurum sınırları, önceki kurallar ve salt
  okunur hesaplama korunur. Değerlendirme, onay veya rapor oluşturulmaz.
- Marka/model gezinme sonrasında korunur. Önceki sürümün hatırlanmış sonucu yeni
  doğrulama kuralları altında yeniden hesaplanana kadar gösterilmez.

Doğrulama ve ofis yayını kanıtları: `.local/value-loss-matching-20261018/`.

## Doğrulama

- Domain: **692/692**, contracts: **320/320**, gerçek ayrı PostgreSQL ile API:
  **715/715**, arayüz: **587 PASS / ortam bağımlı 6 SKIP**.
- Kaynak Excel hash'i ve hücre/formül karşılaştırması: **192/192 PASS**.
- Üretilmiş arayüz, gerçek Chromium, masaüstü köprüsü ve kimlik doğrulanmış API:
  **63/63 PASS**. Üretici bağlantısı, model/yıl sınırı, bilinmeyen üretici, otomatik
  piyasa hesabı, %75 kusur, gezinmede korunma ve gerçek kayıt oluşturmama kapsanır.
- TypeScript, ESLint ve bütün çalışma alanlarının üretim derlemesi: **PASS**.
- Windows x64 **0.1.49** NSIS paketinin gerçek açılışı, paket içindeki 60 arayüz
  dosyasının kaynak hash'leri, ofis profili, köprü ve tepsiye kapanma: **PASS**.
  Windows yayınlayıcı entegrasyon testi: **1/1 PASS**.

Kurulum: **105.186.969 bayt**, SHA-256:
`ab579496150dfd41a6347a74e3424993874ffece3827373983adcd370293243f`.

## Ofis teslimi

**0.1.49**, 18.10.2026 **15:21:19 Türkiye saati**
(`2026-10-18T12:21:19.142Z`) itibarıyla kimlik doğrulamalı ofis kanalına yayımlandı.
API'nin 21 derlenmiş dosyası kaynak hash'leriyle doğrulanarak devreye alındı;
öncekiler yedeklendi. Beş ofis servisi sağlıklı; veritabanı değişikliği yapılmadı.

Kurulu **0.1.48** istemcisinin gerçek oturumuyla salt okunur kabul:

- Mevcut genel referans hesabı: **57.000 TL**; yeni fiziksel biçimle aynı sonuç.
- Doğrulanamayan parça içeren referans isteğinin otomatik piyasa farkı:
  **75.000 TL** (kaza öncesi 1.000.000 TL, sonrası 900.000 TL, kusur %75).
- Doğrulanmamış marka/model için aynı piyasa hesabı: **75.000 TL**.
- Plastik karoseri taban hesabı **24.000 TL**, cabrio yan panel **52.000 TL**,
  kamyonet istisnası **54.000 TL**; komşu davranışlar korundu.

Bu kontroller anonim sentetik hesap girdileridir; gerçek dosyaya değerlendirme
veya rapor kaydedilmedi. İstemci **0.1.49** sürümünü `available` olarak gördü.
Kimlik doğrulamalı indirme HTTP **200**, tam **105.186.969 bayt** ve yayımlanan
SHA-256 ile birebir eşleşti.

Önceki **0.1.48** manifesti ve değişmez kurulumu korundu. Kurulum kullanıcının
kontrolündedir; çalışan istemcilere zorla kurulum yapılmadı.

Yazılım davranışı ve dağıtım doğrulandı. Tam üretici/model/VIN ve bütün parçalara
ait model özelinde katsayı kapsamı, yukarıdaki açık kaynak sınırı nedeniyle
**PARTIAL** kalır.
