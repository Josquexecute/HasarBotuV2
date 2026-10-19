# Dosya listesi kaynak kullanımı · 19 Ekim 2026

**0.1.53**, mevcut kimlik doğrulamalı ofis güncelleme kanalında yayımlandı.
Kurulum kullanıcı kontrolünde. Arka uç, veritabanı şeması ve servis yapılandırması değiştirilmedi.

## Değişiklik

Kaydırmayla yüklenen bütün kayıtlar ve sayfa önbelleği korunur. Tablo yalnız görünür
satırları ve iki yöndeki sekizer satırlık kaydırma payını oluşturur. Boşluk satırları
doğal tablo genişliğini, yapışkan başlığı ve kaydırma alanını korur. Görünmeyen satır
düğmeleri için React/DOM ağacı tutulmaz. Yeni bağımlılık eklenmedi.

Gerçek satır yüksekliği ResizeObserver ile ölçülür; uzun metinler kesilmez veya
sabit yüksekliğe zorlanmaz. Ölçülen yükseklikler, mevcut sorgunun kullanıcı/kurum
kapsamındaki bellek önbelleğinde korunur. Sorgu veya kullanıcı değişince geometri
ayrılır; dosya verisi veya geometri tarayıcı depolamasına yazılmaz.

0.1.52 ilk dağıtımından sonraki son kontrolde, çok sayıda uzun satırın seyrek ölçüm
önbelleğindeki ortancayı artırarak önceki ölçülmemiş satırları büyütme riski bulundu.
Ek regresyon testi hatayı önce üretti; 0.1.53 tahmini, ortak doğal minimum yüksekliğe
bağlayarak bu sapmayı düzeltti. 0.1.52 manifesti ve değişmez paketi ayrıca korundu.

Kaydırma sırasında yerinde kalan satırlar yeniden render edilmez. Normal yükseklikte
yeni bir satır, bütün listenin geometrisini yeniden hesaplatmaz; gerçek yükseklik
değişiklikleri işlenir. Odaklanmış satır ve açık ihbar föyünün satırı, görünür alanın
dışına çıksa da korunur. Tab/Shift+Tab sırası, Space/Enter ile seçim/açma, ok tuşları,
Home/End ve PageUp/PageDown desteklenir. Erişilebilir satır sayısı ve indeksleri
korunur. ResizeObserver bulunmayan tarayıcılar doğal tam tabloyu kullanır.

## Aynı bilgisayarda karşılaştırma

Windows 10 x64, Ryzen 7 7800X3D, yaklaşık 32 GB RAM; Electron 43.7.11 ve Node
24.21.0. Gerçek üretim arayüzü, Electron shell/Touch, Fastify ve ayrı _test
PostgreSQL veritabanında 1.000 sentetik dosya kullanıldı. Eski arayüzün korunmuş
üretim çıktısı ile yeni çıktı aynı sürücüden geçirildi. Gerçek ofis verisi kullanılmadı.
İki tarafta da ana test penceresi görünür tutuldu ve yalnız ölçüm koşumunda arka plan
kısma kapatıldı; aksi halde Windows pencere örtülmesine bağlı olarak RAF'ı durdurabiliyordu.
Ürün kodunun arka plan davranışı değiştirilmedi.

Kaynak ölçümleri, her iş yükünde 3 × 5 saniyenin ortalamasıdır. Bellek tüm Electron
süreçlerinin toplam özel belleğidir; tekil fiziksel RAM değildir. API/PostgreSQL
tüketimi dahil değildir. Çöp toplama ve başlangıç ısınması örnekleri etkiler.

| 1.000 yüklenmiş dosya | Önce | Sonra |
| --- | ---: | ---: |
| Ortalama özel bellek | 560,3 MiB | 347,0 MiB |
| Son özel bellek örneği | 505,3 MiB | 318,3 MiB |
| Sayfadaki DOM öğesi | 40.339 | 1.181 |
| Oluşturulmuş veri satırı | 1000 | 21 |
| Tema değişimi, medyan | 178,0 ms | 12,3 ms |
| Tema değişimi, CPU 4× yavaşlatma | 1.401,1 ms | 60,9 ms |
| Hızlı detay açma, medyan | 55,5 ms | 12,1 ms |

