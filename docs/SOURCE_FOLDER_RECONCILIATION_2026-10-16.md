# Kaynak klasör eşleştirmeleri — 16 Ekim 2026

**PARTIAL:** İlk kontrolde bulunan 33 sorunlu kaydın 22'si onarıldı; kullanıcıca gerçek olmadığı teyit edilen bir kayıt geçmişi korunarak arşivlendi. Son dosya sistemi/pCloud denetiminde 637 görünür kaydın 627'si doğru kaynak klasörüne bağlı. 616 farklı plakanın tamamında en az bir eşleşen kaynak klasör var. Kalan 10 eski kaydın ayrı ihbar kimliği netleşmeli; bunlar başarılı sayılmadı.

## Neden ve düzeltmeler

- Taşınmış 18 klasörün bağlantısı onarıldı: 15'i aynı kalıcı pCloud klasör kimliğiyle, üçü V1'in değişmeyen kaynak kimliğiyle doğrulandı. Kayıt sürümü, önceki yol, hedef sahipliği ve mevcut işlem kontrollerinden sonra normal konum geçmişi ve Agent doğrulama işi oluşturuldu. Yaşam döngüsü klasörün fiziksel konumundan türetilerek değiştirilmedi.
- İki plaka, aynı pCloud klasör kimliği ve ruhsat görüntüsüyle doğrulanarak düzeltildi. Mevcut dosya kimlikleri korundu.
- Bir kayda, ruhsatla doğrulanan ve başka dosyaya bağlı olmayan mevcut klasörü normal konum atamasıyla bağlandı.
- Bir gerçek ihbarın kaynağı sigorta dosya numarası ve hasar tarihiyle doğrulandı. Aynı kaynağa ait otomatik mükerrer kayıt arşivlendi; dört takip kaydı ve dört bildirim asıl kayda taşındı. Kimlikleri ve dört belge gözlemi korundu. İşlem önce gerçek transaction içinde denenip geri alındı; canlı uygulamada aynı veriler yeniden karşılaştırıldı. Asıl kaydın iş alanları değişmedi.
- Sigortacı adıyla başlayan fiziksel klasörler ortak plaka ayrıştırıcısında desteklendi. Sigorta etiketi ve tek tam plaka gerekiyor; birden fazla plaka, eksik/taşan plaka ve ilgisiz önek reddediliyor. Derlenen aynı dosya API ve File Agent'a yedekli olarak dağıtıldı.
- Kontrol sırasında iki kayıtlı kaynak yeniden taşındı. Otomatik servis `yearFolder` kapsamını hem yeni kayıt hem mevcut kaynak takibi için kullandığından başka iş grubundaki taşımaları kaçırıyordu. Yeni kayıtların kapsamı korundu; `trackRegisteredMoves` açıkken kayıtlı pCloud kimlikleri diğer yıl/iş grubu klasörlerinde de izleniyor. Aynı kimlik, kayıp eski yol, iki tutarlı gözlem ve aktif işlem bulunmaması koşulları korunuyor. Servis güncellemeden sonra iki gerçek taşımayı normal transaction ve Agent doğrulamasıyla tamamladı. 639 dosya satırı, 1.577 not, 78 görev ve diğer konumlar değişmedi; yeni dosya açılmadı.

Başlangıçta 639 görünür kayıt vardı. Bir otomatik mükerrer kaydın ve kullanıcıca gerçek olmadığı teyit edilen bir kaydın arşivlenmesiyle görünür toplam 637 oldu. Gerçek olmayan kayıt için de transaction provası/geri alma yapıldı ve 93 tablodaki ilişkiler kontrol edildi; satır kimliği ve geçmiş korundu. Kullanıcı evraklarına yazılmadı. İşlem öncesi kayıtlar, kaynak belge hash'leri, prova ve canlı sonuçlar korumalı denetim dizininde tutuluyor; özel kayıt dökümleri Git'e eklenmedi.

## Aynı plaka ve kopyalanmış evrak

Aynı plaka farklı kazalarda, paylaşımlı kusur nedeniyle farklı sigorta ihbarlarında ve kopyalanmış evrak klasörlerinde bulunabilir. Plaka eşitliği, ortak araç evrakları veya kopyalanmış V1 kaynak/not kimlikleri tek başına birleştirme nedeni sayılmaz. İhbar ayrımı sigorta şirketi, sigorta dosya numarası, hasar tarihi ve doğrulanmış kaynak geçmişiyle değerlendirilir.

