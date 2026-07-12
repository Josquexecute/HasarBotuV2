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

Kasko poliçesi hakkındaki AI cevapları şu bölümleri içerir: Sonuç; Gerekçe; Muafiyet veya limit; Servis ve parça şartı; Yapılması gereken işlem; Kaynak sayfa ve kloz; Çelişki veya eksik bilgi; Güven seviyesi.

- AI tahmin yürütmez; poliçede hüküm bulunamıyorsa cevap açıkça "poliçede açık hüküm bulunamadı" der.
- Genel sektör bilgisi poliçe hükmü gibi sunulmaz.
- Belgeler çelişiyorsa AI sessizce taraf seçmez; çelişkiyi gösterir.
- Kapsam/muafiyet/operasyon engeli gibi operasyonu bağlayan sonuçlar yalnız insan onayıyla kesinleşir ve audit üretir.

## AI bütçesi

- Aylık hedef/üst sınır yaklaşık 20 USD
- Tekrarlanan belge analizi cache edilir
- Basit PDF metni yerel çıkarılır
- Kural motoru kullanılabilecek yerde AI kullanılmaz
- Fotoğraf analizi kontrollü ve kullanıcı talebiyle çalışır
- Limit dolunca temel sistem çalışmaya devam eder

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
