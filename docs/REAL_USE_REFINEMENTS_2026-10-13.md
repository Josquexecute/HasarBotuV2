# Gerçek kullanım düzenlemeleri — 13.10.2026

> Bu tarihsel belgedeki kurum, hesap ve yol adları anonimleştirilmiştir. Gerçek bağlantı değerleri özel ofis yapılandırmasından alınır.

**Durum: PASS — bu revizyon geliştirildi, test edildi ve iki bilgisayara dağıtıldı.** Ana sunucu DESKTOP-EFN2G33, geliştirme bilgisayarı 51793-22893. Masaüstü sürümü iki bilgisayarda **0.1.4**. Ana adres `https://desktop-efn2g33.tail276cda.ts.net`; erişim Tailscale üzerinden sürer.

## Kullanım

- Masaüstündeki **HasarBotu - Ofis.bat** dosyasını açın. Mevcut Google hesabıyla giriş akışı korunur.
- Yeni doğrulanmış **@office.example** Google hesapları yetkisiz, parola gerektirmeyen **Onay bekliyor** kaydı oluşturur. Yönetici **Yönetim → Kullanıcılar → Onayla ve rol ata** üzerinden etkinleştirir; onaydan önce oturum ve iş verilerine erişim verilmez.
- **Yönetim → Servisler**: ad, tür, telefon ve aktiflik düzenlenir. Eşzamanlı eski sürümle yazma reddedilir. Önceki servis kaynak eşleştirmeleri bu revizyonda yapılmadı.
- **Yönetim → Belge Kuralları**: zorunlu ve koşullu evraklar ofise özel sürümlenir. Değişiklik gerçek evrak değerlendirmesinde ve uyarılarda uygulanır. Evrak hash/boyut doğrulaması ve kritik işlem onayları korunur.
- **Yönetim → Erişim ve Yetki**: rollerin işlem izinleri mevcut güvenlik sınırları içinde düzenlenir. Sunucu her istekte güncel izni kontrol eder; açık oturum eski yetkiyle yazamaz. Yönetici yetkileri korunur.
- **Yönetim → İşlem Kayıtları**: kullanıcı, tarih/saat ve işlem filtreleri; sayfalama ve ayrıntılar. İş değişiklikleri, onaylar, dosya görüntüleme/indirme ve kimliği doğrulanmış reddedilen girişimler kaydedilir. Saatler Türkiye saatidir. Kayıtlar uygulamadan değiştirilemez/silinemez; parola, OAuth kodu ve istek gövdesi kayda alınmaz. Her fare hareketi veya arama tuşu olay olarak yazılmaz.

## Değişen davranış

Hızlı not alanı düğmeden ayrı normal akışta yerleşir; dar ekran ve büyütme desteklenir. Kapatıp açmak taslağı korur. Tek kompakt görünüm kullanılır. Asistanın masaüstü ve web kısayolları kartlarla sunulur. Ayarlar hesap/oturum, tema ve açılış tercihlerine odaklanır.

Bildirim kutusu, açılır uyarılar ve operasyon uyarıları yalnız dosyanın **güncel sorumlusuna** gider. Yönetici veya ortak eksper olmak başka sorumlunun bildirimini getirmez. Uyarıyı kapat mevcut gösterilmemiş uyarı kuyruğunu tek işlemde kapatır; okunmamış gelen kutusu korunur, yeni olaylar bildirilir. Gelen kutusu 50 satırlı sayfalara ayrılır.

Arama büyük/küçük harf, boşluk ve Türkçe/İngilizce karakter farklarını karşılar. Durum filtresi Açık/Kapalı; sorumlu filtresi aktif `case_manager` rolündeki herkesi, dosyası olmayanları da gösterir. Takip filtresi kaldırıldı; sıralama alanı ve yön seçimi eklendi. Koyu temadaki yerel açılır listeler ve yazılar düzeltildi. Evrakları aç bağlantısı doğru dosya sekmesine gider.

V1 okuyucusunun `_HASARBOTU/takip.json` ve `HASARBOTU_TAKIP_OZETI.txt` desteği gerçek veritabanı testleriyle doğrulandı. Kaynak evraklara yazılmadı; yeni V1 aktarımı yapılmadı. Kapalı dosyalar, ücretler ve raporların mevcut davranışı korunur.

## Doğrulama

| Alt sistem | Geçen | Atlanan |
|---|---:|---:|
| Ön yüz | 375 | 8 |
| Domain | 572 | 0 |
| Contracts | 291 | 0 |
| PostgreSQL/migrations | 83 | 0 |
| Desktop bridge | 14 | 0 |
| API — ayrı gerçek PostgreSQL | 531 | 0 |
| File Agent | 114 | 0 |
| Desktop — gerçek Electron ve ayrı PostgreSQL | 122 | 0 |
| **Toplam, tekrar koşulan testler hariç** | **2.102** | **8** |

