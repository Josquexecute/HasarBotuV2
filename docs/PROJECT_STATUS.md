# HasarBotu V2 — Proje Durumu

Son güncelleme: 2026-07-11

## Mevcut sürüm ve aşama

- Sürüm: `0.1.0-ui-baseline`
- Aşama: UI-first prototip resmî referans sürümü
- Durum: **Kabul edildi ve donduruldu**
- Git: Yerel repository, `main` dalı, remote yok
- Baseline commit mesajı: `chore: freeze accepted UI prototype baseline`
- Baseline tag: `v0.1.0-ui-baseline`

## Kabul edilen kapsam

- Durum Panosu
- Dosyalar ve sağ hızlı detay
- Dosya Detayı: Özet, Operasyon, Evrak ve Fotoğraf, İşçilik, Ağır Hasar, Değer Kaybı, Raporlar ve Ücretler, E-postalar, Geçmiş
- Kapanan Dosyalar
- Raporlar ve Ücretler
- Mevzuat ve AI Yardımcısı
- Bildirimler
- Yönetim
- Ayarlar
- Açık/gerçek siyah koyu tema, kompakt/rahat yoğunluk ve daraltılabilir menü
- Normalize genel arama, dosya filtreleri, sıralama, panel/modal ve klavye etkileşimleri
- 1366×768 ve 1920×1080 masaüstü görünümleri

## UAT kapanışı

- Nihai sonuç: **Kabul**
- `UAT-ISSUE-001` — Üst genel arama: **Kapatıldı**
  - Gerçek ofis tekrar testinde `34mpa764` ile Dosyalar ekranına geçildi ve `34 MPA 764` bulundu.
- `UAT-ISSUE-002` — Normalize Dosyalar araması: **Kapatıldı**
  - Gerçek ofis tekrar testinde `34mpa764` bulundu; `ahmet akşam` sorgusu farklı alanlarda AND mantığıyla doğru dosyayı buldu.
- Açık Kritik/Yüksek UAT kaydı: 0

## Test ve build sonuçları

- `npm run typecheck`: Başarılı
- `npm run lint`: Başarılı
- `npm run test`: Başarılı — 2 test dosyası, 26/26 test
- `npm run build`: Başarılı — Vite 8.1.4, 1.594 modül; JS 354,56 kB (gzip 102,26 kB), CSS 49,16 kB (gzip 8,77 kB)
- `npm audit --audit-level=moderate`: Başarılı — 0 güvenlik açığı

## Git baseline güvenliği

- `node_modules`, `dist`, build/coverage çıktıları, loglar, geçici dosyalar ve cache dışlandı.
- `.env`, yerel ayarlar, credential/secret klasörleri ve özel anahtar uzantıları dışlandı.
- IDE/işletim sistemi gereksiz dosyaları dışlandı; repository'ye özel `.cursor` kuralı takip edildi.
- Kaynak kodu, testler, proje/UAT belgeleri, agent talimatları ve Stitch tasarım referansı baseline kapsamına alındı.
- Gerçek müşteri verisi veya secret bulunmadı.
- Remote eklenmedi ve push yapılmadı.

## Bilinen sınırlar

- Kabul yalnız UI-first prototipi kapsar.
- Backend, Electron, PostgreSQL, pCloud, Gmail, gerçek AI ve dosya sistemi entegrasyonları bulunmaz.
- Mock mevzuat yanıtı gerçek hukuki değerlendirme değildir.
- Baseline davranışı sonraki geliştirmelerde referans olarak korunmalıdır.

## Sonraki önerilen görev

`v0.1.0-ui-baseline` referansını koruyarak temel altyapı aşaması için merkezi API, PostgreSQL ve audit iskeletini ayrı bir uygulama planına dönüştürmek.
