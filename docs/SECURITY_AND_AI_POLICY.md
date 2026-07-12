# HasarBotu V2 — Güvenlik ve AI Politikası

## Veri

- Gerçek müşteri verisi test fixture içine konmaz.
- Secret ve API anahtarı repository'e yazılmaz.
- `.env` commit edilmez.
- Kullanıcı şifreleri hashlenmiş saklanır.
- Yönetici işlemleri yeniden doğrulama isteyebilir.
- Her kritik işlem audit log üretir.

## AI

AI tam belgeleri okuyabilir; ancak yalnız kullanıcı onaylı akışlarda gerçek iş verisini değiştirebilir.

AI'ın yasak olduğu otomatik işlemler:

- Dosya kapatma
- Klasör taşıma
- Excel'e yazma
- Kapanma ücreti kesinleştirme
- Değer Kaybı onayı
- PERT nihai kararı
- E-posta gönderme
- Mevzuat kuralını etkinleştirme

## Kaynak gösterme

Belge veya mevzuat cevabı mümkünse:

- Belge
- Sayfa
- Bölüm
- Tarih
- Yürürlük
- Güven

göstermelidir.

## Kasko poliçesi AI standardı

Kasko poliçesi hakkındaki AI cevapları şu dokuz bölümü içerir: Sonuç ve kapsam durumu; Gerekçe; Muafiyet, tenzil, maliyet paylaşımı veya limit; Servis ve parça şartı; Yapılması gereken işlem ve gerekli belgeler; Kaynak belge, sayfa, başlık ve kloz; Çelişki veya eksik bilgi; Güven seviyesi; İnsan onayı gereksinimi.

- AI tahmin yürütmez; poliçede hüküm bulunamıyorsa cevap açıkça "Poliçede bu konuda açık ve doğrulanabilir bir hüküm bulunamadı." der.
- Genel sektör bilgisi poliçe hükmü gibi sunulmaz.
- Belgeler çelişiyorsa AI sessizce taraf seçmez; çelişkiyi gösterir.
- AI kullanıcı onayı olmadan tedarik başlatamaz/durduramaz, servis değiştiremez, muafiyet oranını kesinleştiremez, portal notu yazamaz veya dosya kapatamaz.
- Kapsam/muafiyet/operasyon durdurması gibi operasyonu bağlayan sonuçlar yalnız insan onayıyla kesinleşir ve audit üretir.

## AI bütçesi ve sağlayıcı politikası

- Temel uygulama ücretli AI olmadan çalışır. **Ücretli bulut AI varsayılan olarak kapalıdır**; yönetici etkinleştirirse yapılandırılabilir aylık üst sınır kullanılır. İlk hedef üst sınır yaklaşık 20 USD/aydır.
- Aynı belge, içerik hash'i değişmedikçe tekrar analiz edilmez (cache).
- Basit PDF metni yerel çıkarılır.
- Kural motoru kullanılabilecek yerde AI kullanılmaz.
- Fotoğraf analizi kontrollü ve kullanıcı talebiyle çalışır.
- Düşük maliyetli model önce denenir; zor vakada güçlü modele geçilir.
- Modül, kullanıcı, model ve dosya bazlı kullanım/maliyet raporu gösterilir (`ai_usage_ledger`).
- Bulut sağlayıcıya gönderilecek içerik kapsamı görünür, onaylı ve auditli olur.
- Limit dolunca temel sistem (dosya takibi, notlar, görevler, manuel evrak kontrolü, klasör işlemleri) çalışmaya devam eder; yalnız AI işlemleri durur.

## Harici servis

Bir servis:

- Ücretli
- Zorunlu bulut
- Veri dışa aktarımı yapan
- Kalıcı secret gerektiren

bir yapı getiriyorsa kullanıcıya açıkça bildirilmeden eklenmez.

## E-posta

İlk sürümde AI taslak hazırlar ve Gmail ekranı açılır.

Otomatik gönderim yoktur.
