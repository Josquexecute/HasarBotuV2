# HasarBotu V2 — Ürün Gereksinimleri

## Kullanıcı hedefleri

Kullanıcı, tek bir uygulama üzerinden:

- Yeni ihbar oluşturabilmeli
- Dosya arayabilmeli
- Durum Panosu'ndan iş akışını izleyebilmeli
- Not ve görev ekleyebilmeli
- Takip tarihlerini yönetebilmeli
- Eksik evrakları koşullu kurallarla görebilmeli
- PDF, Excel ve fotoğrafları dosya bağlamında açabilmeli
- Dosyaya özel AI'a soru sorabilmeli
- İşçilik dağıtımı için AI önerisi alabilmeli
- PERT değerlendirmesi yapabilmeli
- Değer Kaybı hesaplayabilmeli
- E-posta taslağı hazırlayabilmeli
- Dosyayı kontrollü biçimde kapatıp yeniden açabilmeli
- Kapanma ücretini nihai rapordan doğrulayabilmeli
- Mevzuat ve dosya özelinde kaynaklı cevap alabilmeli

## Ana ekranlar

### Durum Panosu

Aşamalar:

- Yeni İhbar
- Araç / Servis Bekleniyor
- Ekspertiz Bekliyor
- Hasar Tespiti
- Parça ve İşçilik
- Onarım Onayı Bekleniyor
- Onarımda
- Raporlama
- Kapanış Evrakları
- Kapanmaya Hazır

Durum Panosu gerçek açık vaka verisini kullanmalıdır:

- Yaklaşan, bugün ve gecikmiş takipler ayrı görünmeli
- Eksik evrak ve fiziksel doğrulama kontrolü gereken evrak ayrılmalı
- Bekleyen insan onayları görünmeli
- Manuel kurtarma, başarısız/bloke işlem ve diğer işlem gereken vakalar önceliklendirilmelidir
- Sorumlu, işlem türü, öncelik ve serbest arama filtreleri birlikte çalışmalıdır
- Karttan doğrudan gerçek dosya detayına geçilmelidir
- API modunda loading, boş, 401 ve bağlantı hatası mock veriye düşmeden gösterilmelidir
- Geciken, bugün ve yaklaşan açık görevler takip tarihinden ayrı sayaç ve sinyal olarak görünmelidir

### Dosyalar

Varsayılan sütunlar:

- Plaka / Dosya No
- İhbar Föyü No
- Hasar Dosya No
- Sigorta Şirketi
- Dosya Türü
- Durum
- Aşama
- Eksik Evrak
- Sorumlu
- Servis
- Takip Tarihi
- Son İşlem

### Dosya Detayı

Sekmeler:

- Özet
- Operasyon
- Evrak ve Fotoğraf
- İşçilik
- Ağır Hasar
- Değer Kaybı
- Raporlar ve Ücretler
- E-postalar
- Geçmiş

Operasyon sekmesi gerçek API modunda append-only iç/görüşme notlarını, açık ve sonuçlanmış görevleri, zorunlu görev sonucu/iptal gerekçesini ve takip tarihi geçmişini göstermelidir. Kapalı dosya salt-okunur olmalı; API hatasında mock operasyon kaydı gösterilmemelidir.

## Yeni İhbar akışı

1. İhbar Föyü + Poliçe PDF yükleme
2. Belge analizi
3. Alan kontrolü
4. Mükerrer vaka kontrolü
5. Klasör önizlemesi
6. Ofis numarası atama
7. Dosya oluşturma

## Dosyaya özel AI

Örnek sorular:

- Bu dosyada muafiyet var mı?
- Poliçe hasar tarihinde geçerli mi?
- Bu hasar teminat kapsamında mı?
- İkame araç hakkı var mı, kaç gün?
- Servis veya parça türü şartı var mı?
- Eksik evrak var mı?
- Rücu ihtimali var mı?
- Onarım onayı gerekiyor mu?
- Kapanma ücreti nedir?
- PERT açısından kritik hasarlar neler?
- Değer Kaybı için hangi bilgiler eksik?

Her cevap kaynak, gerekçe ve güven seviyesi göstermelidir.

