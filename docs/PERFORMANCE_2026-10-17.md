# Akıcılık ve kaynak kullanımı · 17 Ekim 2026

Durum: **PASS**. Sürüm **0.1.35**, mevcut kimlik doğrulamalı ofis güncelleme
kanalında. Kurulu 0.1.33 istemcisi sürümü gördü ve paketi tam boyut/SHA-256
eşleşmesiyle indirdi. Kurulum kullanıcı kontrolünde bırakıldı.

## Değişiklikler ve nedenleri

- Touch boşta ekranın her yenilemesinde uyanıyordu. Yerleşmiş poz artık
  uyur; motorun gecikmeli göz kırpma/ifadeleri 8 Hz'de denetlenir. Etkileşim
  hemen uyandırır; yalnız hareket eden pozlar çizilir. Gizlenen veya hareketi
  azaltılmış karakterin döngüsü durur.
- Değişmeyen imleç konumu için yinelenen IPC kaldırıldı. DPI ve Canvas
  boyutları kare başına ölçülmek yerine yeniden boyutlandırmada güncellenir.
- Aktif çizim tavanı 30'dan 60 kare/sn'ye çıkarıldı. Kesirli zaman damgaları
  yüzünden 60 Hz'de kare atlanması ve 144 Hz'de zamanlama kayması düzeltildi.
- Hızlı işlem penceresinin React arayüzü ilk istekte yüklenir. Sonraki
  açılışlar aynı pencereyi kullanır; not taslakları ve seçimler korunur.
- Pencere, mobil menü, açılır liste, detay paneli ve düğmelere 120–180 ms
  geçişler eklendi. Panel hareketleri opacity/transform kullanır; sürekli
  will-change katmanı oluşturulmaz. Sistemin azaltılmış hareket tercihi korunur.
- Karakterin renkleri, göz kontrastı, fiziksel piksel çözünürlüğü ve güvenlik
  sınırları korunur. Yeni bağımlılık eklenmedi.

## Aynı bilgisayardaki ölçümler

Electron 43.7.11, Windows x64. Her durum için 3 × 5 saniyelik örnek
ortalaması. Ana pencere başlangıçta gizli, Touch görünür, hızlı işlem paneli
henüz açılmamış. Hareketli durumda aynı yapay imleç yolu kullanıldı.
Bu istemci ölçümü gerçek hasar dosyası yükünü ve ofis sunucusu tüketimini kapsamaz.

| Ölçüm | Önce | Sonra |
| --- | ---: | ---: |
| Boşta toplam süreç CPU yüzdesi | %0,316 | %0,081 |
| Boşta toplam özel bellek | 388,1 MiB | 326,5 MiB |
| Boşta toplam çalışma kümesi | 630,4 MiB | 507,6 MiB |
| Boşta RAF çağrısı / 5 sn | 902,7 | 53,7 |
| Sabit imleçte gaze mesajı / 5 sn | 54,0 | 0,0 |
| Hareket sırasında CPU | %0,681 | %0,681 |
| Hareket sırasında gözlenen çizim hızı | 26,6 kare/sn | 30,2 kare/sn |

Boşta CPU yaklaşık **%74,3**, başlangıç özel belleği
**61,6 MiB** azaldı. Bellek kazanımı,
henüz kullanılmamış panelin ertelenmesini içerir; panel açıldıktan sonra durumunu
korumak için bellekte kalır. İlk panel içeriğinin hazırlanması bu örnekte yaklaşık
361 ms sürdü. Sonraki açılışlarda sayfa yeniden yüklenmez.

Bu ölçüm ortamında bağımsız yerel RAF kontrolü de 30 kare/sn sağladı:
5 saniyede 150 yerel kareye karşı 150 çizim.
Bu yüzden gerçek koşum için 60 kare/sn iddiasında bulunulmuyor. 60/144 Hz
zaman damgalarıyla yapılan regresyon testleri, uygun kareler sağlandığında
çizimin 60 kare/sn civarında kalmasını ayrıca doğrular.

GPU hızlandırması inceleme başında zaten açıktı; Canvas, rasterizasyon ve
birleştirme durumları son ölçümde de enabled. Durumlar Electron'un
[GPU durum API'si](https://www.electronjs.org/docs/latest/api/app#appgetgpufeaturestatus)
ile okundu. Bellek sayaçları [Electron MemoryInfo](https://www.electronjs.org/docs/latest/api/structures/memory-info)
birimlerinden MiB'ye çevrildi. Çalışma kümelerinin toplamı paylaşılan sayfaları
içerebilir; tekil fiziksel RAM ölçümü değildir. Sonuçlar bu kısa örneklemin
ölçümüdür; her bilgisayar ve iş yükünde aynı yüzdeyi garanti etmez.

## Doğrulama ve dağıtım

**2.912 benzersiz test geçti:** ön yüz 526, alan kuralları 651, sözleşmeler
304, veritabanı 83, masaüstü köprüsü 17, API 655, dosya ajanı 315,
masaüstü 173, Node işletim/dağıtım betikleri 182, ayrı canlı HTTP testleri 6.
Odaklı tekrarlar toplama eklenmedi. Ana koşumdaki 6 isteğe bağlı ön yüz testi
ayrı canlı API koşumunda geçti. Node koşumunda veritabanı olmadığı için atlanan
keşif testi, veritabanlı sürüm doğrulamasında geçti.

TypeScript, ESLint, üretim derlemesi ve paket sınırları geçti. Son değişiklikten
sonra ön yüz yeniden derlendi ve masaüstü testlerinin tamamı tekrar geçti.
Gerçek Electron kabul koşumunda 27 kontrol; menü, odak, azaltılmış hareket,
renkler, DPI, not taslakları, sayfalama ve güvenlik sınırları doğrulandı.
Kurulum paketi gerçekten başladı; 59 arayüz dosyası ve ofis profili eşleşti.

- Windows x64 NSIS: **0.1.35**, **107,141,484 bayt**.
- SHA-256: `14612910ce6b25064f78353cf56c605ecf79b8be2af4d64a6af0b428993cec58`.
- Yayımlanma: **2026-10-17T06:26:19.761Z**.
- Kurulu 0.1.33: available → 0.1.35; kimlik doğrulamalı indirme
  HTTP 200, tam boyut ve SHA-256 eşleşmesi.
- Önceki 0.1.34 manifesti ve değişmez kurulum paketi korundu; önceki dosyanın
  SHA-256 değeri yeniden doğrulandı. API dosyaları değişmedi; şema göçü yok.
- Dört ofis servisi çalışıyor, API sağlıklı, klasör keşfi PASS. Geçici doğrulama
  görevi ve hata ayıklama dinleyicisi kaldırıldı.

Yerel kanıtlar Git dışındaki `.local/smooth-20261017/` klasöründedir:
`final-performance-summary.json`, `baseline-comparison.json`,
`after-final-comparison.json`, `cadence-proof.json`, `validation.json`,
`final-validation.json`, `desktop-final.log`, `tools-tests.log`,
`live-tests-driver.log`, `ui-evidence-final/`, `package-results.json`,
`package-smoke.log`, `publication-proof.json`, `office-update-check-proof.json`,
`final-health-proof.json`. Dağıtılan yerel paket `release-final/` içindedir.
