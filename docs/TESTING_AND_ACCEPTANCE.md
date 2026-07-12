# HasarBotu V2 — Test ve Kabul Kriterleri

## Genel

Bir görev ancak:

- Kod derleniyorsa
- Type check geçiyorsa
- İlgili testler geçiyorsa
- Ana kullanıcı akışı çalışıyorsa
- Hata ve sınırlar raporlandıysa

tamamlandı sayılır.

## UI prototip kabulü

- Sol menü gerçek sayfa değiştirir
- Tema anahtarı çalışır
- Yoğunluk anahtarı çalışır
- Dosya seçimi sağ paneli günceller
- Çift tık tam dosyayı açar
- Dosya sekmeleri içerik değiştirir
- Kritik modal açılır/kapanır
- Filtre ve arama mock veride çalışır
- 1366×768 kırılmaz
- 1920×1080 alanı verimli kullanır
- Scrollbar görünür
- Açık ve koyu tema tutarlıdır
- Türkçe olmayan etiket kalmaz

## Domain regresyon test seti

Planlanan anonim örnekler:

- 10 Trafik
- 10 Kasko
- 5 PERT
- 5 Değer Kaybı
- 5 Kapanma Ücreti
- 5 İşçilik Excel'i
- 5 Kasko poliçe senaryosu (anonim poliçe fixture'ları)

Kasko poliçe senaryoları en az şunları kapsar: genel + koşullu muafiyet tespiti ("muafiyetsiz" alanına rağmen kloz kaynaklı muafiyet); dört kapsam sonucu (kapsamda/şartlı/kapsam dışı/belirsiz); poliçe ↔ ihbar föyü çelişki üretimi; "poliçede açık hüküm bulunamadı" davranışı; muafiyetli dosya iş akışı adımları (tedarik/mobil onarım engeli, bildirim, görev, portal notu, onaylı kapanış); parça bedelinde KDV hariç + iskontosuz esas ve fiyat kaynağı izlenebilirliği. Gerçek müşteri poliçesi fixture olamaz.

## Kritik yayın engelleyiciler

- Yanlış vakaya veri yazma
- Yanlış plakaya Excel yazma
- Klasör kaybı
- Kapanma ücretini yanlış kesinleştirme
- Değer Kaybı kural sürümü karışıklığı
- Muafiyetli dosyada tedarik veya mobil onarım engelinin atlanması
- Poliçe çelişkisinin kullanıcıya gösterilmeden sessizce çözülmesi
- Audit kaybı
- Yetkisiz erişim
- Yedekten dönememe
- Kritik butonun tek tıkla geri alınamaz işlem yapması

## Test raporu

Her geliştirme paketinde:

- Çalıştırılan komut
- Sonuç
- Başarısız test
- Manuel doğrulama
- Ekran boyutu
- Bilinen risk

raporlanır.
