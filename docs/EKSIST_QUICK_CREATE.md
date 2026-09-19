# Eksist hızlı dosya oluşturma

Dosya oluşturma formu metin yapıştırmayı, panodan/yüklemeden PNG veya JPEG görseli ve PDF yüklemeyi destekler. PDF metni önce doğrudan okunur; metinsiz sayfalar yerel Türkçe OCR ile okunur. Üç yöntem aynı etiket ayrıştırıcısını ve referans eşleştirmesini kullanır. Kaynaklar dış OCR/AI servisine gönderilmez.

Dosya türü, plaka ve fiziksel klasör standardının gerektirdiği ihbar tarihi kullanıcı tarafından doğrulanır. Eksist atama tarihi ihbar tarihi yerine kullanılmaz. Talep referansı ayrı tutulur. Belirsiz referanslar seçilir veya açıkça eşleştirilmeden kaynakta saklanır. Eksik araç profili kaynakta bırakılıp sonradan tamamlanabilir. Tam şasi/motor, sigortalı, maskeli kimlik ve yıl aralığı bilgileri mevcut alanlara yanlış anlamla taşınmaz. Kaynak metin ve orijinal belge dosya detayındaki **Eksist kaynakları** bölümünden erişilir.

**Kaydet ve detayını aç** ve **Kaydet ve kapat** dosya, kaynak bağlantısı, varsa araç profili, klasör planı ve yetkili iş emrini tek veritabanı transaction'ında oluşturur. İkinci seçenek hasar dosyasını kapatmaz. File Agent mevcut yol, kök sağlığı, freshness ve doğrulama kontrollerini uygular. Arayüz yalnız `ready` sonucundan sonra tamamlanır; ajan çevrimdışıysa bekleyen durum görünür. Hata sonrası aynı anahtar, dosya ve klasör planıyla tekrar denenir. Aynı organizasyondaki Eksist referansı veya kaynak içeriği yeniden dosya oluşturamaz.

Mevcut manuel API ve düzenleme kuralları korunur. Birleşik oluşturma, mevcut fiziksel klasör ve araç profili yetkilerine sahip `admin`, `expert`, `case_manager` rollerini gerektirir. Diğer dosya oluşturma yetkileri genişletilmez; bu kullanıcıların mevcut manuel akışı korunur.

Dağıtımda `0049_eksist_sources` migration'ı uygulanmalıdır. Etkin bir depolama kökü ve çalışan File Agent gereklidir. Yükleme sınırı 10 MB / 10 PDF sayfasıdır. OCR worker'ı süre ve bellek sınırıyla, kurulu Türkçe dil verisiyle çalışır. Belgeler veritabanında kaynak kanıtı olarak saklanır; dosya sistemine kullanıcı kaynaklı yol yazılmaz.

Regresyon testleri: `packages/domain/test/eksist.test.ts`, `services/api/test/eksist.test.ts`, `src/features/cases/CaseCreateModal.eksist.test.tsx` ve `src/features/cases/CaseCreateModal.eksist.integration.test.tsx`. Gerçek API/File Agent testleri `_test` ile biten ayrı bir `TEST_DATABASE_URL` gerektirir. API test paketi test şemasını sıfırlar; üretim bağlantısı kullanmayın. Örnek belge testi `eksist/` içindeki yerel örnekleri okur ve gerçek Eksist hesabına bağlanmaz.

20 Eylül 2026 pilot bulguları, kurulu ortam engelleri ve yedekleme/geri dönüş prosedürü: [Eksist pilot doğrulaması](EKSIST_PILOT_2026-09-20.md). Yerel kontroller geçti; kurulu V2 ortamı ve pCloud sync bulunmadığından dağıtım kabulü henüz verilmedi.
