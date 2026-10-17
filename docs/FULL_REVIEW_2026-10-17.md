# HasarBotu V2 genel kontrolü · 17 Ekim 2026

Durum: **PASS**. Masaüstü **0.1.34**, mevcut kimlik doğrulamalı ofis
güncelleme kanalına yayımlandı. Kurulu 0.1.33 uygulaması yeni sürümü gördü;
tam paket indirmesinin boyutu ve SHA-256 değeri doğrulandı.

## Düzeltilenler

- Sorumlu ve servis filtrelerinde Türkçe karakterlere toleranslı arama,
  klavyeyle seçim, uzun adlar, görünür yükleme/hata/yeniden deneme durumları.
  Yazılan arama metni seçim yapılmadan filtre kimliğini değiştirmez.
- Şirket, tarih veya veri sağlayıcı değiştiğinde eski referans sonucunun
  kullanılması; geç gelen yanıtların yeni seçimi ezmesi; yinelenen referans isteği.
- Dosya listesi, hızlı bakış, detay ve kapanış ekranlarında güncel kimliklerin
  gerçek şirket/sorumlu/eksper/servis adlarına çözülmesi. Tarihsel kaynak
  revizyonları ve servis profilleri korunur.
- İstanbul takviminde pano, görev ve dosya takip tarihleri. Açık liste gece
  yarısında ve cihaz uyandığında güncellenir; yıl geçişi etiketleri düzeltilir.
- Dönem yüklenirken rapor filtresi seçeneklerinin kaybolması.
- Dar ekran menüsünün görünürlüğü, Escape ve klavye odağı, arka planın
  etkileşime kapatılması, masaüstüne dönüşte menü durumunun temizlenmesi.
- Mobil düğme/rapor/tarih alanı taşmaları, giriş ekranının kaydırılması,
  dokunma hedefleri, azaltılmış hareket tercihi ve koyu temada plaka kontrastı.
- Kompakt klasör/föy düğmeleriyle daha kısa dosya satırları; çalışan Ctrl+K
  arama kısayolu. Veriyle bağlantısı olmayan sabit bildirim noktası kaldırıldı.
- Rapor ekranı gerektiğinde yüklenir; başlangıç JavaScript grafiği 485.480
  bayt ile mevcut 500.000 bayt sınırının altında kalır.

## Doğrulama

| Test grubu | Geçen |
| --- | ---: |
| Ön yüz, son tam çalıştırma | 526 |
| Alan kuralları | 651 |
| Sözleşmeler | 304 |
| PostgreSQL yardımcıları | 83 |
| Masaüstü köprüsü | 17 |
| API | 655 |
| Dosya ajanı | 315 |
| Electron | 165 |
| Node dağıtım/işletim betikleri, benzersiz testler | 182 |
| Ayrı çalıştırılan canlı HTTP ön yüz testleri | 6 |
| **Toplam** | **2.904** |

Odaklı tekrar çalıştırmalar toplama eklenmedi. Ana ön yüz çalıştırmasında
atlanan 6 isteğe bağlı test, gerçek yerel API bağlantısıyla ayrıca 6/6 geçti.
Betik çalıştırmasında veritabanı olmadığı için atlanan otomatik klasör keşfi
testi, veritabanlı sürüm doğrulamasında geçti. Entegrasyon veritabanları yerel,
ayrılmış ve adları `_test` ile biten PostgreSQL veritabanlarıdır.

TypeScript, ESLint, üretim derlemesi, paket sınırları ve dağıtım kontrolü geçti.
`npm audit`: 0 güvenlik açığı. Kimlik doğrulamasız 261 API rotası taramasında
tamamı 401 döndü; beklenmeyen veritabanı sorgusu oluşmadı.

Tarayıcıda ana ekranlar ve Trafik/Kasko modülleri 1.440 ve 390 piksel
genişliklerde, açık/koyu temada incelendi. Servis filtresinde uzun ad ve
Türkçe arama doğrulandı. Electron kabul koşumunda 24 kontrol geçti: gerçek
yerel API girişi, filtreler, sayfalama, not taslağının korunması/kaydı,
bildirimler, mobil menü/odak ve plaka kontrastı. Görüntüler özel yerel
kanıt klasöründe saklanır.

## Dağıtım

- Sürüm: **0.1.34**, Windows x64 NSIS; yayımlanma: **2026-10-17T05:50:00.669Z**.
- Boyut: **107.140.726 bayt**.
- SHA-256: `77257eb9a91068fb06c6363318a76628ce28fafab84c3a574588e1ce93f2d4ad`.
- Gerçek paket başlangıcı, paketlenmiş arayüz sunumu, tepsiye küçülme,
  59 arayüz dosyasının eşleşmesi ve ofis bağlantı profili doğrulandı.
- Kurulu 0.1.33 istemcisi: `available`, yayımlanan sürüm 0.1.34,
  kimlik doğrulamalı indirme HTTP 200, tam boyut ve SHA-256 eşleşmesi.
- Önceki 0.1.33 manifesti ve değişmez kurulum paketi korundu; önceki paketin
  dosya özeti yeniden doğrulandı. İstemcilere zorla kurulum yapılmadı.
- İki API rota dosyası doğrulandı; önceki dosyalar yedekli. Çalışan API'nin
  dosya güncellemelerinden sonra başladığı doğrulandı. Şema değişikliği yok.
- API, dosya ajanı, klasör keşfi ve HTTPS servisleri çalışıyor. Yeniden başlatma
  sonrası keşif çevrimi PASS: 611 klasör, 0 ertelenen. Geçici görevler ve
  hata ayıklama dinleyicileri kaldırıldı.

## Sunucu belleği ve sınırlar

pCloud'un 55.210.086.400 bayt özel bellek ayırmasıyla aynı dönemde API ve
klasör keşfinde bellek yetersizliği çökmeleri gözlendi. Kullanıcının açık
onayıyla pCloud aynı kullanıcı oturumunda yeniden başlatıldı; dosya, önbellek
ve yapılandırma silinmedi. Son sağlık kontrolünde özel bellek 239.382.528
bayttı ve yeniden başlatmadan sonra HasarBotu servis çökmesi kaydedilmedi.
Bu işlem pCloud'un aşırı bellek tüketimi için kalıcı bir ürün düzeltmesi değildir.

Kritik iş akışları anonimleştirilmiş yerel verilerle doğrulandı. Gerçek dosyalar
üzerinde dış e-posta gönderimi, ödeme veya hasar kararı uygulanmadı. Paket
başlangıç testi yalıtılmış oturumdadır; ofis güncelleme kontrolü ve indirme ise
mevcut gerçek kullanıcı oturumuyla yapıldı. Bu rapor sınanan kapsamı belgeler;
her olası kullanıcı/veri birleşiminin hatasız olduğunu iddia etmez.

Kanıtlar (Git dışında): `.local/full-review-20261016/`; ana kayıtlar:
`validation.json`, `frontend-final.log`, `live-tests-final.log`,
`tools-tests.log`, `package-results.json`, `package-smoke.log`,
`ui-evidence/refinements-ui-acceptance.json`, `backend-proof.json`,
`publication-proof.json`, `office-update-check-proof.json`,
`pcloud-restart-proof.json`, `final-health-proof.json`.
