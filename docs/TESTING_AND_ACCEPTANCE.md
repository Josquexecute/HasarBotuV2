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
- Anonim Kasko poliçe senaryoları (aşağıdaki 12 zorunlu senaryo)

Zorunlu anonim Kasko senaryo testleri:

1. Genel alan muafiyetsizken özel klozun koşullu muafiyet doğurması
2. Poliçeye uygun servis değişikliğinde durdurmanın (engelin) kalkması
3. Serviste kalındığında poliçe kaynaklı maliyet paylaşımının uygulanması
4. Genel ve koşullu muafiyetlerin birlikte değerlendirilmesi
5. Mini onarım mevcutken mobil onarımın durdurulmuş olması (iki kavramın ayrı modellenmesi)
6. Trafik değer kaybının zorunlu, Kasko değer kaybının ofis kuralı olması
7. Pert Kasko dosyasında değer kaybının "Uygulanamaz" olması (gerekçeli)
8. İhbar fişi, poliçe ve zeyil çelişkisinin gösterilmesi (sessiz çözüm yok)
9. KDV hariç iskontosuz liste bedeli ile gerçek satın alma bedelinin ayrılması
10. AI kaynak bulamadığında kesin karar vermemesi ("açık ve doğrulanabilir hüküm bulunamadı")
11. AI bütçesi dolduğunda temel uygulamanın çalışmaya devam etmesi
12. Yedek var görünürken geri yükleme doğrulamasının başarısız olması (yedek kanıtı ≠ dosya varlığı)

Gerçek müşteri poliçesi veya gerçek poliçe PDF'i fixture olamaz.

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
