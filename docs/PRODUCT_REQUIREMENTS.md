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
- Eksik evrak var mı?
- Rücu ihtimali var mı?
- Onarım onayı gerekiyor mu?
- Kapanma ücreti nedir?
- PERT açısından kritik hasarlar neler?
- Değer Kaybı için hangi bilgiler eksik?

Her cevap kaynak, gerekçe ve güven seviyesi göstermelidir.

## E-posta

İlk sürümde:

- AI konu ve metni hazırlar
- Alıcı ve ekleri önerir
- Gmail oluşturma ekranını açar
- Kullanıcı Gmail üzerinden gönderir

Otomatik gönderim yoktur.

## Dışa aktarma

Raporlar:

- Excel
- PDF
- Yazdırma

formatlarında alınabilir.
