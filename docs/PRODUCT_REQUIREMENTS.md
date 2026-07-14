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