Kasko poliçesi cevapları ayrıca şu dokuz bölümü içerir: Sonuç ve kapsam durumu; Gerekçe; Muafiyet, tenzil, maliyet paylaşımı veya limit; Servis ve parça şartı; Yapılması gereken işlem ve gerekli belgeler; Kaynak belge, sayfa, başlık ve kloz; Çelişki veya eksik bilgi; Güven seviyesi; İnsan onayı gereksinimi. AI tahmin yürütmez; hüküm yoksa "Poliçede bu konuda açık ve doğrulanabilir bir hüküm bulunamadı." der (`CASCO_POLICY_SCENARIO_RULES.md`).

AI kaynak sırası: 1) dosya belgeleri, 2) dosya notları ve e-postaları, 3) firma bilgi bankası, 4) resmî mevzuat, 5) internet araştırması (açıkça etiketli).

## Kasko operasyon takibi

Kasko dosyalarında en az şunlar izlenir: muafiyet var/yok; muafiyet türü, oranı ve koşulu; hasarın teminat kapsam durumu; ikame araç durumu; poliçe ürünü/türü; servis ve parça şartı; özel kloz kaynaklı operasyon engeli. Muafiyetli dosya iş akışı `DOMAIN_RULES.md` içinde tanımlıdır.

## E-posta

İlk sürümde:

- AI konu ve metni hazırlar
- Alıcı ve ekleri önerir
- Gmail oluşturma ekranını açar
- Kullanıcı Gmail üzerinden gönderir

Otomatik gönderim yoktur.

Hazır e-posta türleri: onarım onayı talebi; eksik evrak talebi; ön rapor bilgilendirmesi; servis değişikliği; muafiyet, tenzil ve servis/parça koşulu bilgilendirmesi; portal muafiyet notu taslağı; kapanış evrakları talebi; dosya durumu; rücu evrakı; PERT değerlendirmesi; serbest talimat.

## Sigorta şirketi kapsamı

İlk sigorta şirketi önceliği Türkiye Sigorta'dır; sistem başlangıçtan itibaren çoklu sigorta şirketi şablonuna hazırdır (kanonik alanlar + şirket profilleri).

## Dışa aktarma

Raporlar:

- Excel
- PDF
- Yazdırma

formatlarında alınabilir.

## Case kapatma ve yeniden açma

- Kullanıcı, doğrulanmış çalışma konumu olan açık case için kapanış önizlemesi alır; önizleme belge eksiklerini, logical kapalı ay hedefini ve uyarıları açıklar.
- Normal kapanış gereksinimler tamamlandığında; eksiklerle kapanış ise yalnız açık seçim, zorunlu gerekçe ve eksik/control_required snapshot'ı ile onaylanabilir.
- Kapatma fiziksel klasör move'u doğrulanmadan case'i closed yapmaz. Başarıda lifecycle ve workflow `closed` olur; aynı case kimliği ve ofis numarası korunur.
- Closed case zorunlu gerekçe ve geçerli açık workflow stage ile yeniden açılabilir. Önceki açık logical location güvenliyse hedeflenir; geçmiş kapanış kaydı append-only korunur.
- Sadece yönetici, eksper ve dosya sorumlusu close/reopen komutu verebilir. Diğer oturumlu roller durumu okuyabilir; API modunda mock fallback veya istemciden mutlak/serbest path yoktur.

## Servis profili ve sigorta şirketi anlaşması

- Servis temel profili yetkili, özel, cam, mobil veya diğer olabilir; aktiflik yeni atama uygunluğunu belirler.
- Yetkili servis olmak, herhangi bir sigorta şirketiyle anlaşmalı olmak anlamına gelmez. Anlaşma servis ve sigorta şirketi çifti için, tarih aralığı ve desteklenen işlem bazında ayrıca değerlendirilir.
- Tarihsel sonuç öncelikle hasar tarihi, ileride poliçe değerlendirmesinde poliçe tarihi üzerinden üretilir. Kayıt, tarih veya insan onayı belirsizse sistem kesin anlaşmalı/anlaşmasız sonucu üretmez ve `control_required` gösterir.
- Create/edit ekranı servis türünü ve seçili sigorta şirketi için anlaşma sonucunu açıkça gösterir. Kapanış, muafiyet ve poliçe motorları aynı deterministik servis uygunluk sınırını kullanır; bu paket muafiyet oranı veya poliçe içeriği hesaplamaz.

### Kasko poliçe analiz çekirdeği — Paket 23

