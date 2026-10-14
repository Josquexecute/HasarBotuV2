# Mevzuat ve AI Yardımcısı — 0.1.13

Gerçek API ekranı kaynak kütüphanesi, kaynak türü/başlık filtresi, sayfa ve ek görüntüleme, kaynak taraması, Gemini ile kaynaklı inceleme ve hesaba özel son 20 incelemeyi sunar. Touch asistanın dikey fare takibi de düzeltildi; gerçek Electron çiziminde dört yön doğrulandı.

## Kaynaklar ve kapsam

14 Ekim 2026'da resmî sitelerden indirilen 7 kaynak grubu: 2918, 6102, 6098 sayılı kanunlar; trafik, kasko, ihtiyari mali sorumluluk genel şartları; trafik genel şartlarının Ek 1–7 arşivi. Toplam 679 PDF sayfası ve 7 DOCX eki. Her kaynakta özgün dosyanın SHA256 değeri, yayıncı, doğrulama tarihi ve resmî bağlantı bulunur. DOCX ek numarası PDF sayfası gibi gösterilmez.

[SEDDK genel şartlar dizini](https://seddk.gov.tr/tr/mevzuat/sigortacilik/genel-sartlar) ve [Mevzuat Bilgi Sistemi trafik genel şartları](https://www.mevzuat.gov.tr/MevzuatMetin/yonetmelik/9.5.20752.pdf) esas alınmıştır. Trafik metni 12 Haziran 2026 değişikliğini ve 1 Temmuz 2026 yürürlük notunu içerir. Arşivde her tarih için eski sürüm bulunduğu iddia edilmez; olay/poliçe tarihine uygulanacak metin kullanıcı tarafından incelenir.

Kaynak taraması birebir metindir. AI yanıtı ayrıca etiketlenir ve kullanılan model kaydedilir. AI'nın kaynak kimliği ve birebir alıntısı sunucuda doğrulanır; geçersiz dayanak, tamamlanmamış yanıt veya sağlayıcı hatası başarıya çevrilmez. Bu doğrulama, AI yorumunun hukuken doğru olduğunun garantisi değildir. Dosya türü, kusur, ödeme veya süreç kararı otomatik değiştirilmez.

## Gemini kurulumu

Yetkili ofis yöneticisi uygulamada **Mevzuat ve AI Yardımcısı → Gemini bağlantı ayarları** bölümünden mevcut [AI Studio anahtarını](https://aistudio.google.com/api-keys) girip kaydeder. İlk model `gemini-3.8-flash`; hesapta erişilebilen Gemini model kimliği ayardan değiştirilebilir. Anahtar sohbete, Git'e veya tarayıcı depolamasına yazılmaz; yalnız sunucuya kimlikli PUT ile gönderilir, ofise bağlı AES-256-GCM ile şifrelenir ve yanıtlarda gösterilmez. Sunucu mevcut `GOOGLE_TOKEN_ENCRYPTION_KEY` anahtarını kullanır; yedek kurtarmada bu anahtar da korunmalıdır.

Kaynak taraması anahtarsız çalışır. Gemini modu soruyu ve resmî kaynak alıntılarını Google'a gönderir; özel dosya belgeleri otomatik aktarılmaz. Kullanıcı soruya kişisel bilgi yazmamalıdır. Gerçek anahtar/sağlayıcı kabulü tamamlanana kadar canlı AI kabulü **PENDING** kalır; test sağlayıcısı gerçek Gemini kabulü sayılmaz.

## Kaynak yenileme

`node scripts/refresh-legislation-catalog.mjs` yalnız sabit resmî adresleri okur; PDF/ZIP imzasını ve kaynak başlığını doğruladıktan sonra `catalog.generated.ts` üretir. Ardından API build/test/deploy uygulanır. Üretilen katalog elle değiştirilmez. Son 14 günde doğrulanmamış kaynak karar desteğinde kullanılmaz; ekran dayanak bulunamadığını açıkça bildirir. Eski inceleme alıntıları ve özetleri saklanır; farklı hash taşıyan yeni metin, eski dayanakmış gibi açılmaz.

## Doğrulama

- API: 592 test PASS; gerçek PostgreSQL'de kimlik, yetki, ofis/hesap ayrımı, eşzamanlı ayar kaydı, şifreleme, kaynak reddi ve audit geri alma dahil.
- Ön yüz: 409 PASS, mevcut canlı bağlantı gerektiren 8 test SKIP.
- Desktop: 139 PASS. Paketlenmiş UI için ayrıca 8 gerçek Electron kontrolü PASS; bu kontrol sentetik `_test` veritabanı ve test sağlayıcısı kullanır.
- Typecheck, ilgili ESLint, tam build, başlangıç bundle sınırı ve x64 NSIS doğrulaması PASS.
- Kurulu 0.1.13 iki bilgisayarda özgün profiller ve gerçek HTTPS API ile doğrulandı; 54 UI dosyası ve asar hash'i eşleşti. Paylaşılan sürüm yayınlandı.
- Önceki Windows yeniden başlatma ve gerçek hesap bildirim kabulü kullanıcının önceki doğrulamasıdır; yeni mevzuat ekranının gerçek Gemini/hesap kabulü olarak gösterilmez.

Installer SHA256: `cff5dce09154ffe81978eef5ed14cb3986c64267d18a9f74dadff9e085eff9e0`.

Ofis temel dosya/not/bildirim kullanımına hazırdır. Son kaynak kontrolünde 596/596 plakalı klasör bağlı, 611 dosya, 1.548 not, 44 **Seçiniz**, 0 sorumlusuz dosya vardır. Bu sürümde 51 tarihsel not, 4 tamamlanmış görev ve 5 tarihsel kapanış aktarıldı; eski notlar, türler ve sorumlular korundu. Güncel V1 planında uygulanabilir iş kalmadı. Kayıtlı, türü belirsiz üç dosyanın beş notu tür değiştirilmeden ve pCloud kimliğiyle doğrulanarak aktarıldı.

7 kaynak istisnası ayrı kalır: iki gerçek Trafik/Kasko kanıt çatışması, bir V1 türü/Seçiniz uyuşmazlığı, bir türü belirsiz kaynak ve üç geçersiz klasör adı. Geçersiz üç kaynaktaki beş not için değişmez kimlikle eşleşen program dosyası veya kayıtlı kaynak bağlantısı bulunamadı; notlar rastgele dosyaya eklenmedi. Bu istisnalar tamamlanmış evrak doğrulaması sayılmaz. Kaynakta daha sonra yapılan ekleme/taşımalar ayrıca taranır; otomatik yeni dosya oluşturma izleyicisi eklenmemiştir.
