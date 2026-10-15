# Gemini ayarları ve sigorta şirketleri

- Gemini ayarları hem standart anahtarları hem de nokta içeren uzun yetkilendirme anahtarlarını kabul eder. Anahtar yalnız ofis sunucusunda şifreli saklanır. Başarısız kayıt giriş alanını temizlemez; biçim, bağlantı ve sürüm uyuşmazlıkları ayrı açıklanır. Kaydetme, Google kotasının veya yanıt üretiminin doğrulandığı anlamına gelmez.
- Gerçek Gemini kontrolünde `generateContent.responseFormat.text.mimeType` alanının `APPLICATION_JSON` enum değerini istediği doğrulanmıştır. Modelin düşünme ve yoğunluk gecikmeleri için istek sınırı 60 saniyedir; otomatik ücretli tekrar yapılmaz. Kaynak alıntılarının doğrulanması korunur.
- Tarih ve sürüm uyarısı, mevzuat ekranındaki “Tarih ve sürüm bilgilendirmesi” açılır bölümündedir. Geçmiş olay ve poliçe tarihlerine ilişkin kaynak inceleme şartı korunur.
- Açık dosyalarda **Temel Bilgileri Düzenle → Dosya türü** ile Trafik/Kasko düzeltilebilir. Kapalı dosyalarda **Dosya türü seçimi** aynı düzeltmeyi dosyayı yeniden açmadan yapar. Sürüm kontrolü ve önceki/yeni türün işlem kaydı korunur; klasör taşınmaz.
- **Yönetim → Sigorta Şirketleri** yöneticilere şirket ekleme, düzenleme, silme ve silinen şirketi tekrar etkinleştirme sağlar. Silme, referansı pasifleştirir; geçmiş dosya ve anlaşma bağlantılarını kaldırmaz. Eksist dosyasında şirket düzeltmesi incelenmiş alanlara yazılır, ham kaynak metni korunur.
- `0059_active_insurer_catalog`, mevcut ofislere 45 hayat dışı sigorta şirketini ekler; aynı isimli mevcut veya pasif kayıtları değiştirmez. Bu bir tarihli başlangıç kataloğudur, çevrimiçi otomatik güncelleme değildir. Yeni ofislerin kataloğu yönetimden oluşturulabilir.

Kaynaklar (15.10.2026 tarihinde kontrol edildi):

- [SEDDK şirket ve ruhsat listesi](https://seddk.gov.tr/tr/kuruluslar/sigorta-reasurans-ve-bes-sirketleri): bağlantı verilen 11.09.2026 tarihli hayat dışı faaliyet tablosundaki 45 şirket esas alınmıştır. Hayat/emeklilik ve reasürans şirketleri hasar dosyası kataloğuna eklenmemiştir.
- [Google Gemini API anahtarları](https://ai.google.dev/gemini-api/docs/api-key): standart ve yetkilendirme anahtarları.
