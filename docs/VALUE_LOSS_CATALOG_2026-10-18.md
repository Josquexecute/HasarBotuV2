# Değer kaybı parça listesi ve katsayı doğrulaması

14 araç türündeki eski liste, fiziksel parça kataloğu ile hesaplama referansını
aynı şey sayıyordu. Minibüs/otobüs ortak tablosunda numaralı yan kapaklar,
iş makinesi tablosunda aynı adlı kapaklar bulunuyordu. Motosiklet tablosunun
dört satırı, motosiklette yalnızca dört hasarlı parça bulunabileceği anlamına gelmez.

Yeni listeler araç türü ve kasa yapısına göre düzenlenmiş, değiştirilebilir
önerilerdir. Üretici/model/VIN üzerinden doğrulanmış eksiksiz parça kataloğu
oldukları iddia edilmez. Listede bulunmayan parça da adı, konumu, adedi,
malzemesi, önceki durumu ve işlemiyle girilebilir. Aynı adlı farklı konumlar
bağımsız tutulur. Araç yapısı değişince fiziksel bilgiler korunur; uygun olmayan
referans kimliği kaldırılır. Araç türü değişince önceki türün parçaları temizlenir.

## Güncel resmî kaynaklar

- [SEDDK 2026/11, 13.05.2026](https://seddk.gov.tr/UploadContent/Documents/2026-11_Say%C4%B1l%C4%B1_Genelge.pdf),
  madde 6: yürürlük 01.07.2026. Ek 1.1, PDF sayfa 9; onarım+boya,
  değişim+boya, boya, değişim ve boyasız onarımı ayrı işlem seçenekleri olarak
  gösterir. Aynı sayfadaki piyasa araştırması, aracın kaza öncesi ve onarıldıktan
  sonraki ikinci el değerlerini kaza tarihi koşullarında karşılaştırır. Bu belge
  her fiziksel parça için sayısal bir katsayı tablosu yayımlamaz.
- [Sigorta Tahkim Komisyonu Karar Dergisi 65](https://www.sigortatahkim.org/content/CmsFiles/karardrgs65.pdf),
  basılı sayfa 68–69: piyasa değerlerinin karşılaştırılması üzerinden gerçek
  zarar değerlendirmesi. Karar örneği, bütün parçalar için bağlayıcı bir sayısal
  katsayı listesi olarak kullanılmadı.
- [SEDDK 12.06.2026 basın duyurusu](https://seddk.gov.tr/UploadContent/Documents/Bas%C4%B1n%20Duyurusu.12.6.pdf)
  ve [TSB'deki 06.12.2021 tarihli genel şartlar/ekler](https://www.tsb.org.tr/content/Legislations/Trafik_Genel_%C5%9Eartlar%C4%B1_06122021__Ekler_Dahil.pdf)
  ayrıca incelendi. Tarihî katsayı tabloları güncel ve bütün parçaları kapsayan
  zorunlu hesaplama standardı olarak sunulmadı.

## Katsayıların doğrulama sınırı

Sayısal referansın kaynağı repodaki
`Yeni Dönem Değer Kaybı Hesaplama Modülü 01.07.2026 V_1.xlsx` dosyasıdır.
SHA-256:
`81d3ae870cd5569b13371ec8b4de081a9a4e3e15098f7454f5d0cdcd3708c424`.
Dosyanın adı veya içerik eşleşmesi, tek başına resmî güncel mevzuat onayı
anlamına gelmez. Arayüz bu hesabı **referans tahmin** olarak adlandırır.

Değiştirilmemiş `real-market-analysis/2026-07-01/1.0.0` kaynağındaki tablo
satır sayıları A:32, B:46, C:28, Ç:28, D:13, E:7, F:4'tür.
C ve Ç aynı fiziksel Excel tablosundan türetilir. Araç türlerinin gruplara
eşleştirilmesinin bir bölümü mevcut ürün kararlarına dayanır; bunlar üretici
parça doğrulaması değildir.

Ek olarak aşağıdaki iki satır doğrudan kaynak hücreleriyle doğrulandı.
`calculator-reference/2026-07-01/1.1.0` uzantısı bu satırları yalnızca açıkça
seçilmiş otomobil/cabrio bağlamında kullanır; eski sabit snapshot değiştirilmez.

| Parça | Excel satırı | Değişim | Onarım hafif / orta / ağır | Boya tam / lokal |
| --- | --- | --- | --- | --- |
| Sol yan panel (ticari ve cabrio) | Tablolar!264 | 4,5 | 1 / 1,5 / 2 | 1,5 / 0,75 |
| Sağ yan panel (ticari ve cabrio) | Tablolar!265 | 4,5 | 1 / 1,5 / 2 | 1,5 / 0,75 |

Etiket B, değişim C, onarım F/G/H ve boya K/L sütunlarıdır. Uygulama
Esasları!B50, esas 3.7 bağlamı doğrular. Tek kapılı hafif ticari uygulamasının
şartları bu kasa seçeneğiyle otomatik varsayılmaz; eşleştirilmeyen parça için
piyasa farkı kullanılabilir.

Diğer doğrudan kaynak kuralları:

| Kaynak hücre / esas | Uygulama |
| --- | --- |
| Uygulama Esasları!B54 / 3.8 | Ruhsatta kamyonet olan koltuklu hususi görünümlü hafif ticari için otomobil grubu ve zorunlu ticari değerlendirme birlikte uygulanır. |
| Uygulama Esasları!B56 / 3.9 | Kullanıcının açıkça plastik karoseri/grenaj olarak tanımladığı parçaya ek parça/boya katsayısı eklenmez; hasar tutarının taban etkisi korunur. |
| Uygulama Esasları!B60 / 3.10 | Açıkça çelik/sac ve boyasız onarım seçilen parçaya ek onarım/boya katsayısı eklenmez; taban hesap korunur. |

Ek katsayı uygulanmaması toplam tazminatı sıfır saymak değildir. Diğer plastik,
alüminyum, cam, mekanik, elektrik, aksesuar veya üstyapı için bu kural otomatik
genişletilmez. Eksik katsayı, sıfır katsayı veya başka parçanın katsayısı olarak
yorumlanmaz. Yeni öneriler için doğrulanamayan sayısal değer üretilmedi.

## Hesaplama davranışı

Referans yöntemi yalnızca her seçimin parça adı/kimliği, araç/kasa bağlamı,
işlemi ve malzemesi güvenle eşleştiğinde kullanılır. Tek fiziksel satırdaki
onarım+boya ve değişim+boya, hesap motorunda iki işlem olarak uygulanır.
Kaynakta tekrar eden veya belirsiz adlar, birden fazla konum/adet ve doğrulanmamış
parça için katsayı çoğaltılmaz. Bir seçim bile karşılanmıyorsa eksik referans
toplamı gösterilmez; bütün araç için piyasa değer farkı gerekir.

Piyasa farkı: `(kaza öncesi değer − onarım sonrası değer) × karşı taraf kusuru`.
Değerler kullanıcı tarafından araştırmayla belirlenir. Araç geçmişi kaza öncesi
değere de yansıtılmalıdır. Onarım sonrası değerin kaza öncesinden büyük olması,
eksik parça adı, geçersiz adet veya aynı ad/konumun iki kere girilmesi engellenir.
Kuruş hesapları güvenli tamsayı ve mevcut yarım-yukarı yuvarlama ile yapılır.

Yeni alanlar eski istemci sözleşmesini bozmaz. Hesap endpoint'i salt okunurdur;
dosya, resmî değerlendirme, onay veya rapor oluşturmaz. Eski kayıtların girişleri
korunur; yeni biçimden önceki hatırlanmış sonuç yeniden hesaplama gerektirir.

## Doğrulama

- Kaynak Excel karşılaştırması: 192/192 PASS; dosya hash'i, bütün eski
  snapshot'ın yeniden üretimi, yeni iki satırın hücreleri ve esaslar dahil.
- Domain: 679/679; contracts: 319/319; gerçek geçici PostgreSQL ile API:
  713/713 PASS. Eski istemci hesabı, yeni fiziksel seçimler, eksik toplamın
  engellenmesi, piyasa farkı, plastik karoseri tabanı, cabrio bağlamı ve kamyonet
  istisnası kapsanır. Yetki/kurum sınırları ve salt okunurluk da sınanır.
- Gerçek Chromium, üretilmiş UI, masaüstü köprüsü ve kimlik doğrulanmış API:
  55/55 PASS. 14 araç türü, kasa listeleri, yeni katsayının gerçek etkisi,
  konum/adet, kullanıcı parçası, gezinme sonrası hatırlama ve 390–1440 px
  genişliklerde açılır listenin ekrana sığması/kayması kapsanır.
- TypeScript, ESLint ve bütün çalışma alanlarının üretim derlemesi: PASS.
- Arayüz geniş testleri: 585 PASS, ortam bağımlı 6 test SKIP. İlk paralel
  geniş çalışmada eski Eksist entegrasyon testi zaman aşımına uğradı; aynı test
  tek başına 2/2, ardından son geniş çalışma 585/585 PASS verdi. Testin
  beklentileri ve süresi değiştirilmedi.

Kanıtlar: `.local/value-loss-catalog-20261018/`. Testler, adı `_test` ile biten
ayrı geçici veritabanlarında çalıştırıldı. Gerçek ofis dosyaları test verisiyle
değiştirilmedi.

## Ofis yayını

0.1.48, 18.10.2026 15:00:26 Türkiye saati
(`2026-10-18T12:00:26.818Z`) itibarıyla kimlik doğrulamalı ofis akışına yayımlandı.
Windows x64 NSIS kurulumu: 105.183.511 bayt, SHA-256:
`4b71eec837107af6ff27db6461a1b7084895f1949af7c446fcdec120cd1b2aea`.
Paketin gerçek açılışı, paketlenmiş 60 UI dosyası, ofis bağlantı profili,
masaüstü köprüsü ve tepsiye kapanma davranışı doğrulandı. Windows yayımlayıcısı
entegrasyon testi 1/1 PASS verdi.

API'deki 18 derlenmiş dosya kaynakla aynı hash üzerinden devreye alındı;
önceki dosyalar yedeklendi. Veritabanı değişikliği yapılmadı. Beş ofis servisi
çalışıyor, HTTP ve HTTPS sağlık kontrolleri başarılı.

Ofisteki mevcut 0.1.47 istemcisinin gerçek oturumuyla salt okunur kabul:
eski/yeni tam eşleşmiş seçim 57.000 TL, karşı taraf %75 kusurlu piyasa farkı
75.000 TL, açık plastik karoseri taban hesabı 24.000 TL, yeni cabrio yan panel
52.000 TL, kamyonet istisnası 54.000 TL. Bunlar anonim sentetik hesap girdileridir;
ofis dosyasına değerlendirme veya rapor kaydedilmedi. Bir adet eşleşmeyen parça
eklenince referans toplamının engellendiği doğrulandı.

Aynı kurulu 0.1.47 istemcisi 0.1.48 sürümünü `available` durumunda gördü.
Kimlik doğrulamalı indirme HTTP 200 ile 105.183.511 baytın tamamını döndürdü;
istemcinin hesapladığı SHA-256 yayımlanan kurulumla birebir eşleşti.

Önceki 0.1.47 manifesti ve değişmez kurulumu korundu. Kullanıcıların çalışan
istemcilerine zorla kurulum yapılmadı; genel indirme kanalı değiştirilmedi.
