# Değer kaybında dosyadan otomatik bilgi alma

## Neden ve değişiklik

SBM/Eksist ile açılan dosyanın araç bilgileri zaten `CaseRecord.eksist.vehicleFields`
içinde geliyordu. Hesaplayıcı marka/modeli bu alandan almıyor, araç türünü otomobil
varsayıyor ve kasa bilgisini boş bırakıyordu. Kaza tarihi dosyadan, model yılı ise
kısmen kaynak alanından alınıyordu.

Yeni hesap açılışında ve dosya kaynağı yenilendiğinde şu eşleştirmeler uygulanır:

| Hesap alanı | Dosyadaki kaynak |
| --- | --- |
| Kaza tarihi | Dosyanın güncel `lossDate` değeri |
| Araç türü | `Araç Tarife Grubu`; yoksa açık `Araç Cinsi` |
| Marka | `Marka` |
| Model | `Araç Tipi`; yoksa `Model` |
| Model yılı | Geçerli dört haneli `Model Yılı` |
| Kasa / araç yapısı | Açık kasa/gövde alanı veya kaynak model/varyant metninde açıkça yazan yapı |

SBM'nin **Araç Tipi** alanı model açıklamasıdır; hesaplayıcının araç türü alanıyla
karıştırılmaz. Örneğin `KAMYONET` tarife grubu ve `TRANSIT 350 L VAN` modeli ayrı
alanlara gider. Sedan/hatchback gibi bir bilgi kaynakta yoksa yalnızca marka/model
adından kasa tahmin edilmez. Türle uyumsuz veya çelişkili kasa seçilmez.

Eksist ayrıştırıcısı artık açık kasa/gövde etiketlerini de saklar; bu etiketler
yanındaki model değerine eklenmez. Aynı gövde alanında çelişen kaynak değerleri
otoritatif bilgi olarak kaydedilmez; dosya oluşturma işlemi geri alınır.

## Kullanıcı girdisinin korunması

Önceki hesap girdilerinin parasal ve fiziksel ayrıntıları korunur. Güncel dosya
kimliği ilk açılışta eski hesap kimliğinden önce gelir. Kullanıcının hesaplayıcıda
yaptığı düzeltmeler, bilerek temizlediği alanlar ve parça gözlemleri gezinme
sırasında korunur. Otomatik alanlar kaynak değişince güncellenir; kullanıcının
değiştirdiği alanlar otomatik ezilmez.

**Dosya bilgilerini al** düğmesi mevcut dosyadaki bilinen alanları yeniden uygular;
rayiç, onarım sonrası değer, kusur ve fiziksel parça girdilerini silmez. Araç türü
veya kasa değiştiğinde eski referans kimlikleri temizlenir; fiziksel gözlemler
korunur. Kilometre/çalışma saati birimi değişirse önceki kullanım sayısı taşınmaz.
Kaynak değişikliği ve yeniden alma, eski hesap sonucunu geçersiz kılar.

Bu otomatik doldurma, üretici/VIN parça uygunluğu veya katsayı doğrulaması sayılmaz.
[Önceki kaynak sınırları ve piyasa farkı davranışı](VALUE_LOSS_MANUFACTURER_MATCHING_2026-10-18.md)
devam eder. Rayiç, onarım sonrası piyasa değeri ve hasarlı parçalar SBM araç
kimliğinden türetilmez.

Doğrulama ve teslim kanıtları: `.local/value-loss-prefill-20261018/`.

## Doğrulama

- Arayüz: **613 PASS / ortam bağımlı 6 SKIP**; domain: **693/693**;
  contracts: **320/320**; gerçek ayrı PostgreSQL ile API: **716/716 PASS**.
- Kaynak Excel hücre/formül ve dosya hash'i denetimi: **192/192 PASS**.
- Gerçek Chromium, üretilmiş arayüz, masaüstü köprüsü ve kimlik doğrulanmış API:
  **71/71 PASS**. Sentetik SBM metni gerçek kaynak endpoint'ine aktarıldı;
  dosya gerçek hızlı açılış işlemiyle oluşturuldu. Altı alanın otomatik dolması,
  aynı alanların hesap isteğine ulaşması ve %75 kusurla **75.000 TL** piyasa farkı
  sonucu doğrulandı. Elle düzeltme, gezinme ve yeniden alma da kapsanır.
- Kaynak yenilendiğinde alanların güncellenmesi, bilerek temizlenen alanların
  korunması, kaldırılan kaza tarihinin temizlenmesi ve eski sonucun kaldırılması
  regresyon testleriyle doğrulandı.
- TypeScript, ESLint ve bütün çalışma alanlarının derlemesi: **PASS**. Son arayüz
  değişikliği ayrıca yeniden tür/lint kontrolünden ve üretim derlemesinden geçti.
- Windows x64 **0.1.50** NSIS paketi: gerçek açılış, 60 arayüz dosyasının kaynak
  hash'leri, ofis profili, masaüstü köprüsü ve tepsiye kapanma **PASS**.
  Windows yayınlayıcı entegrasyon testi: **1/1 PASS**.

Eşzamanlı geniş doğrulamalarda bildirim ölçekleme ve eski Eksist dosya açılışı
testlerinde süre sınırına takılma görüldü. Aynı testler ayrı çalıştırıldığında
**6/6** ve **2/2**, ardından son geniş API ve arayüz çalışmaları tamamen geçti.
Test beklentileri veya süre sınırları değiştirilmedi. Tarayıcı testinin önceden
elle eklenen dosyasıyla numara sayacı aynı başlangıç durumuna getirildi; uygulamanın
numaralandırma kodu değiştirilmedi.

## Ofis teslimi

**0.1.50**, 18.10.2026 **16:01:51 Türkiye saati**
(`2026-10-18T13:01:51.093Z`) itibarıyla kimlik doğrulamalı ofis kanalına yayımlandı.
Kurulum **105.188.267 bayt**, SHA-256:
`b38596c625f475d36c6762185899abf9f9a11177f3182420e04dace4f702e1fe`.

API'nin 6 derlenmiş dosyası kaynak hash'leriyle doğrulanarak devreye alındı;
öncekiler yedeklendi. Ofisteki gerçek çalışma zamanında anonim kaynak metniyle
marka/model/yıl/tarife/kasa ayrıştırması da doğrulandı. Veritabanı değişikliği veya
gerçek dosyaya test değerlendirmesi/raporu yazılması yapılmadı.

Kurulu **0.1.49** istemcisi **0.1.50** sürümünü `available` olarak gördü.
Kimlik doğrulamalı indirme HTTP **200** ile tam **105.188.267 bayt** döndürdü;
istemcinin hesapladığı SHA-256 yayımlanan kurulumla birebir eşleşti.

Önceki **0.1.49** manifesti ve değişmez kurulumu korundu; çalışan istemcilere zorla
kurulum yapılmadı. Üretici/VIN uygunluğu ve tüm parça katsayılarının doğrulanmasına
ilişkin önceki kapsam sınırı devam eder.
