# HasarBotu V2 — Kasko Poliçesi Kanonik Modeli

Tarih: 2026-07-12
Durum: Planlama belgesi (Paket 04.5). Şema/migration değildir; Paket 05+ veri tasarımına girdi sağlar.
İlgili belgeler: `CASCO_POLICY_ANALYSIS_PLAN.md`, `CASCO_POLICY_SCENARIO_RULES.md`, `DATABASE_MODEL_PLAN.md`

## 1. Modelleme ilkeleri

- Kanonik alanlar sigorta şirketinden bağımsızdır; şirket başlığı ve orijinal metin ayrıca korunur.
- Her kanonik değer kaynak referansı taşır: belge + sayfa + başlık/kloz (+ mümkünse karakter aralığı).
- Her çıkarım güven seviyesi ve insan onayı durumu taşır; onaysız çıkarım operasyonu bağlamaz.
- Para tutarları para birimiyle; oranlar açık yüzde alanıyla tutulur. Parça bedeli bağlamında tutarlar **KDV hariç ve iskontosuz** esasa göre yorumlanır.
- Bilinmeyen/bulunamayan değer `belirsiz` olarak işaretlenir; varsayılan değer üretilmez.

## 2. Gelecek veri kavramları (Paket 05+ değerlendirme listesi)

SQL veya migration üretilmez; aşağıdaki kavramlar `DATABASE_MODEL_PLAN.md` destekleyici tablo değerlendirmesine eklenmiştir.

| Kavram | Sorumluluk |
|---|---|
| `policy_documents` | Dosyaya bağlı poliçe belgesi kaydı (belge referansı, hash, şirket, poliçe no) |
| `policy_versions` | Aynı poliçenin zeyil/yeniden basım sürümleri; yürürlük aralıkları |
| `policy_extractions` | Bir sürüm üzerinde koşan çıkarım turu (yöntem, tarih, güven özeti, durum) |
| `policy_canonical_fields` | Kanonik alan değerleri (alan anahtarı, değer, birim, güven, onay durumu, `sourceLabel`) |
| `policy_clauses` | Orijinal kloz/özel şart kayıtları (başlık, tam metin, sayfa aralığı, sıra) |
| `policy_coverages` | Teminat kalemleri (kanonik teminat anahtarı + şirket adı) |
| `policy_limits` | Teminat başına limitler (tutar/oran, olay başına/yıllık) |
| `policy_deductibles` | Genel ve koşullu muafiyet/tenzil kayıtları (tür, oran/tutar, asgari/azami, koşul, uygulandığı teminat) |
| `policy_exclusions` | İstisna / teminat dışı haller (genel şart + özel kloz kaynaklı) |
| `policy_scenario_rules` | Olay-bazlı senaryo kuralları (bkz. `CASCO_POLICY_SCENARIO_RULES.md`) |
| `policy_source_references` | Kanonik alan/kural ↔ kaynak metin izlenebilirlik bağı (belge, sayfa, kloz, aralık) |
| `policy_conflicts` | Poliçe ↔ ihbar föyü ↔ diğer belge çelişkileri (alan, taraflar, durum, çözüm notu) |
| `policy_ai_assessments` | AI kapsam/muafiyet değerlendirmeleri (soru, cevap bölümleri, güven, kaynaklar) |
| `policy_human_approvals` | İnsan onayları (kim, ne zaman, hangi çıkarım/kural, karar, gerekçe) |

## 3. Kanonik alan grupları

Alan anahtarları İngilizce `camelCase` teknik sözleşme diliyle verilir (API_CONTRACT_PLAN §1); UI Türkçe etiket eşlemesi ayrı katmandır.

### 3.1 Ürün ve yürürlük

| Kanonik alan | Tip | Not |
|---|---|---|
| `productName` | string | Şirketin ürün adı (orijinal) |
| `productTier` | enum | `dar` `standart` `genisletilmis` `tam` `belirsiz` — DOMAIN_RULES kasko türleriyle hizalı |
| `policyNumber`, `endorsementNumber` | string | Zeyil no ayrı |
| `effectiveFrom`, `effectiveTo` | LocalDate | Hasar tarihinde yürürlük kontrolü |
| `endorsements[]` | liste | Zeyil türü, tarihi, etkisi |
| `premiumDebtClause` | yapı | Prim borcu/mahsup hükmü var mı; etkisi (mahsup / askıya alma / `belirsiz`) |

