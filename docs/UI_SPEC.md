# HasarBotu V2 — UI Şartnamesi

## Görsel dil

- Dense functionalist
- Profesyonel masaüstü uygulaması
- Hafif yuvarlak köşeler
- İnce nötr sınırlar
- Fazla kart ve boşluk yok
- Anlamlı ikonlar
- Türkçe arayüz
- Gerçek müşteri verisi yok

## Tema

### Açık

- Arka plan: nötr açık gri
- Panel: beyaz
- Metin: siyaha yakın
- Sınır: açık nötr gri

### Koyu

- Arka plan: `#0D0D0E`
- Panel: `#171719`
- Yükseltilmiş yüzey: `#212124`
- Metin: kırık beyaz

### Vurgu

- Ana mavi: yaklaşık `#2563EB`

## Boyutlar

- Gövde: 14 px
- Tablo: 13 px
- İkincil metin: 12 px
- Bölüm başlığı: 16–18 px
- Sayfa başlığı: 22–24 px
- Plaka: 20–24 px

## Yoğunluk

- Kompakt
- Rahat

Varsayılan Kompakt.

## Navigasyon

- Daraltılabilir sol menü
- Aktif sayfa mavi vurgu
- Dar görünümde tooltip
- Üst bar: arama, bildirim, tema, yoğunluk, kullanıcı, bağlantı durumu

## Etkileşimler

- Tek tık: sağ hızlı detay
- Çift tık / Enter: tam dosya
- Geri dönüşte filtre, sıralama ve scroll korunur
- Kritik eylemler modal onayı ister
- Görsel butonlar işlevsiz bırakılmaz
- Loading, empty, error durumları tasarlanır

## Performans

- 100+ fotoğrafta lazy loading
- Liste satırlarında en fazla 3 thumbnail
- Büyük tabloda sanallaştırma değerlendirilebilir
- Her filtre değişiminde gereksiz tam render yapılmaz

## Zorunlu ekran testleri

- 1366×768
- 1920×1080
- Açık tema
- Koyu tema
- Sol menü açık
- Sol menü kapalı
- Uzun tablo
- Uzun not
- 100+ fotoğraf
- Sağ AI paneli açık/kapalı

## Kasko poliçe analiz çalışma alanı

- Mevcut `Evrak ve Fotoğraf` sekmesi korunur; Kasko vakada PDF/OCR hazırlığı ile poliçe analiz akışı aynı dikey çalışma alanında görünür.
- Akış adımları kompakt olarak `Kaynağı seç ve planla → Analizi başlat → Adayları incele → Taslağa uygula` biçiminde gösterilir.
- Kaynak seçimi checkbox ile klavye erişilebilir olmalı; boş seçim plan butonunu devre dışı bırakmalıdır.
- Candidate kartında provider değeri, insan kararı, koşul/istisna, confidence, kaynak kalitesi ve güvenli kanıt açma eylemi birlikte görünür.
- Kanıt dialogu masaüstü yoğunluğunu korur; bounded excerpt ve güvenli metadata görünür, uzun kimlikler satır kırar, Escape ile kapanır.
- Promotion sonrası yeni Paket 23 analiz sürümü sayfa yenilenmeden aynı çalışma alanında gösterilir. Taslak uygulama ile nihai insan onayı görsel ve metinsel olarak ayrılır.
