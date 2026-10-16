# İhbar föyleri

Dosya listesindeki **Klasör / Föy** sütununda bulunan yazıcı simgesi veya dosya içindeki **İhbar Föyü** düğmesi A4 önizlemesini açar. Hızlı detay ve kapanan dosya listesinde de aynı düğme bulunur. Dosya türüne göre trafik veya kasko düzeni seçilir. Türü seçilmemiş dosyada önce dosya türü belirlenmelidir.

Föy her açıldığında güncel dosya, bağlı Eksist kaynağı, güncel araç profili, araç sahibi ve doğrulanmış evrak kayıtları okunur. Trafikte dosyanın plakası ve araç sahipleri mağdur tarafına, kaskoda sigortalı tarafına yerleştirilir. Eksist atama tarihi ekspertiz tarihi olarak kullanılmaz. Kusur, ağır hasar, geçmiş hasar sayısı, rücu ve muafiyet gibi doğrulanmamış alanlar boş kalır. Kaskoda tek ve onaylı poliçe vadesi varsa kullanılır; çelişkili vadelerden otomatik seçim yapılmaz.

Sol taraftan eksik bilgiler, evrak işaretleri ve çalışma notları tamamlanabilir. **Kaydet** veya **Kaydet ve Yazdır** bu ek bilgileri sunucuda dosyaya bağlı saklar. Temel dosya kayıtları değiştirilmez. Bir alanın **Otomatik bilgiyi kullan** düğmesi o alanı yeniden güncel kaynağa bağlar. **Otomatik bilgilere dön** bütün föy düzenlemelerini sıfırlamaya hazırlar; uygulanması için kaydetmek gerekir. Kaydedilmemiş değişikliklerle kapatırken uygulama bilgi kaybını önlemek için sorar.

Yazdırma yalnız seçilen föyü, tek A4 sayfası olarak sistem yazdırma penceresine gönderir. Yazıcıya göre bu pencereden PDF olarak da kaydedilebilir. Sayfayı aşan metin sessizce kesilmez; yazdırma durur ve kullanıcıdan uzun alanları kısaltması istenir. Kaydetme başarısızsa yazdırma başlamaz. Föy ayrı bir Word veya PDF dosyası olarak otomatik olarak çalışma klasörüne yazılmaz.

Okuma ve yazma mevcut `case_read` / `case_write` yetkilerini kullanır. Kapalı dosyaların föyleri salt okunur ve yazdırılabilirdir. Kaydetme sırasında sürüm kontrolü eşzamanlı değişikliklerin ezilmesini engeller. Evrak kutusunun elle işaretlenmesi fiziksel evrak doğrulamasını değiştirmez.

Dağıtımda API, arayüz ve `0061_notice_sheets` veritabanı migrasyonu birlikte uygulanmalıdır. Yeni tablo yalnız ek alanları ve evrak işaretlerini tutar; otomatik kaynakların bir kopyasını kalıcılaştırmaz. Kayıt olayının audit girdisinde alan isimleri ve sürüm bulunur; alanların kişisel veri içeren değerleri bulunmaz.

Regresyon testleri domain eşlemesini, API yetkilerini/kayıt sürümlerini ve arayüz davranışını kapsar. `apps/desktop/test/notice-sheet-print.test.ts` gerçek masaüstü kabuğunda dolu kasko/trafik föylerini PDF'e yazdırır, her birinin tek A4 olduğunu doğrular ve gerçekten taşan notun yazdırılmasını engellediğini kontrol eder. Bu test derlenmiş arayüz ve sonu `_test` olan ayrı bir `TEST_DATABASE_URL` gerektirir.

16.10.2026 tarihinde **0.1.32** sürümü yerel bilgisayardaki ve ofisteki kurulu uygulamaya dağıtıldı. Merkezi API, veritabanı ve ortak güncelleme kaynağı güncellendi. Kurulu ofis uygulamasında gerçek trafik ve kasko dosyalarıyla açma, mevcut değerleri değiştirmeden kaydetme ve yazdırma doğrulandı; her çıktı tek A4 sayfası oldu. Profiller, bağlantı ayarları ve ofisteki oturum korundu. Dağıtım doğrulamaları ve geri dönüş bilgileri için [masaüstü güncellemeleri](DESKTOP_UPDATES.md) belgesine bakın.
