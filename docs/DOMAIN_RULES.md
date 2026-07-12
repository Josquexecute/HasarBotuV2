# HasarBotu V2 — Domain Kuralları

## Trafik dosyası evrakları

Her zaman zorunlu:

- M Trafik Poliçe
- S Trafik Poliçe
- SBM Ağır Hasar
- M Ruhsat
- S Ruhsat
- M Ehliyet
- S Ehliyet

Olay belgesi:

- Zabıt varsa KTT ve Beyan gerekmez.
- Zabıt yoksa KTT veya Beyandan en az biri zorunludur.

Tramer:

- Zabıt yoksa Tramer Sonucu zorunludur.
- Zabıt varsa Tramer Sonucu zorunlu değildir.

## Kasko dosyası evrakları

Her zaman zorunlu:

- Kasko Poliçe
- SBM Ağır Hasar
- K Ruhsat
- K Ehliyet

Olay belgesi:

- Zabıt varsa KTT ve Beyan gerekmez.
- Zabıt yoksa KTT veya Beyandan en az biri zorunludur.

Rüculu Kasko:

- Karşı Araç Ruhsatı
- Karşı Araç Ehliyeti
- Karşı Araç Trafik Poliçesi
- Tramer Sonucu
- Kusur Oranı
- KTT veya Zabıt

## Kasko türleri

- Dar Kasko
- Standart Kasko
- Genişletilmiş Kasko
- Tam Kasko

Muafiyet yalnız var/yok değildir. Tür, oran, asgari/azami tutar, uygulandığı teminat, açıklama ve kaynak sayfa tutulur.

## Kasko poliçesi analizi

Kasko poliçesi yalnız özet alanlardan ibaret değildir; belgenin tamamı kritik karar kaynağıdır. Poliçe baştan sona işlenir: ürün/tür, araç ve kullanım, bütün teminatlar, limitler, genel muafiyet, koşullu muafiyet ve tenziller, özel şartlar/klozlar, istisnalar, ikame araç hakkı ve süresi, mini/mobil onarım, cam servisi, çekici, servis türü, parça türü, kıymet kazanma/eskime, pert geçmişi hükümleri, rayiç/tazmin yöntemi, istenen belgeler, aksesuar/LPG/elektrikli araç hükümleri, prim borcu/mahsup, zeyiller ve yürürlük.

- "Muafiyetsiz" genel alanı, özel kloz kaynaklı koşullu muafiyet bulunmadığı anlamına gelmez; klozlar ayrıca taranır.
- Kanonik alanlar sigorta şirketinden bağımsızdır; şirketin orijinal alan adı ve madde metni korunur, kanonik alan ↔ kaynak metin bağı izlenebilirdir.
- Her kural olay/koşul/kapsam sonucu (kapsamda, şartlı, kapsam dışı, belirsiz)/muafiyet/limit/istisna/belge/servis ve parça şartı/işlem/kaynak/güven/insan onayı yapısıyla modellenir.
- Poliçe, ihbar föyü ve diğer belgeler çelişirse sistem sessizce seçim yapmaz; çelişkiyi gösterir.

Ayrıntı: `CASCO_POLICY_ANALYSIS_PLAN.md`, `CASCO_POLICY_CANONICAL_MODEL.md`, `CASCO_POLICY_SCENARIO_RULES.md`.

## Muafiyetli dosya iş akışı

Muafiyet tespit edilen kasko dosyasında:

1. Tedarik yapılmaz.
2. Mobil onarım yapılmaz.
3. Dosya sorumlusuna bilgi verilir.
4. Servise bilgi verilir.
5. Servis değişikliği beklenir.
6. Servis değiştirilmezse başka operasyon yapılmaz.
7. Portala muafiyetle ilgili notlar girilir.
8. Dosya sorumlusunun onayına göre dosya kapatılır.

Akış bildirim, görev, portal notu, onay ve kapanış adımlarıyla modellenir; her adım audit üretir.

## Parça bedeli

Hasara uğrayan parça bedeli hesabında KDV hariç ve iskonto uygulanmamış bedel esas alınır. Hesaplama kaynağı, fiyat tarihi ve kullanılan fiyat belgesi izlenebilir olmalıdır.

## Onarım onayı

Kasko:

- KTT varsa zorunlu
- Beyan varsa zorunlu
- Zabıt varsa ve hasar 100.000 TL üzerindeyse zorunlu

Trafik:

- Hasar 100.000 TL üzerindeyse zorunlu

100.000 TL eşiği sabit kodlanmaz; sürümlü kuraldır.

## Notlar

Not türleri:

- Genel Not
- Servis Görüşmesi
- Mağdur Görüşmesi
- Sigorta Şirketi Görüşmesi
- Eksper Notu
- İç Not

Notlar fiziksel olarak silinmez. Aktif, Düzenlendi veya Silindi durumunda geçmişiyle saklanır.

## Görevler

Durumlar:

- Bekliyor
- Devam Ediyor
- Tamamlandı
- İptal Edildi
- Gecikti

Servis, mağdur, sigorta şirketi görüşmesi, onarım onayı, evrak talebi ve kapanış kontrolü görevlerinde sonuç notu zorunludur.

## Çalışma takvimi

- Pazartesi–Cuma çalışma günü
- Cumartesi, Pazar ve Türkiye resmî tatilleri tatil
- Tatil gününe görev girildiğinde sonraki iş günü önerilir

## Servis

Alanlar:

- Servis Adı
- Yetkili / Özel
- Telefon

Servis değişiklik geçmişi korunur.

## PERT

Durumlar:

- İnceleme Başlamadı
- Veri Eksik
- İnceleniyor
- Onarım Yönünde
- PERT Adayı
- PERT Kanaati
- Merkez Kararı Bekleniyor
- Onarım Kararı Verildi
- PERT Kararı Verildi

AI önerisi, eksper kanaati ve merkez kararı birbirinden ayrıdır.

## Değer Kaybı

Trafik dosyasında zorunlu; Kasko'da isteğe bağlıdır (mevzuat/ürün kuralı).

Ofis operasyon kuralı: eksper talimatı gereği Kasko dosyalarında da değer kaybı çalışması yapılır. Mevzuat zorunluluğu ile ofis operasyon kuralı ayrı alanlar olarak modellenir (`valueLossLegalRequirement` / `valueLossOfficePolicy`); ofis kuralı sürümlüdür ve mevzuat alanının anlamını değiştirmez.

Hazırlanma şartı:

- Parça listesi kesin
- Onarım/boya işlemleri kesin
- Araç bilgileri doğrulanmış

Durumlar:

- Hazır Değil
- Veri Eksik
- Hesaplamaya Hazır
- Taslak Hesap
- Eksper Kontrolünde
- Eksper Onaylı
- Güncelliğini Kaybetti
- Değer Kaybı Oluşmaz

## Kapanma ücreti

Kaynak, sigorta şirketinden indirilen nihai ekspertiz raporudur.

Durumlar:

- Rapor Bulunamadı
- Tutar Bulunamadı
- Birden Fazla Aday
- Kontrol Bekliyor
- Kullanıcı Onaylı
- Kullanıcı Tarafından Düzeltildi

Kesin aylık toplama yalnız kullanıcı onaylı veya kullanıcı tarafından düzeltilmiş kesin tutar girer.
