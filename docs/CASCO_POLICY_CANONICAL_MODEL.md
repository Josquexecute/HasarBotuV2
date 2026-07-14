# HasarBotu V2 — Kasko Poliçesi Kanonik Modeli

Tarih: 2026-07-12
Durum: Planlama belgesi (Paket 04.5). Şema/migration değildir; Paket 05+ veri tasarımına girdi sağlar.
İlgili belgeler: `CASCO_POLICY_ANALYSIS_PLAN.md`, `CASCO_POLICY_SCENARIO_RULES.md`, `DATABASE_MODEL_PLAN.md`

## 1. Modelleme ilkeleri

- Kanonik alanlar sigorta şirketinden bağımsızdır; şirket başlığı ve orijinal metin ayrıca korunur.
- Her kanonik değer kaynak referansı taşır: belge + sayfa + başlık/kloz (+ mümkünse karakter aralığı).
- Her çıkarım güven seviyesi ve insan onayı durumu taşır; onaysız çıkarım operasyonu bağlamaz.
- Para tutarları para birimiyle; oranlar açık yüzde alanıyla tutulur. Parça bedeli bağlamında tutarlar **KDV hariç ve iskontosuz** esasa göre yorumlanır.
- Bilinmeyen/bulunamayan alan değeri `belirsiz` olarak işaretlenir; varsayılan değer üretilmez. Olay kapsam sonucunda ise belirsizlik iki ayrı duruma ayrılır: `bilgi_yetersiz` (hüküm bulunamadı) ve `kaynaklar_celiskili` (belgeler çelişiyor).

## 2. Gelecek veri kavramları (Paket 05+ değerlendirme listesi)

SQL veya migration üretilmez; aşağıdaki kavramlar `DATABASE_MODEL_PLAN.md` destekleyici tablo değerlendirmesine eklenmiştir.

| Kavram | Sorumluluk |
|---|---|
| `policy_documents` | Dosyaya bağlı poliçe belgesi kaydı (belge referansı, hash, şirket, poliçe no) |
| `policy_versions` | Aynı poliçenin zeyil/yeniden basım sürümleri; yürürlük aralıkları ve öncelik |
| `policy_pages` | Sayfa düzeyinde metin/anlamlandırma kaydı (kaynak referansların temeli) |
| `policy_sections` | Mantıksal bölümler (ihbar föyü / poliçe / özel şartlar / zeyil ayrımı) |
| `policy_extractions` | Bir sürüm üzerinde koşan çıkarım turu (yöntem, **model sürümü**, çıkarım zamanı, güven özeti, durum) |
| `policy_canonical_fields` | Kanonik alan değerleri (alan anahtarı, değer, birim, güven, onay durumu, `sourceLabel`) |
| `policy_clauses` | Orijinal kloz/özel şart kayıtları (başlık, tam metin, sayfa aralığı, sıra) |
| `policy_coverages` | Teminat kalemleri (kanonik teminat anahtarı + şirket adı) |
| `policy_limits` | Teminat başına limitler (tutar/oran, olay başına/yıllık) |
| `policy_deductibles` | Genel ve koşullu muafiyet/tenzil kayıtları (tür, oran/tutar, matrah, asgari/azami, koşul, uygulandığı teminat) |
| `policy_cost_shares` | Poliçe kaynaklı maliyet paylaşımı kayıtları (sigorta payı / araç sahibi payı, matrah, koşul, kaynak kloz) |
| `policy_exclusions` | İstisna / teminat dışı haller (genel şart + özel kloz kaynaklı) |
| `policy_service_rules` | Servis şartı kuralları (yetkili/anlaşmalı/serbest; koşullar) |
| `policy_part_rules` | Tedarik parça türü kuralları (orijinal/eşdeğer/çıkma; araç yaşı koşulları) |
| `policy_required_documents` | Poliçenin saydığı hasar belgeleri |
| `policy_scenario_rules` | Olay-bazlı senaryo kuralları (bkz. `CASCO_POLICY_SCENARIO_RULES.md`) |
| `policy_source_references` | Kanonik alan/kural ↔ kaynak metin izlenebilirlik bağı (belge, sayfa, kloz, ham metin aralığı) |
| `policy_external_references` | Harici web klozu atıfları (URL, erişim tarihi, içerik hash, arşivlenen sürüm) |
| `policy_conflicts` | Poliçe ↔ ihbar föyü ↔ özet ↔ zeyil çelişkileri (alan, taraflar, durum, çözüm notu) |
| `policy_ai_assessments` | AI kapsam/muafiyet değerlendirmeleri (soru, dokuz bölümlü cevap, güven, kaynaklar) |
| `policy_human_approvals` | İnsan onayları (kim, ne zaman, hangi çıkarım/kural, karar, gerekçe) |
| `policy_action_holds` | Operasyon durdurmaları (tedarik/mobil onarım geçici durdurma; kaldırma koşulu + onay) |
| `policy_portal_notes` | Portala girilen muafiyet/karar notlarının kaydı |
| `policy_decision_history` | Poliçe kaynaklı operasyon kararlarının zaman çizelgesi |
| `part_price_references` | Parça referans bedeli kayıtları (KDV hariç iskontosuz liste bedeli + kaynak/tarih/belge) |
| `ai_usage_ledger` | AI kullanım/maliyet defteri (modül, kullanıcı, model, dosya bazlı) |