### 3.2 Araç ve kullanım

`plate`, `chassisNo`, `modelYear`, `usageType` (hususi/ticari/…), `lpgFitted`, `isElectricVehicle`, `accessories[]` (tanım, bedel, teminat durumu), `batteryCoverage` (elektrikli araç için ayrı hüküm).

### 3.3 Teminat, limit, muafiyet

- `coverages[]`: `coverageKey` (kanonik: `collision`, `theft`, `fire`, `glass`, `flood`, `earthquake`, `terror`, `tpl_increase`, `personal_accident`, `replacement_vehicle`, `roadside_towing`, `mini_repair`, `legal_protection`, `other`), `sourceLabel`, `included` (`evet`/`hayir`/`sartli`/`belirsiz`).
- `limits[]`: `coverageKey`, `amount`/`ratePercent`, `perEvent`/`perYear`, para birimi.
- `deductibles[]`: `kind` (`genel`, `kosullu`, `tenzil`), `basis` (oran/tutar), `value`, `minAmount`, `maxAmount`, `appliesToCoverageKey`, `condition` (serbest metin + yapılandırılmış tetik), `sourceClauseRef`. **"Muafiyetsiz" genel değeri, `kosullu` kayıtların taranmasını engellemez.**
- `exclusions[]`: `scope` (genel şart / özel kloz), `summary`, `sourceClauseRef`.

### 3.4 Servis, parça ve onarım hükümleri

| Alan | Değerler |
|---|---|
| `repairShopRequirement` | `yetkili` `anlasmali` `serbest` `sartli` `belirsiz` (+ koşul) |
| `partsTypeRequirement` | `orijinal` `esdeger` `cikma` `yasa_gore` `sartli` `belirsiz` (+ araç yaşı koşulu) |
| `glassServiceRequirement` | anlaşmalı cam servisi şartı + tenzil koşulu |
| `miniMobileRepair` | hak, kapsam, adet, kısıtlar; **muafiyetli dosyada mobil onarım yapılmaz** kuralıyla kesişir |
| `replacementVehicle` | hak, gün, olay başına/yıllık, sınıf |
| `towing` | limit, koşul |
| `appreciationDepreciation` | kıymet kazanma/eskime uygulanır mı, oran, koşul |
| `totalLossProvisions` | pert/ağır hasar geçmişi hükümleri, rayiç/tazmin yöntemi (`marketValueMethod`), sovtaj |
| `requiredDocuments[]` | poliçenin saydığı hasar belgeleri |

### 3.5 Operasyon türetilmiş alanları (dosya seviyesi)

| Alan | Kaynak |
|---|---|
| `hasDeductible` | genel alan + kloz taraması birleşimi |
| `deductibleSummary` | tür/oran/koşul özeti + kaynak referansları |
| `coverageStatusForIncident` | senaryo değerlendirme çıktısı: `kapsamda` `sartli` `kapsam_disi` `belirsiz` |
| `replacementVehicleStatus` | hak/kullanım takibi |
| `operationBlocks[]` | özel kloz kaynaklı operasyon engelleri (ör. muafiyet → tedarik/mobil onarım yasağı), kloz referanslı |
| `valueLossLegalRequirement` | mevzuat/ürün kuralı: Trafik zorunlu, Kasko isteğe bağlı |
| `valueLossOfficePolicy` | ofis kuralı: eksper talimatıyla Kasko'da da çalışılır; sürümlü, firma bazlı |

## 4. İzlenebilirlik yapısı

Her kanonik değer ve senaryo kuralı şu referans zincirini taşır:

`policy_canonical_fields.value` → `policy_source_references` → (`policy_documents`/`policy_versions`, `page`, `policy_clauses.id`, opsiyonel karakter aralığı)

Orijinal metin (`policy_clauses.text`) hiçbir normalizasyonda silinmez; kanonik değer değişirse eski çıkarım `policy_extractions` sürümüyle korunur.

## 5. Parça bedeli izlenebilirliği

Parça bedeli kayıtları (işçilik/parça modülü) şu alanları taşır: `amountExclVat` (KDV hariç), `undiscounted: true` esası, `priceSource` (liste/portal/belge), `priceDate`, `priceDocumentRef`. Bu kavramlar Paket 05+ `parts` tablolarının tasarımına girdi olarak eklenmiştir; burada şema üretilmez.
