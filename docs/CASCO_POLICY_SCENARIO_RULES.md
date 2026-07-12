# HasarBotu V2 — Kasko Poliçesi Senaryo Kuralları

Tarih: 2026-07-12
Durum: Planlama belgesi (Paket 04.5). Kural motoru kodu içermez; kural modelini ve değerlendirme sözleşmesini tanımlar.
İlgili belgeler: `CASCO_POLICY_ANALYSIS_PLAN.md`, `CASCO_POLICY_CANONICAL_MODEL.md`, `SECURITY_AND_AI_POLICY.md`

## 1. Senaryo kuralı yapısı

Her poliçe kuralı olay-bazlı senaryo kuralı olarak modellenir (`policy_scenario_rules`):

| Alan | Açıklama |
|---|---|
| `trigger` | Olay/tetik: hasar türü veya operasyon olayı (ör. `cam_hasari`, `carpma`, `calinma`, `sel`, `ikame_talebi`, `tedarik_talebi`) |
| `conditions[]` | Koşullar: sürücü yaşı, servis türü, hasar tutarı eşiği, araç yaşı, anahtar durumu vb. |
| `coverageOutcome` | Kapsam sonucu: `teminat_kapsaminda` / `sartli_kapsamda` / `kapsam_disi` / `belirsiz` |
| `deductible` | Uygulanacak muafiyet/tenzil: tür + oran/tutar + asgari/azami |
| `limit` | Uygulanacak limit (tutar/oran, olay başına/yıllık) |
| `exceptions[]` | Kuralı bozan istisnalar |
| `requiredDocuments[]` | Bu senaryoda istenen belgeler |
| `serviceRequirement` | Servis şartı (yetkili/anlaşmalı/…) |
| `partsRequirement` | Parça türü şartı |
| `actions[]` | Yapılacak işlem(ler): bildirim, görev, portal notu, operasyon engeli |
| `sourceRef` | Kaynak: sayfa + başlık + kloz (`policy_source_references`) |
| `extractionConfidence` | Çıkarım güven seviyesi |
| `requiresHumanApproval` | İnsan onayı gereksinimi (operasyonu bağlayan her sonuç için `true`) |

Kurallar sürümlüdür: poliçe sürümü (`policy_versions`) değişirse kurallar yeniden türetilir; eski kural seti korunur (sabit kodlama yok, AGENTS.md §8).

## 2. Değerlendirme sözleşmesi

Bir hasar/operasyon olayı değerlendirilirken:

1. Olaya uyan kurallar seçilir (trigger + koşul eşleşmesi).
2. Sonuç dört durumdan biridir: **teminat kapsamında**, **şartlı kapsamda** (koşul listesiyle), **kapsam dışında**, **belirsiz**.
3. `belirsiz` asla sessizce `kapsamda` veya `kapsam dışı` sayılmaz; kullanıcıya eksik/çelişkili nokta gösterilir.
4. Birden fazla kural çelişirse otomatik öncelik uydurulmaz; çelişki `policy_conflicts` kaydıyla kullanıcıya sunulur.
5. Poliçe ↔ ihbar föyü ↔ diğer belgeler (ruhsat, Tramer, beyan) çelişirse sistem **sessizce seçim yapmaz**; çelişkiyi alan bazında gösterir ve çözümü kullanıcı onayına bırakır.
6. Operasyonu bağlayan sonuç (muafiyet uygulama, kapsam dışı bırakma, tedarik engeli) yalnız insan onayıyla kesinleşir (`policy_human_approvals`).

## 3. AI cevap standardı

Kasko poliçesi hakkındaki her AI cevabı şu bölümleri içerir:

1. **Sonuç**
2. **Gerekçe**
3. **Muafiyet veya limit**
4. **Servis ve parça şartı**
5. **Yapılması gereken işlem**
6. **Kaynak sayfa ve kloz**
7. **Çelişki veya eksik bilgi**
8. **Güven seviyesi**

Kurallar:

- AI **tahmin yürütmez**; poliçede hüküm yoksa cevap "**poliçede açık hüküm bulunamadı**" ifadesini kullanır.
- Genel sektör bilgisi, poliçe hükmü gibi sunulamaz; sunulursa açıkça "poliçe dışı genel bilgi" etiketi taşır.
- Her cevap `policy_ai_assessments` kaydı üretir; kaynak referansları zorunludur.
- AI sonucu tek başına dosya alanı değiştirmez (AGENTS.md §6, SECURITY_AND_AI_POLICY).

## 4. Muafiyetli dosya iş akışı (senaryo örneği)

`trigger: muafiyet_tespit_edildi` → `actions[]` şu sıralı adımları üretir:

| # | Adım | Modellenen kayıt |
|---|---|---|
| 1 | Tedarik yapılmaz | `operationBlocks: tedarik_engeli` (kloz referanslı) |
| 2 | Mobil onarım yapılmaz | `operationBlocks: mobil_onarim_engeli` |
| 3 | Dosya sorumlusuna bilgi | Bildirim + görev (sonuç notu zorunlu) |
| 4 | Servise bilgi | Servis görüşmesi görevi (sonuç notu zorunlu) |
| 5 | Servis değişikliği beklenir | Takip görevi + takip tarihi |
| 6 | Servis değiştirilmezse | Operasyon engelleri aktif kalır; başka operasyon yapılmaz |
| 7 | Portala muafiyet notları | Portal notu kaydı (girildi bilgisi + tarih) |
| 8 | Sorumlu onayıyla kapanış | Onay kaydı → kapanış akışı (AGENTS.md §7 kritik işlem modeli, audit) |

Engellerin kaldırılması yalnız koşulun ortadan kalkmasıyla (servis değişti, muafiyet onaylanmadı vb.) ve kullanıcı onayıyla olur; her adım audit üretir.

## 5. Örnek senaryo kuralları (biçim örneği, bağlayıcı içerik değil)

- **Cam hasarı:** `trigger: cam_hasari` + `condition: anlasmali_cam_servisi_kullanildi=false` → `sartli_kapsamda`, `deductible: tenzil %X`, `serviceRequirement: anlasmali_cam`, kaynak: kloz "Cam Kırılması Özel Şartı", s. N.
- **Anahtarla çalınma:** `trigger: calinma` + `condition: anahtar_aracta=true` → kloza göre `kapsam_disi` veya `sartli` — poliçeden çıkarılır, varsayılmaz.
- **İkame araç:** `trigger: ikame_talebi` → `teminat_kapsaminda`, `limit: yilda 2 olay x 7 gun` (poliçeden), araç sınıfı koşulu.
- **LPG'li araç:** `trigger: yangin` + `condition: lpg_ruhsatta_islenmemis` → kloza göre `kapsam_disi` olabilir; `belirsiz` ise kullanıcıya sorulur.

Bu örnekler yalnız kural biçimini gösterir; gerçek değerler her poliçenin kendi metninden, kaynak referanslı çıkarılır.

## 6. Test ve kabul bağlantısı

`TESTING_AND_ACCEPTANCE.md` domain regresyon setine kasko poliçe senaryoları eklenir: anonim poliçe fixture'ları üzerinde muafiyet tespiti (genel + koşullu), kapsam sonucu dört durumu, çelişki üretimi, "açık hüküm bulunamadı" davranışı ve muafiyetli dosya akış adımları. Gerçek müşteri poliçesi test fixture'ı olamaz.