Yol haritası ayrıca yedekleme kanıtı için `backup_runs` ve `restore_test_runs` kavramlarını tanımlar (bkz. `DATABASE_MODEL_PLAN.md`). Her kavram sürüm, kaynak, audit, hassas veri sınıfı ve saklama politikasıyla birlikte planlanır; poliçe ham metni saklanacağı için hassas veri sınıflandırması Paket 05+ şemasında zorunlu tasarım girdisidir.

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
- `deductibles[]`: `kind` (`genel`, `kosullu`, `tenzil`), `basis` (oran/tutar) + matrah, `value`, `minAmount`, `maxAmount`, `appliesToCoverageKey`, `condition` (serbest metin + yapılandırılmış tetik), `sourceClauseRef`. **"Muafiyetsiz" genel değeri, `kosullu` kayıtların taranmasını engellemez.**
- `costShares[]`: poliçe kaynaklı maliyet paylaşımı — `insurerSharePercent`/`ownerSharePercent` veya tutar, matrah, koşul (ör. anlaşmasız serviste kalma), `sourceClauseRef`. Oran/paylaşım sabit kodlanmaz; kaynak klozdan çıkarılır.
- `exclusions[]`: `scope` (genel şart / özel kloz), `summary`, `sourceClauseRef`.

### 3.4 Servis, parça ve onarım hükümleri

| Alan | Değerler |
|---|---|
| `repairShopRequirement` | `yetkili` `anlasmali` `serbest` `sartli` `belirsiz` (+ koşul) |
| `partsTypeRequirement` | `orijinal` `esdeger` `cikma` `yasa_gore` `sartli` `belirsiz` (+ araç yaşı koşulu) |
| `glassServiceRequirement` | anlaşmalı cam servisi şartı + tenzil koşulu |
| `miniRepair` | **Poliçe teminatı/hizmetidir:** hak, kapsam, adet, kısıtlar |
| `mobileRepair` | **Operasyon yöntemidir**; mini onarımdan ayrı alan/kural/durumla modellenir; muafiyet tespitinde geçici durdurma kuralıyla kesişir |
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
| `coverageStatusForIncident` | senaryo değerlendirme çıktısı (beş durum): `kapsamda` `sartli` `kapsam_disi` `bilgi_yetersiz` `kaynaklar_celiskili` |
| `replacementVehicleStatus` | hak/kullanım takibi |
| `operationBlocks[]` | özel kloz kaynaklı **geçici** operasyon durdurmaları (`policy_action_holds`: muafiyet → tedarik/mobil onarım durdurma), kloz referanslı; kaldırma koşulu + insan onayı taşır |
| `valueLossLegalRequirement` | mevzuat/ürün kuralı: Trafik zorunlu, Kasko isteğe bağlı |
| `valueLossOfficePolicy` | ofis kuralı: eksper talimatıyla Kasko'da da çalışılır; sürümlü, firma bazlı |

## 4. İzlenebilirlik yapısı

Her kanonik değer ve senaryo kuralı şu referans zincirini taşır:

`policy_canonical_fields.value` → `policy_source_references` → (`policy_documents`/`policy_versions`, `page`, `policy_clauses.id`, opsiyonel karakter aralığı)

Orijinal metin (`policy_clauses.text`) hiçbir normalizasyonda silinmez; kanonik değer değişirse eski çıkarım `policy_extractions` sürümüyle korunur.

## 5. Parça bedeli izlenebilirliği

Parça bedeli kayıtları (işçilik/parça modülü) şu alanları taşır: `amountExclVat` (KDV hariç), `undiscounted: true` esası, `priceSource` (liste/portal/belge), `priceDate`, `priceDocumentRef`. Bu kavramlar Paket 05+ `parts` tablolarının tasarımına girdi olarak eklenmiştir; burada şema üretilmez.

## 6. Paket 23 kanonik persistence sınırı

Paket 23'te kanonik model tek bir doğrulanamaz JSON belgeye gömülmez. Kimlik ve sürüm `policy_analyses` / `policy_analysis_versions`; kaynaklar `policy_source_references`; teminat, muafiyet, servis, parça, ikame araç, istisna ve gerekli belgeler ayrı doğrulanabilir fact tablolarında tutulur. Değişken koşul ifadeleri ve güvenli scenario snapshot'ı JSONB olabilir; her uygulanabilir fact/rule `policy_evidence_links` üzerinden immutable kaynak referansına bağlanır.

Kanonik değer orijinal başlık veya sınırlı kaynak alıntısının yerine geçmez. Kaynak belgenin yeni fiziksel sürümü yeni analiz sürümü gerektirir; onaylı önceki sürüm ve kaynak zinciri korunur. Approved sürümde fact/source mutation DB guard ile reddedilir.
