# Arayüz ve hızlı not — 0.1.3

## Değişiklikler

- Araç profilinde marka, model, yıl ve sınıf ana görünümde. Varyant, motor kodu,
  şasi ön eki ve kanıt bilgileri kapalı **Teknik bilgiler** bölümünde. Mevcut
  değerler normal düzenlemelerde korunur; veri silme veya şema değişikliği yok.
- Kullanılmayan genel dosya asistanı kaldırıldı. Geçmiş sekmesi gerçek not ve
  operasyon kayıtlarını gösterir. Dosya listesindeki işlevsiz seçim kutuları
  kaldırıldı; seçili satır vurgulanır.
- Touch Assistant: açık dosyaya, liste ekranında seçili satıra hızlı not.
  İkinci dosya seçimi yok. Masaüstü yardımcısında **Hızlı not** menüsü de aynı
  paneli açar. Kayıt sonrası detay ekranı Operasyon sekmesine geçer ve yenilenir.
- Not metni dosya ve kullanıcı bazında taslak olarak saklanır. Yanıt kaybında
  tekrar aynı istek anahtarıyla yapılır. Başarı yalnız API yanıtından sonra gösterilir.
- Mobil menü, dar ekran formları, dokunmatik kontrol boyutları ve pencere alt
  boyut sınırı düzenlendi. Ayarlardaki örnek klasör/sistem bilgileri üretimde
  kaldırıldı; başlangıç sayfası tercihi açılışta uygulanır.

Durum Panosu, Dosyalar, Kapanan Dosyalar, Raporlar ve Ücretler, Mevzuat,
Bildirimler, Yönetim ve Ayarlar kaynak üzerinden incelendi. Gerekli olmayan
teknik etiketler azaltıldı; bağlı olmayan mevzuat kütüphanesi açıkça kullanılamaz
görünmeye devam eder. Görsel ve gerçek kullanım kabulü aşağıdaki listeyle yapılır.

## Doğrulama durumu

- Son odaklı birim testleri: **27/27 PASS** (App, TouchAssistant, StartupPage).
- UI ve bütün workspace build'leri: **PASS**.
- Önceki oturumda not/yaşam döngüsü/kayıt/Eksist/workspace API testleri:
  **38/38 PASS**, ayrı test veritabanında.
- Önceki geniş UI koşusunun tek hatası kaldırılan asistanın eski beklentisiydi;
  güncellenen App testi son odaklı koşuda geçti. Geniş koşu tekrar çalıştırılmadı.
- Kullanıcı talimatıyla gerçek Electron, cihaz ve uçtan uca kabul testleri
  **BEKLİYOR**. Bunlar başarılı kabul edilmedi.

## Kullanıcı kontrol listesi

1. Bir dosya açın. Hızlı not panelindeki plaka/dosya numarasını kontrol edin;
   notu kaydedin. Operasyon sekmesinde hemen göründüğünü doğrulayın.
2. Dosya listesinde başka satır seçin. Masaüstü yardımcısının **Hızlı not**
   komutunu kullanın. Notun yalnız seçili dosyaya eklendiğini kontrol edin.
3. Programı kapatıp açın; iki dosyanın notlarını tekrar okuyun.
4. Teknik bilgileri dolu araçta yalnız model bilgisini düzenleyip gerekçeyle
   kaydedin. Teknik bilgileri açıp eski değerlerin korunduğunu kontrol edin.
5. Kayıt sırasında bağlantı kesintisini test ortamında deneyin. Aynı panelde
   **Kaydı tekrar dene** işlemiyle tek not oluştuğunu kontrol edin.
6. Kayıt, Eksist aktarımı, servis revizyonu, kapatma/yeniden açma akışlarını
   test dosyasında uygulayın; tekrar açınca değerleri kontrol edin.
7. Her kategoriyi dar pencerede ve dokunmatik cihazda açın. Menü, sekmeler,
   kaydırma, düğmeler, metin girişi ve klavye ile kapatmayı kontrol edin.
8. Ayarlarda açılış sayfasını değiştirip programı yeniden açın; daha sonra
   Durum Panosu'na normal navigasyonla dönebildiğinizi kontrol edin.

## Paket ve geri dönüş

Paket: `apps/desktop/release/ui-cleanup-20260927/HasarBotu-Setup-0.1.3.exe`.
Windows x64 uygulaması; kurulum paketi imzasızdır. Paket otomatik kurulmaz.
Mevcut API adresi ve başlatma ayarları kullanılmalıdır; bu kurulum API,
PostgreSQL veya File Agent servislerini kurmaz/güncellemez.

Kurulumdan önce uygulamayı kapatın. Çalışan sürümün kurulum paketini ve
başlatıcısını saklayın. Mevcut yedekleme prosedürüyle PostgreSQL yedeğini,
dosya depolama alanını ve servis yapılandırmasını aynı tarihli bir klasöre
alın; yedeğin ayrı test veritabanına açılabildiğini doğrulayın.

Geri dönüşte uygulamayı kapatıp saklanan önceki masaüstü paketini kurun ve
önceki başlatıcı/API adresini kullanın. Bu sürüm veritabanı şemasını değiştirmediği
için yalnız arayüzü geri almak amacıyla veritabanını eski yedeğe döndürmeyin;
bu, sonradan eklenen not ve kayıtları kaybettirebilir. Veri geri yüklemesi
gerekiyorsa mevcut verinin ayrıca yedeğini alıp önce ayrı ortamda doğrulayın.