Şirket kökünde 42 aynı plaka grubu, 85 fiziksel klasör ve 44 klasör çifti pCloud içerik sürümü/boyut/göreli yol bilgileriyle karşılaştırıldı. İki çiftin evrak listesi eşleşiyor; ayrı sigorta ihbarı olabileceği için otomatik birleştirilmedi. `_EKSİK DOSYALAR` içindeki farklı sigorta klasörleri ve diğer kaynak kopyaları korundu. Bu karşılaştırma bir kopya adayı bulma işlemidir; aynı ihbarın kesin ispatı değildir.

## Açık kalanlar

On eski kaydın plakasına uyan kaynaklar başka dosyalara bağlı. Tür çelişkileri veya birden fazla aynı plakalı dosya nedeniyle yalnız plaka eşitliğiyle bağlama/birleştirme yapılmadı. İlk V1 aktarım zaman aralığı doğrulandı. Üç eski kayıttaki toplam 15 notun kaynak kimliği yeni kayıtlardaki kimliklerle eşleşiyor; eski tür Trafik, yeni tür Kasko. Bu iz tek başına dosya türünü veya ayrı ihbar ayrımını çözmüyor. Notlar ve geçmiş korunuyor.

Kaynağı hiç bulunamayan diğer eski kaydın gerçek olmadığı kullanıcı tarafından harf sırası netleştirilerek teyit edildi ve kayıt arşivlendi; boş klasör veya tahmini tarih üretilmedi.

## Doğrulama

- Domain: **651/651 PASS**, yeni önek regresyonları dahil. Olumlu regresyonlar düzeltme öncesinde başarısızdı.
- Gerçek ve ayrı PostgreSQL test veritabanında klasör kayıt/keşif testleri: **29/29 PASS**.
- Gerçek PostgreSQL, SQLite ve dosya taşıma kullanan arka plan keşif regresyonu: **1/1 PASS**. Kapsam dışına taşıma testi düzeltme öncesinde başarısızdı. Eski yol mevcutken reddetme, dosya alanlarını koruma ve kapsam dışındaki yeni kaynaklardan dosya açmama kontrolleri dahil.
- ESLint, tüm uygulama/workspace derlemeleri, ön yüz paket sınırı kontrolü ve `git diff --check`: **PASS**.
- Son canlı kontrol: 22 onarılmış konumun tamamı `verified`, bu kayıtlarda aktif fiziksel işlem yok. Denetlenen kayıt sürümleri ve yollar değişmemiş.
- Dört ofis servisi çalışıyor; API sağlık isteği HTTP 200. Daha önce bildirilen kapanış `closed / ready / succeeded` olarak korunuyor.
- Dağıtılan API ve Agent ayrıştırıcı SHA-256 değeri aynı: `497423bcb084bcc5ad662e0b55f8079640e6fed4120d1cc25fb35c5423e5546a`.
- Dağıtılan keşif servisi SHA-256: `b86c64a5efcd30723c3e8acd0132393458332b6dd20b1d51555790d4462334bd`. Önceki çalışan sürüm yedeklendi; politika/yapılandırma değişmedi. Yalnız keşif servisi yeniden başlatıldı. Windows servis/depolama yapılandırma kontrolü **PASS**.

Son kaynak kanıtı taraması **PASS**: 627 vaka ve 40.210 evrak kaydı kontrol edildi; taşınan iki vaka için 183 kaynak belgesinin kanıtı yenilendi, bekleyen kaynak kalmadı. Kaynak ve hedef evraklarına yazılmadı; güvenlik kontrolü atlanmadı. Görev çıkış kodu 0. Sonuç `%ProgramData%/HasarBotu/office-management/source-refresh/latest.json` dosyasındadır. Bu içerik kanıtı taraması ile konum/plaka eşleştirme denetimi ayrı sonuçlardır.

Yerel korumalı kanıtlar: `.local/source-folder-audit-20261016/`. Aranabilir güncel rapor: `Klasor-Eslesme-Raporu.html`. Ofis kopyası: `%ProgramData%/HasarBotu/office-management/source-folder-audit-20261016/`.