- Poliçenin yalnız ilk sayfası değil tüm sayfa/özel şart/zeyil kapsamı kanonik modele aktarılabilir; her madde sayfa+bölüm+kloz+sınırlı alıntı kanıtı taşır.
- Onaylanmamış, kaynaksız veya çelişkili analiz operasyonel kesin karar değildir. Bilinmeyen sonuç tahmin edilmez; `unknown` veya `control_required` gösterilir.
- Genel muafiyetsiz ifade koşullu servis/cam/parça/betterment/önceki total loss şartını ezmez. Yetkili, anlaşmalı ve poliçeye uygun servis ayrı değerlendirilir.
- Kasko vaka görünümü sürüm/onay/kaynak/teminat/muafiyet/servis-parça/ikame araç/istisna/conflict ve 12 senaryo sonucunu gösterir. PDF/OCR/AI çıkarımı ve gerçek operasyon blokajı bu pakette yoktur.

### Kasko PDF metin çıkarımı — Paket 24

- Yalnız fiziksel olarak doğrulanmış `ready` Kasko poliçe PDF sürümü, açık kullanıcı komutuyla mevcut File Agent kuyruğunda işlenir. Aynı parser/normalizasyon kimliği için tekrar çağrı mükerrer extraction üretmez.
- Çıktı sayfa bazında raw+normalize metin, text/image-only/empty/failed durumu, deterministik segment, parser/normalizasyon sürümü ve exact Unicode locator taşır. Kaynağı olmayan yorum veya operasyonel karar üretmez.
- Metin katmanı yoksa `ocr_required`, karışık sonuçta `partial`; encrypted/malformed/limit/timeout hataları kanonik güvenli kodlarla gösterilir. OCR, AI ve tam poliçe analizi bu paketin işi değildir.
- API modunda mock fallback yoktur. Mutlak root/path, PDF binary, tam metin, secret ve ham parser/OS hatası API/audit/log yüzeyine çıkamaz.

### Yerel poliçe OCR hattı — Paket 25

- Yalnız doğrulanmış `ready` Kasko poliçesinin Paket 24 tarafından `image_only` OCR adayı yapılan sayfaları, kullanıcı komutuyla mevcut File Agent kuyruğunda işlenir. Varsayılan profil `standard` 300 DPI; `high_quality` 400 DPI ayrı identity ve sürümdür.
- OCR `tesseract.js@7.0.0` ile tamamen yerel çalışır; Türkçe/İngilizce language asset’leri exact pin, boyut ve SHA-256 ile worker başlamadan doğrulanır. Runtime indirme, telemetry, dış URL, bulut OCR, LLM ve AI yoktur.
- Paket 24 raw/normalized metni değişmez. OCR raw/normalized katmanı, blok/satır/kelime render-pixel koordinatları, Unicode code point aralığı, okuma sırası ve kalite sonucu ayrı immutable sürüm olarak saklanır.
- `ready` yalnız teknik tamamlanmadır. Düşük güven, yetersiz metin, çok sütun belirsizliği veya PDF/OCR çelişkisi `control_required`/insan kontrolü üretir; OCR tek başına poliçe yorumu veya onaylı analiz değildir.
- UI gerçek API durum/progress, motor/dil/render/preprocess sürümü, iki metin katmanı, kalite, güven, geometri ve bounded source locator gösterir. API kesintisinde mock fallback; mock modda fiziksel OCR yoktur.

### Kanıtlı AI alan adayları — Paket 26

- Kasko poliçesi için AI extraction yalnız doğrulanmış PDF/OCR segmentlerinden, server üretimi `sourceAnchorId` referanslarıyla planlanır.
- AI varsayılan kapalıdır; core vaka işlemleri AI olmadan çalışır. Provider disabled veya bütçe aşımı çağrı/fallback üretmez.
- Provider çıktısı nihai karar değildir. Candidate; kategori, kanonik alan, değer, koşul/istisna, kaynak, kalite, confidence ve conflict/control durumunu taşır.
- Kullanıcı bu pakette candidate kabul edemez, düzenleyemez, reddedemez veya Paket 23 analizine taşıyamaz. UI bunu açıkça belirtir.
- Uygulama full prompt, full provider response, belge binary’si, mutlak yol, secret veya tüm vaka dump’ını provider/audit/log sınırına taşımaz.

### AI adayı insan incelemesi — Paket 27

