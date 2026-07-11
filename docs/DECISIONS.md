# HasarBotu V2 — Kilitlenmiş Kararlar

## Ürün

- V2 sıfırdan geliştirilecek.
- V1 kod tabanı V2'ye kopyalanmayacak.
- İlk firma Baran Global'dir.
- Başka firmalara sunma acele değildir; ancak `firmaId` altyapısı korunur.
- Ana dosya türleri yalnız Trafik ve Kasko'dur.
- Değer Kaybı Trafik'te zorunlu, Kasko'da isteğe bağlıdır.

## UI

- UI en yüksek önceliktir.
- Backend öncesi tıklanabilir UI prototipi tamamlanacaktır.
- Açık ve siyah koyu tema olacaktır.
- Lacivert koyu tema olmayacaktır.
- Kurumsal mavi vurgu kullanılacaktır.
- Varsayılan açılış sayfası Durum Panosu'dur.
- Sol menü ikonlu ve daraltılabilir olacaktır.
- Dosyalar ekranı kompakt tablo + sağ hızlı detay panelidir.
- Dosya modülleri dosya çalışma alanında sekmeler halinde açılır.
- Stitch ekranları görsel referanstır; üretim kodu değildir.

## Mimari

- PostgreSQL ana veri kaynağıdır.
- pCloud/P: fiziksel dosya deposudur.
- Göreceli yollar tutulur.
- Her cihaz yerel pCloud kökünü seçer.
- Kritik klasör işlemlerini tek ana Dosya Agent yürütür.
- İlk merkezi düğüm kullanıcının Windows 11 bilgisayarı olabilir.
- Harici disk veritabanı ve sistem yedekleri için kullanılacaktır.
- Dış erişim mimaride desteklenir; ilk sürüm için zorunlu değildir.

## Kullanıcılar

- Başlangıçta herkes bütün dosyaları görebilir.
- Her yerde filtreleme ve sıralama bulunur.
- Başlangıçta operasyonel yetkiler eşit olabilir.
- Rol altyapısı ve audit log baştan bulunur.
- Bir dosyada bir sorumlu ve bir eksper bulunur.
- Varsayılan tek eksper otomatik atanabilir.

## AI

- AI tam belge içeriğini okuyabilir.
- AI yalnız öneri ve karar desteği verir.
- Kullanıcı onayı olmadan gerçek yazma, kapatma, gönderme veya kesinleştirme yoktur.
- Aylık AI API hedef/üst sınırı yaklaşık 20 USD'dir.
- AI limiti dolsa da temel uygulama çalışmaya devam eder.

## Dosya ve klasör

- Fiziksel klasörler plaka bazlıdır: `34MPA764`, `34MPA764 - 2`.
- Alt klasörler: EVRAK, HASAR, OLAY YERİ, ONARIM, DEĞER KAYBI.
- Ofis numarası `YYYY/N` formatındadır.
- Dosya kapatılırsa aylık KAPALI klasörüne taşınır.
- Yeniden açılırsa açık ay klasörüne geri taşınır.
- Manuel taşıma algılanır ve kullanıcıya doğrulatılır.

## Kapanış

- Eksik işlemler dosya kapatmayı tamamen engellemez.
- `Eksiklerle Kapat` seçeneğinde gerekçe zorunludur.
- Kapanma ücreti nihai ekspertiz raporundan bulunur.
- AI aday tutarı ve kaynağı gösterir.
- Her kapanma ücreti kullanıcı onayıyla kesinleşir.
- Aylık kesin toplama yalnız onaylı tutarlar girer.

## Değer Kaybı

- 01.07.2026 Reel Piyasa Analizi yöntemi referanstır.
- AI veri çıkarır; sürümlü kural motoru hesaplar; eksper onaylar.
- Parça ve boya listesi kesinleşmeden hesap tamamlanmaz.
- Eski kural sürümüyle hesaplanan sonuç sonradan değişmez.
- Kritik manuel değişikliklerde gerekçe zorunludur.

## PERT

- AI önerisi, eksper kanaati ve merkez/sigorta kararı ayrı tutulur.
- Rayiç için sigorta rayici ile AI emsal araştırması birlikte gösterilir.
- Nihai rayici eksper onaylar.
