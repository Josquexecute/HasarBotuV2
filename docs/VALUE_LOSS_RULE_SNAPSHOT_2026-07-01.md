# Paket 66 — 01.07.2026 Değer Kaybı Kaynak Snapshot'ı

## Kapsam

Bu belge yalnız Paket 66 Commit #1'i açıklar:

- generic salt-okunur OOXML extractor,
- relationship tabanlı workbook/sheet/sharedStrings çözümleme,
- `real-market-analysis/2026-07-01/1.0.0` kimlikli normalize snapshot,
- açık `product_decision` overlay'i,
- redacted manifest ve JSON Schema,
- deterministik hash ve regresyon testleri.

Bu commit hesap motorunu, mevcut Paket 32 değer kaybı davranışını, API/UI,
persistence, migration veya fiziksel Excel yazımını değiştirmez.

## Kaynak ve bütünlük

- Kaynak dosya adı:
  `Yeni Dönem Değer Kaybı Hesaplama Modülü 01.07.2026 V_1.xlsx`
- Kaynak SHA-256:
  `81d3ae870cd5569b13371ec8b4de081a9a4e3e15098f7454f5d0cdcd3708c424`
- Snapshot identity:
  `real-market-analysis/2026-07-01/1.0.0`
- Canonical snapshot SHA-256:
  `e4fc8087ddbc1ff92e3255546e053c6956e20bd1dca269533113b727f728b940`

Üretici başlangıçta beklenen hash'i fail-closed doğrular ve çıkarım sonunda
workbook'u tekrar okuyarak başlangıç/bitiş hash eşitliğini zorunlu tutar.
Manifest yalnız dosya adını taşır; harici tam dosya yolu taşımaz.

## Bölünmüş provenance

Workbook'un `Tablolar!C3:C16` hücrelerinden çıkan kanonik kod sırası:

`A, A, B, B, C, C, C, D, D, D, Ç, E, F, Ç`

`source_workbook` mapping sayısı 3'tür:

- TAKSİ → A
- MİNİBÜS → B
- OTOBÜS → B

Kalan 11 mapping `product-decisions.json` içinde ayrı
`product_decision` provenance'ıyla tutulur. Product decision kaydı
`source_workbook` olarak yeniden etiketlenirse snapshot doğrulaması başarısız
olur. Görev DOCX'i ve orphan sharedStrings mapping kaynağı değildir.

## Aktif parça tabloları

| Tablo | Kaynak aralık | Kaynak satır | Üretilen kural |
|---|---|---:|---:|
| A | `Tablolar!B34:L67` | 32 | 32 |
| B | `Tablolar!B70:L116` | 46 | 46 |
| C/Ç | `Tablolar!B119:L150` | 28 | 56 |
| D | `Tablolar!B155:L186` | 13 | 13 |
| E | `Tablolar!B192:L223` | 7 | 7 |
| F | `Tablolar!B228:L259` | 4 | 4 |

C/Ç ortak kaynak tablosu iki araç grubu için ayrı stable ID üretir. Stable ID;
araç grubu, kaynak tablo, kaynak satır, normalize etiket ve işlem
capability bileşenlerini içerir. `0`/boş placeholder satırlar ile
`Tablolar!B299:B350` sigortacı listesi aktif kurallara alınmaz.

## Dormant, excluded ve anomaliler

Dormant:

- `Tablolar!E2:R9` kullanılmayan piyasa/rayiç katsayı tablosu,
- `Tablolar!B264:L295` SONRADAN EKLENENLER,
- gizli `Sheet1`.

Excluded:

- sigortacı listesi,
- boş/`0` placeholder parça satırları,
- satır 27 / 79 artık değeri.

Snapshot şu forensic anomalileri açıkça korur:

- `source_vehicle_name_column_incomplete`
- `orphan_shared_strings_not_vehicle_mapping_source`
- `source_validation_adjustment_list_f12`
- `source_validation_adjustment_list_z2`
- `source_cached_name_error`
- `source_cached_div0_error`
- `source_age_table_reverse_order`
- `source_row_27_residual_79`
- `source_hidden_sheet`
- `source_unused_insurer_list`
- `source_unused_market_value_coefficient_table`
- `source_year_c13_formula_error`
- `source_scratch_cells_m18_m19`
- `source_unwired_j11`
- `source_later_additions_dormant`

## Tekrar üretim

Önce domain ve File Agent paketleri build edilir. Ardından:

```powershell
node scripts/package66-value-loss-snapshot.mjs --workbook '<workbook-path>' --write
```

`--write` verilmezse üretici snapshot'ı doğrular ve özet döndürür; repository
artefaktlarını değiştirmez. Kaynak workbook hiçbir durumda değiştirilmez veya
repository'ye kopyalanmaz.
