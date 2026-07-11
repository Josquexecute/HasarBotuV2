# HasarBotu V2 — Teknik Mimari

## Hedef yapı

```text
Windows Uygulaması / Web Arayüzü
            │
            ▼
        Merkezi API
            │
            ▼
        PostgreSQL
            │
            ├── Notlar
            ├── Görevler
            ├── Durumlar
            ├── AI Sonuçları
            ├── Audit Log
            └── Kural Sürümleri

Her Windows Cihazı
            │
            ▼
    Yerel pCloud Kökü
            │
            └── PDF / Excel / Fotoğraflar

Ana Dosya Agent
            │
            ▼
Kritik klasör taşıma / yeniden adlandırma
```

## Önerilen repository yapısı

```text
apps/
  desktop/
  web/
  api/
  file-agent/

packages/
  ui/
  domain/
  database/
  rules/
  ai/
  shared/
```

UI prototip aşamasında daha hafif yapı kullanılabilir:

```text
src/
  app/
  components/
  features/
  mocks/
  routes/
  styles/
  types/
```

## Kaynak doğruluk

- PostgreSQL: iş verisi
- pCloud: fiziksel dosyalar
- Göreceli yol: veritabanındaki dosya referansı
- `caseId`: vaka ana kimliği
- Plaka: arama/eşleştirme alanı

## Eşzamanlılık

Gerçek zamanlı ortak belge düzenleme hedeflenmez.

Koruma:

- Optimistic concurrency
- `updatedAt` veya row version
- Excel işlem kilidi
- Klasör işlem kilidi
- Idempotent kritik komutlar

## Backend ilkeleri

- Modüler monolit ile başla.
- Erken mikroservis kullanma.
- Domain kuralları API controller veya UI component içine gömülmez.
- Dosya Agent ayrı süreçtir.
- AI sağlayıcısı adapter arayüzü arkasında olmalıdır.
- Sigorta şirketi şablonları yapılandırılabilir olmalıdır.

## Depolama profili

Örnek:

```text
Ana kök: P:\BARAN GLOBAL EKSPERTİZ
Yıl: 2026
Ay: Temmuz 2026
Kapalı klasör kalıbı: KAPALI {AY} {YIL}
```

Her cihaz farklı yerel pCloud kökü seçebilir.

## Yedek

Harici diske:

- Günlük
- Haftalık
- Aylık

PostgreSQL ve sistem yapılandırması yedeklenir.

Fiziksel pCloud klasörleri bu yedek sisteminin parçası değildir.
