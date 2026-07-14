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
| `coverageOutcome` | Kapsam sonucu (beş durum): `teminat_kapsaminda` / `sartli_kapsamda` / `kapsam_disi` / `bilgi_yetersiz` / `kaynaklar_celiskili` |
| `deductible` | Uygulanacak muafiyet/tenzil: tür + oran/tutar + matrah + asgari/azami |
| `costShare` | Poliçe kaynaklı maliyet paylaşımı (sigorta payı / araç sahibi payı); oran sabit kodlanmaz, kaynak klozdan çıkarılır |
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
2. Sonuç beş durumdan biridir: **teminat kapsamında**, **şartlı kapsamda** (koşul listesiyle), **kapsam dışında**, **bilgi yetersiz**, **kaynaklar çelişkili**.
3. `bilgi_yetersiz` ve `kaynaklar_celiskili` asla sessizce `kapsamda` veya `kapsam dışı` sayılmaz; kullanıcıya eksik/çelişkili nokta gösterilir.
4. Birden fazla kural çelişirse otomatik öncelik uydurulmaz; çelişki `policy_conflicts` kaydıyla kullanıcıya sunulur.
5. Poliçe ↔ ihbar föyü ↔ diğer belgeler (ruhsat, Tramer, beyan) çelişirse sistem **sessizce seçim yapmaz**; çelişkiyi alan bazında gösterir ve çözümü kullanıcı onayına bırakır.
6. Operasyonu bağlayan sonuç (muafiyet uygulama, kapsam dışı bırakma, tedarik engeli) yalnız insan onayıyla kesinleşir (`policy_human_approvals`).

## 3. AI cevap standardı

Kasko poliçesi hakkındaki her AI cevabı şu dokuz bölümü içerir:

1. **Sonuç ve kapsam durumu**
2. **Gerekçe**
3. **Muafiyet, tenzil, maliyet paylaşımı veya limit**
4. **Servis ve parça şartı**
5. **Yapılması gereken işlem ve gerekli belgeler**
6. **Kaynak belge, sayfa, başlık ve kloz**
7. **Çelişki veya eksik bilgi**
8. **Güven seviyesi**
9. **İnsan onayı gereksinimi**

Kurallar:

- AI **tahmin yürütmez**; poliçede hüküm yoksa cevap "**Poliçede bu konuda açık ve doğrulanabilir bir hüküm bulunamadı.**" ifadesini kullanır.
- Genel sektör bilgisi, poliçe hükmü gibi sunulamaz; sunulursa açıkça "poliçe dışı genel bilgi" etiketi taşır.
- Her cevap `policy_ai_assessments` kaydı üretir; kaynak referansları zorunludur.
- AI sonucu tek başına dosya alanı değiştirmez (AGENTS.md §6, SECURITY_AND_AI_POLICY).

## 4. Muafiyetli dosya iş akışı (senaryo örneği)

`trigger: muafiyet_tespit_edildi` → zorunlu ilk adımlar:

| # | Adım | Modellenen kayıt |
|---|---|---|
| 1 | Tedarik **geçici olarak durdurulur** | `policy_action_holds: tedarik` (kloz referanslı) |
| 2 | Mobil onarım **geçici olarak durdurulur** | `policy_action_holds: mobil_onarim` |
| 3 | Dosya sorumlusuna bilgi | Bildirim + görev (sonuç notu zorunlu) |
| 4 | Servise bilgi | Servis görüşmesi görevi (sonuç notu zorunlu) |
| 5 | Kaynak madde + olası oran/tutar + alternatif aksiyonlar gösterilir | AI değerlendirme + kaynak referansı |

Aksiyon seçenekleri (insan onaylı):

| Seçenek | Sonuç |
|---|---|
| Poliçeye uygun servis/yöntem seçilir | Muafiyet **yeniden değerlendirilir**; engel kalkarsa normal süreç devam eder (`policy_action_holds` kapatılır) |
| Araç sahibi mevcut serviste kalır | Poliçedeki **gerçek muafiyet, tenzil veya maliyet paylaşımı uygulanır**; oran sabit kodlanmaz, kaynak kloz ve matrahtan çıkarılır (`policy_cost_shares`) |
| Uygun çözüm kabul edilmezse | Portal notu (`policy_portal_notes`) + dosya sorumlusunun açık onayı + gerekçeyle **bekletme veya kapatma** |

Hiçbir kritik aksiyon insan onayı olmadan kesinleşmez; durdurmaların kaldırılması dahil her adım `policy_decision_history` + audit üretir. Muafiyetli kapanışta ilgili poliçe klozu, portal notu, sorumlu onayı ve uygulanan maliyet paylaşımı ayrıca kaydedilir.

## 5. Örnek senaryo kuralları (biçim örneği, bağlayıcı içerik değil)

- **Cam hasarı:** `trigger: cam_hasari` + `condition: anlasmali_cam_servisi_kullanildi=false` → `sartli_kapsamda`, `deductible: tenzil %X`, `serviceRequirement: anlasmali_cam`, kaynak: kloz "Cam Kırılması Özel Şartı", s. N.
- **Anahtarla çalınma:** `trigger: calinma` + `condition: anahtar_aracta=true` → kloza göre `kapsam_disi` veya `sartli` — poliçeden çıkarılır, varsayılmaz.
- **İkame araç:** `trigger: ikame_talebi` → `teminat_kapsaminda`, `limit: yilda 2 olay x 7 gun` (poliçeden), araç sınıfı koşulu.
- **LPG'li araç:** `trigger: yangin` + `condition: lpg_ruhsatta_islenmemis` → kloza göre `kapsam_disi` olabilir; hüküm bulunamazsa `bilgi_yetersiz` olarak kullanıcıya sorulur.

Bu örnekler yalnız kural biçimini gösterir; gerçek değerler her poliçenin kendi metninden, kaynak referanslı çıkarılır.

## 6. Test ve kabul bağlantısı

`TESTING_AND_ACCEPTANCE.md` domain regresyon setine kasko poliçe senaryoları eklenir: anonim poliçe fixture'ları üzerinde muafiyet tespiti (genel + koşullu), beş durumlu kapsam sonucu, çelişki üretimi, "Poliçede bu konuda açık ve doğrulanabilir bir hüküm bulunamadı." davranışı ve muafiyetli dosya akış adımları (12 zorunlu senaryo listesi TESTING_AND_ACCEPTANCE.md içindedir). Gerçek müşteri poliçesi test fixture'ı olamaz.

## 7. Paket 23 yürütülebilir kural sınırı

- İlk kural sürümü `2026.07.14.1` ve sonuç kümesi `covered | excluded | conditional | control_required | unknown` olarak sabitlenmiştir.
- Eşleşme; hasar/ihbar LocalDate'i, sigortacı, servis profili, sigortacıya özel servis anlaşması, hasar kategorisi, onarım yöntemi, istenen operasyon ve doğrulanmış belge durumunu kullanır.
- Aynı precedence seviyesinde çelişen sonuçlar otomatik seçilmez. Açık conflict veya onaylanmamış analiz `control_required`; kaynak bulunmaması `unknown` üretir.
- Birden fazla muafiyet kod bazında tekilleştirilerek kaybolmadan döner. Tutar, oran, sigortacı/sigortalı payı yalnız kaynaklı rule/fact'ten gelir; sabit oran yoktur.
- Muafiyet ihtimali veya kesin olmayan sonuç tedarik ve mobil onarım tavsiyesini fail-closed yapar. Bu çıktı karar desteğidir; gerçek tedarik veya iş emri yazmaz.
