# Değer kaybı hesaplaması ve Excel karşılaştırması

01.07.2026 ve sonraki kazalarda `real-market-analysis/2026-07-01/1.0.0`
kural tablosu kullanılır. Önceki tarihlerde piyasa değer farkı yöntemi korunur.
Kaynak Excel salt okunur tutulur; SHA-256 kimliği ve üretilen referans tablosu
karşılaştırma testinde doğrulanır.

## Hesap akışı

1. Araç yaşı, kaza yılı ile model yılı farkıdır. Yaş ve kullanım katsayıları
   Excel'in `Tablolar` sayfasından gelir.
2. İş makinesi, traktör ve tarım makinesinde kullanım birimi çalışma saatidir.
   Diğer gruplarda kilometredir. Emsaller de aynı birimle karşılaştırılır;
   mevcut DTO'daki `mileage` alanı D grubu emsallerinde saat değerini taşır.
3. Değişim, onarım ve boya katsayıları parça bazında toplanır. Onarımda
   iskontosuz, KDV hariç işçilik / yeni parça bedeli oranı %15'in altında hafif,
   %15 dahil %30'un altında orta, %30 ve üzerinde ağır sınıftır.
   Bedel tespit edilemiyorsa ağır onarım seçilebilir.
4. Hasar katsayısı, `(parça katsayıları + 10 × hasar / rayiç) / 100` olur.
   Excel `Hesaplama!J3` gibi, hasar tutarı sıfırsa bu katsayı sıfırdır.
5. Genel çarpan `1 − ticari/kiralık %5 − min(geçmiş hasar adedi, 5) × %3
   + kilometre alt sınır ilavesi` şeklindedir. Alt sınır ilavesi %5'tir;
   ilk 1.000 km ve katsayının değiştiği sınırdan itibaren 1.000 km dahil uygulanır.
   Çalışma saatine uygulanmaz. Aynı katsayının tekrarlandığı tablo sütunları
   yeni sınır oluşturmaz; bu, Excel `Hesaplama!J9` ile karşılaştırılır.
6. Ham tutar, `rayiç × yaş × kullanım × genel çarpan × hasar katsayısı
   × araç çarpanı` olur. Araç çarpanı motosiklette 2,5, otobüste 0,5,
   diğer türlerde 1'dir. Rayicin %30'u ile sınırlanır, sonra 500 TL katına
   yukarı yuvarlanır. Ara hesaplar BigInt rasyonel aritmetik kullanır.

Önceden hasarlı veya sökülebilir ve onarılmış parçalar ile aksesuar, plastik,
boyasız panel ve boyasız onarım için ayrıca parça katsayısı uygulanmaz.
Önceden onarılmış kaynaklı parça değiştirilirse değişim katsayısı uygulanır,
boya katsayısı uygulanmaz. Bu seçimler ekranda yapılabilir.

## Kaynak dosyadaki hatalar için korunan düzeltmeler

Dosyanın hatalı hücre davranışları birebir kopyalanmaz:

- `Hesaplama!H1`, ham veya tavana ulaşmış sonuç tam 1.000 TL katı olduğunda
  kalan sıfır olduğu için sonucu sıfıra düşürebilir. Uygulama, rehberin
  3.21 maddesindeki 500 TL yukarı yuvarlama kuralını korur.
- `Hesaplama!F9`, D grubunda 5.001 saat ve üzerinde VLOOKUP sütunu olarak
  1'i kullanır ve sayısal katsayı yerine `D` metni döndürür. Uygulama,
  `Tablolar!L19:L20` içindeki 5.001 ve üzeri saat için 0,70 katsayısını kullanır.
- Mevcut referans tablosunda belgelenen eksik araç adları, yanlış yıl
  referansları, kullanılmayan ilave hücreleri ve kaymış parça başvuruları yerine
  doğrulanmış araç eşleştirmeleri ve doğrudan kaynak katsayı tabloları kullanılır.
  Araç eşleştirmesindeki mevcut ürün kararları değiştirilmemiştir.

Bu nedenle uyum, geçerli hesap kuralları ve kaynak katsayıları içindir;
bozuk Excel hücrelerinin çıktıları için değildir. Excel dosyası değiştirilmez.

## Kullanım ve doğrulama

Yeni dönem ekranı yalnız bu hesabın alanlarını gösterir. Rayiç ve hasar
tutarları TL girilir; parça seçimi raporun parça listesini de oluşturur.
Yalnız onarım seçimi raporda boya eklenmeden `repair` işlemi olarak saklanır.
Bu işlem, mevcut `repair_paint` ve diğer sözleşme değerlerine eklenmiştir;
önceden kaydedilmiş işlem değerleri korunur.
Kaza öncesi üç doğrulanmış emsal yeterlidir. Emsaller gerekçeyle hesap dışı
bırakılabilir; bu karar ve gerekçe sürüm yeniden açıldığında korunur.
Ortalama yalnız doğrulanmış, çelişkisiz, hesap dışı olmayan, son 30 gün ve
±%10 kullanım aralığındaki dolu tutarlardan alınır. Belge ve emsal doğrulaması ile
insan onayı gereksinimleri korunur. Girdiler değişince eski önizlemenin
kaydedilmesi engellenir; yeniden hesaplama gerekir.

`services/file-agent/test/value-loss-workbook-parity.test.ts`, kaynak dosyadan
formülleri okuyarak 14 araç türünün kilometre/saat sınırlarını, 16 yaş örneğini
ve 158 parça kuralının desteklediği değişim, onarım ve boya katsayılarını
karşılaştırır. Test yorumlayıcısı yalnız kullanılan formül alt kümesini çalıştırır;
native Excel çalıştırması değildir. Domain regresyonları sıfır hasarı,
%15/%30 sınırlarını, tavanı, yuvarlamayı ve saat emsallerini ayrıca sınar.
Ekran testleri gerçek hesap motoruyla önizleme sonucunu da kontrol eder.
