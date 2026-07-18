# HasarBotu V2 — Performans Notları

Bu belge gerçek ölçüm sonuçlarını kaydeder. Tahmin veya hedef değil, çalıştırılmış
koşumların çıktısıdır. Ölçüm koşumları tekrar üretilebilir olmalıdır.

## Paket 51 — `GET /api/v1/operational-alerts` ölçümü (2026-07-18)

### Ölçüm yöntemi

- Koşum: `node scripts/package51-alert-performance.mjs --sizes 100,1000,5000 --runs 5`
- Gerçek PostgreSQL (`hasarbotu_test`), her hacim için şema sıfırlanır ve `ANALYZE` çalıştırılır.
- Üretim koduna enstrümantasyon **eklenmedi**: `pool.query` ölçüm betiğinde sarmalanır.
  Kural değerlendirme süresi = toplam süre − SQL süresi.
- İlk koşum (soğuk) ve sonraki koşumların medyanı (ısınmış) ayrı raporlanır.
- Makine: tek geliştirici makinesi, yerel PostgreSQL. **Süreler makineye bağlıdır ve
  koşumlar arası oynaklık gözlenmiştir**; bu yüzden regresyon koruması süreye değil,
  sorgu sayısı ve parametre yüküne dayanır.

### Sentetik veri dağılımı

Deterministik modulo dağılımı (`office_sequence % 20`):

- Görev: %55 açık ve süresi geçmiş, %10 açık ve gelecekte, %10 tamamlanmış, %35 görevsiz
- Takip tarihi: %25 geçmiş, %25 gelecek, %50 yok
- Evrak: %40 tam küme, %35 bir eksik, %25 iki eksik

| Açık dosya | Dosya satırı | Görev satırı | Belge satırı |
|---|---|---|---|
| 100 | 100 | 65 | 715 |
| 1.000 | 1.000 | 650 | 7.150 |
| 5.000 | 5.000 | 3.250 | 35.750 |

### Önce (Paket 49/50 hâli)

| Açık dosya | Sorgu | Soğuk toplam | Isınmış medyan | Isınmış SQL | Isınmış kural | Dönen uyarı |
|---|---|---|---|---|---|---|
| 100 | 4 | 28,4 ms | 11,6 ms | 5,6 ms | 3,4 ms | 200 |
| 1.000 | 4 | 90,1 ms | 73,8 ms | 46,1 ms | 31,2 ms | 200 |
| 5.000 | 4 | 421,8 ms | 382,1 ms | 216,7 ms | 166,4 ms | 200 |

Soğuk koşumda sorgu bazında (5.000 dosya):

| Sorgu | Süre |
|---|---|
| Açık dosyalar | 36,6 ms |
| Süresi geçmiş görevler | 22,4 ms |
| **Belge + belge sürümü** | **190,8 ms** |
| Aktif evrak kural sürümü | 1,4 ms |

### Bulgu

- **N+1 yoktur.** Sorgu sayısı dosya sayısından bağımsız ve sabittir: 4 sorgu
  (açık dosya yoksa 1). Ölçüm bunu 100 → 5.000 dosyada doğruladı.
- Ölçeklenme kabaca doğrusaldır; dönen kayıt sayısı 200 sınırında sabit kalır.
- **Kanıtlanan darboğaz:** belge sorgusu (5.000 dosyada soğuk SQL süresinin
  ~%76'sı). Sebep, sorgu planı değil, **binlerce elemanlı `case_id = ANY($2::uuid[])`
  dizi parametresinin taşınması ve eşleştirilmesiydi**.

### Uygulanan optimizasyon

Belge ve görev sorgularında dosya kimliği dizisi parametresi yerine `cases` tablosuna
join eklendi (`c.lifecycle_status='open'`). Küme birebir aynıdır — kimlikler zaten
aynı sorgudan geliyordu — ancak parametre yükü hacimden bağımsız hâle geldi.
Yalnız length için kullanılan `caseIds` dizisi de kaldırıldı.

İş kuralları, sıralama, dedupe davranışı ve 200 sınırı **değiştirilmedi**. Cache,
materialized view, background worker, yeni tablo veya migration **eklenmedi**.

### Sonra (Paket 51)

| Açık dosya | Sorgu | Soğuk toplam | Isınmış medyan | Isınmış SQL | Isınmış kural | Dönen uyarı |
|---|---|---|---|---|---|---|
| 100 | 4 | 23,3 ms | 8,7 ms | 4,9 ms | 3,3 ms | 200 |
| 1.000 | 4 | 41,6 / 72,6 ms | 49,6 / 39,7 ms | 32,0 / 22,4 ms | 17,6 / 17,2 ms | 200 |
| 5.000 | 4 | 200,5 / 190,4 ms | 188,9 / 179,9 ms | 102,6 / 101,7 ms | 78,1 / 78,1 ms | 200 |

İki bağımsız örnek verilmiştir (`a / b`), çünkü tek koşumda oynaklık gözlendi —
örneğin 1.000 dosyada bir koşumun ısınmış medyanı soğuk koşumdan yüksek çıktı.
5.000 dosyadaki iyileşme iki örnekte de tutarlıdır: **382 ms → ~180-190 ms (~%51)**.

Belge sorgusu 5.000 dosyada 190,8 ms → ~161 ms (yalnız join değişikliğiyle ölçülen ara
adım), toplam ısınmış süre ise dizi kurulumunun da kalkmasıyla ~180-190 ms'ye indi.

### Regresyon koruması

`services/api/test/operational-alerts-scaling.test.ts` süre ölçmez. Korunan sınırlar:

- Sorgu sayısı 25 ve 400 dosyada aynıdır ve 4'tür (N+1 yasağı).
- En büyük sorgu parametre yükü hacimden bağımsızdır ve 10 elemandan küçüktür.
  (Bu iddia doğrulandı: eski `ANY($2::uuid[])` hâli bu testi 401 ≠ 26 ile düşürüyor.)
- Açık dosyası olmayan organization için tek sorgu yeterlidir.
- Hacim altında 200 sınırı, mükerrerlik yokluğu, sıralama ve tenant sınırı korunur.
- Tekrarlı çağrılar birebir aynı sonucu verir.

### Açık risk

Maliyet okuma anındadır ve dosya sayısıyla doğrusal büyür. 5.000 açık dosyada
~180-190 ms kabul edilebilir; çok daha büyük hacimlerde (ör. 20.000+ açık dosya)
yeniden ölçüm gerekir. Cache ve materialized view bilinçli olarak kapsam dışıdır.
