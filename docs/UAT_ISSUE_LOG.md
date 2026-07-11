# HasarBotu V2 — UAT Sorun Günlüğü

Bu günlük yalnız anonim UI-first prototip bulguları içindir. Gerçek müşteri verisi, kimlik bilgisi, tam yerel yol veya canlı belge adı yazılmaz.

## Kullanım kuralları

- Her kayıt `UAT-ISSUE-001` biçiminde benzersiz ID alır.
- “Kısmen başarılı” veya “Başarısız” her senaryo için kayıt açılır.
- Önem, kullanıcı ve iş etkisini; öncelik, ele alınma sırasını gösterir.
- Ekran görüntüsü alanına yalnız anonim dosya adı veya güvenli göreceli referans yazılır.
- Düzeltildi durumu tek başına kapanış değildir; başka bir kullanıcı “Tekrar test” yapıp doğrulamalıdır.

## Önem seviyeleri

- **Kritik:** Yanlış dosya/karar algısı, temel akışın tamamen durması veya kabulü engelleyen durum.
- **Yüksek:** Ana iş akışını ciddi biçimde zorlaştırır; makul geçici çözüm yoktur veya yüksek hata riski yaratır.
- **Orta:** Kullanımı yavaşlatır ya da kafa karıştırır; geçici çözüm vardır.
- **Düşük:** Kozmetik, metinsel veya düşük etkili kullanılabilirlik sorunu.

## Durum seçenekleri

- Yeni
- İnceleniyor
- Planlandı
- Düzeltildi
- Tekrar test
- Kapatıldı
- Ertelendi
- Reddedildi

## Kayıt tablosu

| ID | Tarih | Bildiren | Ekran | Senaryo | Sorun açıklaması | Beklenen davranış | Gerçek davranış | Önem | Öncelik | Ekran görüntüsü | Durum | Çözüm notu | Doğrulayan |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-ISSUE-001 | 11.07.2026 | Ömer Faruk | Üst Uygulama Çubuğu / Dosyalar | Hızlı UAT — Genel Arama | Üst genel arama Enter ile Dosyalar ekranındaki aramayı çalıştırmıyor. | Her ekrandan girilen dolu sorgu Dosyalar ekranına aktarılmalı ve listeyi filtrelemeli; boş sorgu yönlendirmemeli. | Sorgu URL'ye yazılsa da Dosyalar arama state'i aynı rota üzerinde güncellenmiyordu. | Yüksek | P1 | - | Kapatıldı | `q` sorgusu Dosyalar state'ine senkronlandı; boş normalize sorgular engellendi. 26/26 otomatik test başarılı. | Gerçek ofis tekrar testi başarılı: üst genel aramada `34mpa764` ile Dosyalar ekranına geçildi ve `34 MPA 764` bulundu. |
| UAT-ISSUE-002 | 11.07.2026 | Ömer Faruk | Dosyalar | Hızlı UAT — Normalize Arama | Boşluksuz plaka ve normalize edilmemiş aramalar sonuç vermiyor; arama tüm dosya metaverisini taramıyor. | `34mpa764`, `F20260977`, `202617`, `omer` ve `ahmet akşam` sorguları ilgili dosyaları bulmalı. | Boşluksuz plaka, ayraçsız numara ve Türkçe karakter farkı bulunan sorgular eşleşmiyordu. | Yüksek | P1 | - | Kapatıldı | Ortak normalize yardımcı eklendi; sorgu kelimeleri farklı metaveri alanlarında AND mantığıyla eşleştiriliyor. 26/26 otomatik test başarılı. | Gerçek ofis tekrar testi başarılı: Dosyalar aramasında `34mpa764` sonucu bulundu; `ahmet akşam` doğru dosyayı AND mantığıyla buldu. |
| UAT-ISSUE-___ | YYYY-AA-GG | Rol / anonim kod | Ekran adı | UAT-__ |  |  |  | Kritik / Yüksek / Orta / Düşük | P0 / P1 / P2 / P3 | anonim-gorsel.png | Yeni |  |  |

## Oturum özeti

- Toplam kayıt: 2
- Kritik: 0
- Yüksek: 2
- Orta: 0
- Düşük: 0
- Kapatılan: 2
- Tekrar test bekleyen: 0
- Kabul kararını etkileyen açık kayıtlar: Yok
