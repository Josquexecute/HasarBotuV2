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

Paket 41 sınırı:

- İlk gerçek sürüm AI çağrısı yapmayan deterministik şablon ve kullanıcı düzenlemesi kullanır.
- Gmail web handoff yalnız açık harici veri çıkışı onayıyla recipient/subject/body alanlarını tarayıcıda açar; OAuth tokenı veya provider secret kullanılmaz.
- Uygulama eki Gmail’e otomatik yüklemez, dosya yolu aktarmaz ve gönderim/teslim durumunu doğrulamaz.
- Taslak ve düzeltmeler sürümlü iş verisidir; içerik audit/log’a kopyalanmaz.
- AI taslak iyileştirmesi ileride eklenirse mevcut provider, PII minimizasyonu, bütçe, kaynak ve insan onayı kapılarından geçmek zorundadır.

## Gerçek AI sağlayıcısı güvenlik kapısı

- AI provider varsayılan kapalıdır. Organization allow-list, per-request/monthly integer bütçe ve açık kullanıcı onayı olmadan dış çağrı yapılmaz; otomatik fallback yoktur.
- Provider API key yalnız server process environment’ında bulunur. Secret DB, client bundle, API response, audit veya log’a yazılmaz; eksik/kısmi config fail-closed olur.
- Dış payload yalnız seçilmiş, doğrulanmış source-anchor metnidir ve `policy-ai-pii-redaction/1.0.0` ile minimize/redact edilir. Binary, tam poliçe/case dump’ı, File Agent/root, mutlak yol ve session gönderilmez.
- Provider strict JSON Schema dışında veri üretemez; tool listesi boştur ve `store:false` kullanılır. Server bütün anchor/evidence’i yeniden doğrular; sonuç insan review ve Paket 23 onayı olmadan kesin karar değildir.
- `store:false`, sağlayıcı abuse-monitoring retention’ını tek başına kapatmaz. Gerçek müşteri pilotu ancak onaylı ZDR/Modified Abuse Monitoring durumu, egress politikası, secret rotation ve veri işleme hukuki değerlendirmesiyle açılır.

## Gemini deployment yapılandırması — Paket 31

- Runtime etkinleştirme açık opt-in’dir: `GEMINI_POLICY_PROVIDER_ENABLED=true` olmadan adapter registry’ye girmez. Kapalı durumda temel uygulama ve mevcut manuel/kanıtlı analiz akışları çalışır.
- Secret yalnız `GEMINI_API_KEY` process environment değeridir. Regex ile provider key biçimi tahmini yapılmaz; trim, boş olmama ve 4096 karakter üst sınırı dışında gerçek doğrulama provider’a bırakılır.
- Model açıkça `GEMINI_POLICY_MODEL=gemini-3.5-flash|gemini-2.5-flash` olarak seçilir. `GEMINI_POLICY_MAX_OUTPUT_TOKENS` bounded opsiyonel ayardır. Production composition otomatik model veya provider fallback yapmaz.
- Server deployment kaydı organization `enabled/allowedProviderIds` ve integer bütçe politikasının yerine geçmez. UI yalnız güvenli birleşik kullanılabilirlik durumunu gösterir; secret veya environment ayrıntısı göstermez.
- Eksik/kısmi opt-in API başlangıcını fail-closed durdurur; kapalı veya eksiksiz yapılandırma deterministik başlar. Secret repository `.env` dosyasına, log’a, audit’e veya destek çıktısına yazılmaz.
- Gemini ücretsiz katmanı gerçek müşteri verisi için onaylı değildir. Retention/egress, veri işleme hukuki değerlendirmesi ve secret rotation runbook’u ayrıca tamamlanmadan production müşteri çağrısı açılmaz.