Sekiz ön yüz testi canlı ortam kimlik bilgileri veya ayrı Eksist uçtan uca test yapılandırması gerektirdiği için atlandı; başarılı sayılmadı. Kök test komutunun veritabanı/desktop atlamaları ayrıca izole koşularda tamamlandı. Tarihsel migration geri alma testleri 0051'e kadarki özgün şema üzerinde çalışır; 0052'nin Google hesabını uydurma parolaya dönüştürmeden geri almayı reddetmesi ayrı regresyon testiyle doğrulandı.

Typecheck, tam build, ön yüz paket boyutu sınırı ve x64 NSIS paketi **PASS**. ESLint sıfır hata, önceden bulunan 12 uyarı. Git diff boşluk kontrolü **PASS**. Başlangıç JavaScript toplamı 474.435 bayt, en büyük parça 465.900 bayt; dokuz modül ayrı yüklenir.

Gerçek Electron kabulünde açık/koyu tema, 390 px ekran ve %150 büyütmede not geometrisi; taslak korunması; gerçek API'ye tek not kaydı; dosyası olmayan sorumlu filtresi; 60 sahipli/üç yabancı bildirimde toplu kapatma ve 50+10 sayfalama geçti. Masaüstü menüsünün gerçek pencere, IPC, yerleşim ve kapatma kontrolleri geçti. Bu görsel testler **izole test verisiyle** yapıldı; canlı kullanıcı oturumunda yeni arayüzün elle kabulü bu raporla iddia edilmiyor.

## Canlı dağıtım ve kurtarma

- Dağıtım öncesi yedek 123 tablonun bütün satır/hash değerleriyle ayrı veritabanında doğrulandı. Google e-posta anahtarıyla token kurtarma kontrolü geçti. 0052 ve 0053 önce bu kopyada denendi.
- Canlı servisler kontrollü durduruldu. Migration öncesi/sonrası `pgmigrations` hariç **122 mevcut tablo** birebir korundu; evrak kuralı tablosuna eklenen boş ofis alanı karşılaştırmada eski alanlar üzerinden denetlendi. **399 dosya, 1.454 not, 74 görev ve üç hesap** korundu.
- 6.736 dağıtılan dosyanın tamamı son manifest SHA-256 değerleriyle eşleşti. API ve File Agent aynı servis kimliği/otomatik başlangıç/yol ile Running. Sağlık `ok`, Google etkin, şirket kaydı ofis organizasyonuna bağlı. E-posta bağlantısı yeniden başarılı tarama yaptı, son kontrolünde hata yok.
- İki kurulu istemci 0.1.4, paket `app.asar` hash'i doğru; kullanıcı profili, API adresi, masaüstü ofis başlatıcısı ve kayıtlı köprü adresleri korundu. Gerçek kurulu istemciler UI varlıklarını sundu, ofis HTTPS API'sine iletti, Google etkin durumunu aldı ve anonim dosya erişimini 401 ile reddetti. Geliştirme bilgisayarındaki 51 ön yüz dosyası son build ile birebir eşleşti.
- Dağıtım sonrası yedek **124 tablo** ile tekrar geri yüklendi; bütün satır/hash değerleri ve Google token kurtarma kontrolü geçti. Günlük SYSTEM yedek görevi korunur.
- Eski API/config ofiste `C:\ProgramData\HasarBotu\office-management\real-use-20261013` altında korumalıdır. Önceki masaüstü paketleri iki bilgisayarda saklanır. Otomatik veri kayıplı migration geri alma uygulanmaz.

Kurulum paketi: `apps/desktop/release/HasarBotu-Setup-0.1.4.exe` — x64, 102.641.473 bayt; SHA-256 `9554bc99e2182287e58b430ce7ff9ee451d9a840e684d4a14efa5b320fa93610`.

Kanıtlar `.local/local-tracking-20261011` altında: `refinements-final-tests.log`, `refinements-full-api-test.log`, `refinements-database-test.log`, `refinements-full-desktop-test.log`, `refinements-ui-acceptance.json`, `office-real-use-activation.json`, `office-real-use-runtime-acceptance.json`, `office-real-use-post-release-restore.json`, `local-installed-0.1.4-runtime.json`, `office-installed-0.1.4-runtime.json`. Anahtarlar ve özel yedekler Git dışında korumalı dizindedir.

## Önceki işlerden kalanlar

Belirsiz sorumluların ayrı listesi, kayıtsız/okunamayan kaynak klasör istisnaları ve Windows yeniden başlatma kabulü halen açıktır. Değişen V1 kaynaklarının yeni aktarımı eski hash onayıyla yapılmaz. Bu revizyon kaynak istisnalarının veya tüm projenin tamamlandığı anlamına gelmez.
