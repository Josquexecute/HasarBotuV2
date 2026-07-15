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