- Yetkili kullanıcı her adayı kabul eder, kanıt sınırında düzenler, gerekçeli reddeder veya kontrol gerektirir durumuna alır. Her yeni karar önceki sürümü korur.
- Düzenlenen değer aynı doğrulanmış PDF/OCR source anchor’larında kanıtlanmalıdır. Kaynak dışı değer kullanıcı kararıyla güvenilir hâle gelmez.
- Promotion önizlemesi bekleyen, kabul edilen, düzenlenen, reddedilen, kontrol gereken ve çatışmalı aday sayılarını; hedef Paket 23 analiz sürümünü ve engelleri gösterir.
- Yalnız kabul edilen/düzenlenen adaylar yeni Paket 23 taslak analiz sürümüne aktarılır. Kaynak, sağlayıcı ve insan kararı provenance’ı ile açık çatışmalar korunur.
- Promotion analiz onayı değildir. Paket 23 onay ve conflict çözüm akışı ayrıca çalıştırılmadan adaylar kesin teminat, muafiyet veya operasyon kararı sayılmaz.

### Gerçek AI sağlayıcısı pilotu — Paket 28

- Gerçek provider kullanımı organization bazında açıkça etkinleştirilir; provider allow-list ve bütçe hard stop aşılmadan dış çağrı yapılmaz. AI kapalıyken bütün core case akışları çalışmaya devam eder.
- Provider secret yalnız server process’indedir. UI/API/audit/log/DB’ye secret, session, File Agent bilgisi, mutlak yol, binary veya tüm vaka/poliçe dump’ı taşınmaz.
- Dış istek öncesi seçilmiş source-anchor metni deterministik PII minimizasyonu/redaksiyonundan geçer. UI dış sağlayıcı, redaksiyon sayısı/kategorileri, input boyutu, retention modu ve tahmini maliyeti açık onaydan önce gösterir.
- Strict structured output yalnız adaydır. Server kanıt doğrulaması, Paket 27 insan review’ı ve Paket 23 pending promotion/approval sınırları aynen uygulanır; provider sonucu doğrudan kesin karara dönüşmez.
- `store:false` ZDR taahhüdü değildir. Gerçek müşteri pilotu sağlayıcı retention sözleşmesi/organizasyon ayarı ve yetkili secret kurulumu ayrıca doğrulanmadan başlatılmaz.

### Kasko poliçe analiz uçtan uca kullanıcı akışı — Paket 30

- Kasko dosya detayında doğrulanmış PDF/OCR kaynakları, analiz planı, sağlayıcı onayı, AI adayları, insan inceleme kararları ve Paket 23 taslak sonucu tek çalışma bağlamında sunulur.
- Kullanıcı kullanılacak kaynak parçalarını seçebilir. Plan yalnız seçilen ve server tarafından yeniden doğrulanan source kayıtlarıyla oluşturulur; kaynak seçmeden analiz başlatılamaz.
- Aday incelemesinde provider değeri ile insan düzenlemesi ayrılır. Kanıt görünümü belge/documentVersion, extraction, sayfa, bounded excerpt, kalite/warning ve sourceAnchor bilgisini gösterir.
- Yalnız kabul edilen veya kanıt sınırında düzenlenen adaylar açık onayla yeni pending Paket 23 analiz sürümüne uygulanır. Red ve kontrol gereken adaylar uygulanmaz; conflict ve provenance geçmişi korunur.
- Uygulama tamamlanınca yeni analiz sürümü aynı dosya detayında otomatik görünür. Bu taslak, ayrıca Paket 23 insan onayı verilmeden kesin teminat/muafiyet veya operasyon kararı değildir.
- API hatasında gerçek akış mock veriye düşmez. Mutlak yol, secret, binary, ham provider cevabı ve tam poliçe metni kullanıcı arayüzüne taşınmaz.

### Gemini deployment kullanılabilirliği — Paket 31

- Gemini yalnız güvenli server-side opt-in ve secret config ile kullanılabilir. Provider kapalı veya yapılandırılmamışken temel case, belge ve onaylı analiz işlemleri kesintisiz çalışır.
- Kullanıcı arayüzü server deployment durumu ile organization AI policy/allow-list durumunu ayrı gösterir; kullanılabilir olmayan provider için çağrı veya mock fallback yapmaz.
- API key, environment ham değeri ve secret biçimi hiçbir istemci contract’ına girmez. UI yalnız güvenli provider/model/version/retention ve bütçe özetini gösterir.
- Production runtime otomatik model/provider fallback yapmaz. Gerçek müşteri içeriği için retention/egress/hukuki ve secret rotation onayı deployment ön koşuludur.

### Trafik değer kaybı domain/API çekirdeği — Paket 32