Bu koşumda ortalama özel bellek **%38,1**, DOM sayısı
**%97,1** azaldı. Etkileşimler üçer kez ölçüldü. Süre,
uygulama içi click çağrısından sonraki iki RAF fırsatına kadardır; standart INP veya
animasyonun tamamen bitiş süresi değildir. 4× deney belirli bir eski işlemciye eşit değildir.

| Kaydırma deneyi | Önce P95 kare aralığı | Sonra P95 kare aralığı | Boş kare |
| --- | ---: | ---: | ---: |
| RAF başına 80 piksel, 120 kare | 66,6 ms | 33,4 ms | 0 |
| RAF başına 320 piksel, 120 kare | 33,4 ms | 38,9 ms | 0 |

İki deneyde de ortanca kare aralığı yaklaşık 33,3 ms kaldı. Bu ortam yaklaşık
30 RAF/sn sağladığı için gerçek donanımda 60/180 fps doğrulandığı iddia edilmiyor.
Başlangıç ekranının tam pencere PNG'si eski/yeni koşumda SHA-256 düzeyinde aynıdır.
Touch karakteri, hareket kodu ve karakter CSS'i bayt düzeyinde aynıdır. Görünüm,
animasyon süreleri ve fiziksel piksel çözünürlüğü azaltılmadı. Yeni bir minimum
RAM/donanım sınırı ilan edilmedi; gerçek düşük bellekli cihaz deneyi ayrıca gerekir.

## Doğrulama

- **2.976 benzersiz test geçti:** çalışma alanları 2969, ayrı canlı HTTP koşumu 6, gerçek Windows yayıncı entegrasyonu 1. İlk tam koşum 2968 test geçti; son düzeltmeden sonra değişen ön yüz ve masaüstü paketleri tekrar çalıştırıldı. Son ön yüz/masaüstü sonuçları eski sayılar yerine kullanıldı; tekrarlar toplama eklenmedi.
- Ana koşumda atlanan 6 testten 6 canlı API testi ayrı koşumda geçti. **Kalan atlama: 0.**
- TypeScript, ESLint, üretim derlemesi ve başlangıç paket bütçesi geçti.
- 15 gerçek Electron kontrolü: otomatik 50'lik yükleme, 1.000 dosyada sınırlı DOM, uzun metin yüksekliği, seçim, dosyadan dönüşte iki eksenli kaydırma ve yüklenmiş aralık, gerçek klavye olayları, açık ihbar föyü/odak ve %125–150 yakınlaştırma.
- Windows x64 NSIS paketi üretildi; paket içindeki uygulamanın gerçek açılışı, ofis profili, yerel köprü, tepsi davranışı ve 61 paketli UI dosyasının hash eşleşmesi doğrulandı. Veritabanlı testlerden sonra izole PostgreSQL başlangıçtaki durmuş durumuna döndürüldü.

## Yayın ve eski istemci

- Sürüm: **0.1.53**, win32/x64.
- Yayımlanma: **2026-10-19T04:54:32.219Z**.
- Kurulum boyutu: **105.191.623 bayt**.
- SHA-256: `f180e53ad78129021b8acb95e153a7c332d70797e066f3bde66ea3bbd897c901`.
- Kurulu **0.1.49** istemcisi üretim güncelleme kontrolünde **available → 0.1.53** gördü.
- Kimlik doğrulamalı indirme: HTTP 200, 105.191.623 bayt ve tam SHA-256 eşleşmesi.
- Önceki 0.1.52 manifesti yedeklendi ve değişmez kurulum dosyası korundu; önceki dosyanın hash'i yeniden doğrulandı.
- Ofis servislerinin başlangıç durumları korundu; API sağlıklı. Önceden durmuş dosya ajanının durumu değiştirilmedi. Geçici inceleme dinleyicisi ve doğrulama görevi kaldırıldı.

Yerel kanıtlar Git dışındaki `.local/list-performance-20261018/` klasöründedir:
`performance-proof.json`, `before-results.json`, `after-results.json`,
`before-1000-top.png`, `after-1000-top.png`, `after-zoom-150.png`,
`checks-results.json`, `test-all.log`, `live-tests.log`,
`validation-proof.json`, `package-smoke.json`, `installer.json`,
`publication-proof.json`, `office-update-check-proof.json`,
`final-health-proof.json`. Ön inceleme ve eski ölçümler
`.local/resource-audit-20261018/report.md` içindedir.