- Trafik case’inde 01.07.2026 kural dönemiyle sürümlü değer kaybı assessment’ı bulunur; Kasko bu pakette desteklenmez.
- Hesaplama kullanıcı tarafından girilen doğrulanmış kaza öncesi ve onarım sonrası piyasa değerleri, kusur oranı ve kanıtlı araç/hasar bilgileriyle yalnız taslak üretir.
- Kullanıcı her piyasa değeri için emsal ve kaynak bağlantılarını; önceki hasar, hasarlı parçalar, kilometre/kullanım ve ağır/tam hasar kanıtını görebilmelidir.
- Eksik veya çelişkili bilgi açık belirsizlik kodu ve gerekçesiyle gösterilir; sistem tahmin ederek kesin tutar oluşturmaz.
- Sonuç `calculable | no_value_loss | not_applicable | control_required` olabilir. Hiçbiri expert/admin onayı olmadan kesinleşmez.
- Düzeltmeler yeni sürüm üretir; eski onay, kanıt ve emsal geçmişi silinmez.

### Trafik değer kaybı kullanıcı çalışma alanı — Paket 33

- Gerçek API modunda Trafik dosyasının Değer Kaybı sekmesi Paket 32 assessment’ını oluşturur, okur ve sürüm geçmişiyle gösterir.
- Kullanıcı araç/kusur/parça/piyasa girdilerini, kaza öncesi ve onarım sonrası emsalleri ve doğrulanmış belge metadata kanıtlarını açıkça seçer; belge seçimi desteklenen kanıt alanlarını otomatik varsaymaz.
- Sonuç taslak tutar, gerekçe, resmî kural kaynağı, belirsizlik ve kullanılan `2026.07.01.1` rule version ile gösterilir.
- Bloklayan belirsizlik submit’i kapatır. Submit ayrı teyit; approve/reject ayrı insan inceleme teyidi ve mevcut rol yetkisi gerektirir.
- Her düzeltme yeni sürüm oluşturur. API modunda bağlantı veya yetki hatası mock veriyle maskelenmez; mock demo görünümü değişmez.
- Kasko vaka bu pakette gerçek Trafik hesabına sokulmaz; destek dışı durum açıkça gösterilir.

### Trafik değer kaybı nihai raporu — Paket 34

- Kullanıcı yalnız insan onaylı Trafik değer kaybı version’ı için nihai rapor önizleyebilir.
- Önizleme kaynakları, emsalleri, araç/parça snapshot’ını, hesaplamayı, belirsizlikleri, insan onayını ve kullanılan kural sürümünü anlaşılır biçimde birlikte göstermelidir.
- Nihai PDF, açık kullanıcı confirmation’ı olmadan oluşmamalı; aynı onaylı version için mükerrer final çıktı üretmemelidir.
- Üretilmiş rapor indirilebilir ve tarihsel olarak aynı version’a bağlı kalmalıdır. Yeni hesap veya düzeltme eski raporu sessizce değiştirmemelidir.
- API kesintisinde mock rapor gösterilmez. Fiziksel case klasörüne otomatik yazma, e-posta gönderme ve genel rapor editörü bu paketin kapsamında değildir.

### Kapanma ücreti ve dönem raporu — Paket 39

- Kapalı case için kapanma ücreti yalnız fiziksel doğrulaması tamamlanmış `ready` nihai ekspertiz raporu metadata'sına ve kaynak sayfasına bağlanarak manuel aday olarak girilebilir.
- Aday ücret kesin değildir ve aylık toplamda yer almaz. Yetkili kullanıcı kaynak/tutarı açıkça teyit etmeden ücret `approved` olmaz.
- Onaylı tutar sessizce değiştirilemez. Düzeltme zorunlu gerekçe, yeni tutar, doğrulanmış kaynak ve yeni append-only sürümle yapılır.
- Raporlar ekranı seçilen ayda açılan açık vakaları ve o ay finalize edilen kapalı vakaları ayrı sayar; yalnız güncel kullanıcı onaylı/düzeltilmiş ücretleri kesin toplamda gösterir.
- Kapanan Dosyalar aday ücreti `Kontrol gerekli`, kayıtsız ücreti bilinmeyen, onaylı/düzeltilmiş ücreti gerçek tutar olarak gösterir.
- API modunda mock toplam veya ücret fallback'i yapılmaz. Otomatik PDF/AI ücret çıkarımı, dışa aktarma ve muhasebe yönetimi bu paketin kapsamında değildir.
