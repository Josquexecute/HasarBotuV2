# HasarBotu V2 — Kasko Poliçe Analiz Planı

Tarih: 2026-07-12
Durum: Planlama belgesi (Paket 04.5). Runtime kodu, API endpoint'i, SQL veya migration içermez.
İlgili belgeler: `CASCO_POLICY_CANONICAL_MODEL.md`, `CASCO_POLICY_SCENARIO_RULES.md`, `DOMAIN_RULES.md`, `SECURITY_AND_AI_POLICY.md`

## 1. Amaç ve ilke

Kasko poliçesi yalnız özet alanlardan ibaret değildir; **belgenin tamamı kritik karar kaynağıdır**. Muafiyet, teminat kapsamı, servis/parça şartı ve operasyon engelleri çoğu zaman özel şartlarda, klozlarda ve istisna maddelerinde saklıdır. Bu nedenle analiz hedefi "birkaç alan çıkarmak" değil, poliçeyi uçtan uca işleyip izlenebilir kanonik modele dönüştürmektir.

Temel ilkeler:

- Poliçe belgesi baştan sona işlenir; hiçbir bölüm "özet dışı" diye atlanmaz.
- "Muafiyetsiz" genel alanı, özel kloz kaynaklı **koşullu muafiyet bulunmadığı anlamına gelmez**; klozlar ayrıca taranır.
- Çıkarılan her kanonik alan kaynak sayfa/başlık/kloz referansıyla izlenebilir olmalıdır.
- AI yalnız karar desteğidir (AGENTS.md §6); kapsam/muafiyet sonucu kullanıcı onayı olmadan kesinleşmez.
- Belgeler çelişirse sistem sessizce seçim yapmaz; çelişkiyi kullanıcıya gösterir.

## 2. Uçtan uca işlenecek poliçe içeriği

Sistem kasko poliçesinden en az şu grupları işlemelidir:

1. **Ürün kimliği:** poliçe ürünü ve türü (Dar/Standart/Genişletilmiş/Tam veya şirketin ürün adı), poliçe no, zeyil no.
2. **Araç ve kullanım:** plaka, şasi, model yılı, kullanım tarzı (hususi/ticari), LPG/elektrikli araç bilgisi, aksesuarlar.
3. **Teminatlar:** bütün teminat kalemleri (çarpma, çalınma, yanma, cam, sel/su baskını, deprem, terör, ihtiyari mali mesuliyet, ferdi kaza vb.), her biri ayrı kayıt.
4. **Limitler:** teminat başına limit tutarı/oranı, olay başına/yıllık ayrımı.
5. **Muafiyetler:** genel muafiyet + **koşullu muafiyet ve tenziller** (ör. belirli sürücü yaşı, belirli hasar türü, anahtarla çalınma, cam değişiminde tenzil).
6. **Özel şartlar ve klozlar:** şirketin eklediği her kloz; orijinal başlık ve metniyle.
7. **İstisnalar / teminat dışı haller:** hem genel şartlardan hem özel şartlardan.
8. **İkame/kiralık araç:** hak var mı, süre (gün), olay başına/yıllık, araç sınıfı.
9. **Mini onarım ve mobil onarım (ayrı ayrı):** mini onarım poliçe teminatı/hizmetidir, mobil onarım operasyon yöntemidir; hak, kapsam, adet sınırı ve kısıtlar iki kavram için ayrı işlenir.
10. **Cam servisi:** anlaşmalı cam servisi şartı, tenzil koşulları.
11. **Çekici/çekme:** limit ve koşullar.
12. **Onarım servis türü:** yetkili servis / anlaşmalı servis / özel servis şartı; hangi durumda hangi tür.
13. **Tedarik parça türü:** orijinal / eşdeğer / çıkma; araç yaşına göre değişen hükümler.
14. **Kıymet kazanma ve eskime:** uygulama koşulları ve oranlar.
15. **Pert/ağır hasar geçmişi hükümleri:** perte ayrılma, rayiç üzerinden tazmin, sovtaj.
16. **Rayiç ve tazmin yöntemi:** rayiç belirleme kaynağı, tazmin usulü.
17. **İstenen belgeler:** hasar dosyası için poliçenin saydığı belgeler.
18. **Aksesuar, LPG ve elektrikli araç hükümleri:** ek teminat/istisna/limitler (batarya dahil).
19. **Prim borcu ve mahsup:** prim ödenmemişse tazminattan mahsup/teminat askıya alma hükümleri.
20. **Zeyiller ve yürürlük:** zeyil listesi, başlangıç/bitiş, hasar tarihinde yürürlük kontrolü.

## 3. Analiz hattı (pipeline)

Hedef akış (ileri paketlerde uygulanacak; bu belge yalnız planlar):

1. **Belge alımı:** Poliçe PDF'i dosyaya `policy_documents` kavramıyla bağlanır; hash ve sürüm (`policy_versions`) izlenir. Aynı dosyada birden çok poliçe/zeyil sürümü olabilir.
2. **Metin çıkarımı:** Basit PDF metni yerel çıkarılır (AI bütçe politikası); sayfa numaraları korunur.
3. **Yapısal bölümleme:** Başlık/kloz sınırları tespit edilir; her kloz orijinal başlık + orijinal metin + sayfa aralığıyla `policy_clauses` kavramına ayrılır.
4. **Kanonik çıkarım:** Kloz ve tablo içeriklerinden kanonik alanlar (`CASCO_POLICY_CANONICAL_MODEL.md`) üretilir; her alan `policy_source_references` üzerinden kaynağa bağlanır ve `policy_extractions` kaydında çıkarım güven seviyesi taşır.
5. **Senaryo kural üretimi:** Kanonik alanlardan olay-bazlı senaryo kuralları (`CASCO_POLICY_SCENARIO_RULES.md`) türetilir; kurallar `policy_scenario_rules` kavramıyla saklanır.
6. **Çelişki kontrolü:** Poliçe ↔ ihbar föyü ↔ diğer belgeler (ruhsat, Tramer) alan bazında karşılaştırılır; uyuşmazlık `policy_conflicts` kaydı üretir ve kullanıcıya gösterilir. Sistem sessizce taraf seçmez.
7. **AI değerlendirme ve insan onayı:** AI cevapları `policy_ai_assessments` olarak saklanır; operasyonu bağlayan sonuçlar (`muafiyet uygulanır`, `kapsam dışı`) `policy_human_approvals` ile kullanıcı onayına bağlanır.

## 4. Sigorta şirketinden bağımsızlık

Şirketler farklı format, başlık ve terminoloji kullanır. Bu nedenle:

- **Kanonik alanlar** ortaktır ve şirketten bağımsızdır (`policy_canonical_fields`).
- Şirketin **orijinal alan adı/başlığı korunur** (`sourceLabel`).
- **Orijinal madde metni korunur**; kanonik değer asla kaynak metnin yerine geçmez.
- Kanonik alan ↔ kaynak metin bağı `policy_source_references` (belge, sayfa, kloz, karakter aralığı) ile **izlenebilirdir**.
- Şirket şablonları yapılandırılabilir olmalıdır (ARCHITECTURE.md backend ilkesi); şablon eşleme sözlükleri sürümlenir.

## 5. Kasko operasyon alanları

Kasko dosyası operasyon görünümünde en az şunlar takip edilir:

- Muafiyet var/yok (genel alan + kloz taraması birlikte)
- Muafiyet türü, oranı/tutarı ve koşulu
- Hasarın teminat kapsam durumu (beş durum: kapsamda / şartlı / kapsam dışı / bilgi yetersiz / kaynaklar çelişkili)
- İkame araç durumu (hak, süre, kullanım)
- Poliçe ürünü/türü
- Servis şartı ve parça türü şartı
- Özel kloz kaynaklı geçici operasyon durdurmaları, insan onayı ve portal notu durumu (ör. muafiyet tespitinde tedarik/mobil onarım durdurma)

## 6. AI cevap standardı (kasko poliçesi)

Dosyaya özel AI'ın kasko poliçesi cevapları şu dokuz bölümü içermelidir:

1. **Sonuç ve kapsam durumu** — beş durumlu kapsam kararı önerisi
2. **Gerekçe** — hangi hükme dayandığı
3. **Muafiyet, tenzil, maliyet paylaşımı veya limit** — tutar/oran, matrah ve uygulanma koşulu
4. **Servis ve parça şartı** — varsa
5. **Yapılması gereken işlem ve gerekli belgeler** — operasyon adımı önerisi
6. **Kaynak belge, sayfa, başlık ve kloz** — izlenebilir referans
7. **Çelişki veya eksik bilgi** — varsa açıkça
8. **Güven seviyesi**
9. **İnsan onayı gereksinimi**

Kaynak sırası: 1) dosya belgeleri, 2) dosya notları ve e-postaları, 3) firma bilgi bankası, 4) resmî mevzuat, 5) internet araştırması (yalnız açıkça etiketli; poliçe/mevzuat hükmü gibi sunulmaz; mevzuatta blog/forum geçersizdir).

AI **tahmin yürütmez**. İlgili hüküm bulunamıyorsa cevap açıkça **"Poliçede bu konuda açık ve doğrulanabilir bir hüküm bulunamadı."** demelidir; genel sektör bilgisi poliçe hükmü gibi sunulamaz. Harici web klozuna atıf varsa URL, erişim tarihi, içerik hash'i ve kullanılan sürüm arşivlenir; güncel web sayfası geçmiş poliçeye kendiliğinden uygulanmaz.

## 7. Muafiyetli dosya iş akışı

Muafiyet tespit edilen kasko dosyasında zorunlu ilk adımlar:

1. **Tedarik geçici olarak durdurulur.**
2. **Mobil onarım geçici olarak durdurulur.**
3. Dosya sorumlusuna bilgi verilir (bildirim + görev).
4. Servise bilgi verilir (görüşme görevi + sonuç notu).
5. Kaynak poliçe maddesi, olası oran/tutar ve alternatif aksiyonlar gösterilir.

Aksiyon seçenekleri (tümü insan onaylı):

- Poliçeye uygun servis/yöntem seçilirse muafiyet **yeniden değerlendirilir**; engel kalkarsa normal süreç devam eder.
- Araç sahibi mevcut serviste kalırsa poliçedeki **gerçek muafiyet, tenzil veya maliyet paylaşımı uygulanır**; yüzde/paylaşım oranı sabit kodlanmaz, kaynak kloz ve hesaplama matrahından çıkarılır.
- Uygun çözüm kabul edilmezse portal notu, dosya sorumlusunun açık onayı ve gerekçeyle **bekletme veya kapatma** uygulanır.

Bu akış bildirim, görev, portal notu, onay ve kapanış adımlarıyla modellenir; geçici durdurmalar (`policy_action_holds`) kloz referansıyla dosyada görünürdür ve kaldırılmaları dahil her adım audit üretir. Muafiyetli kapanışta ilgili kloz, portal notu, sorumlu onayı ve uygulanan maliyet paylaşımı ayrıca kaydedilir. Mini onarım (poliçe teminatı) ile mobil onarım (operasyon yöntemi) ayrı kavramlardır ve aynı alanda modellenmez.

## 8. Parça bedeli kuralı

Hasara uğrayan parça bedeli hesaplanırken esas alınan değer:

- **KDV hariç** bedel
- **İskonto uygulanmamış** (liste) bedel

Hesaplama izlenebilirliği zorunludur: kaynak (hangi fiyat listesi/portal/belge), fiyatın alındığı **tarih** ve kullanılan **fiyat belgesi** referansı kayıt altına alınır. Bu kural işçilik/parça modülü ve değer kaybı hesaplarında ortak temeldir.

## 9. Değer kaybı: mevzuat vs ofis kuralı

- Mevzuat/ürün kuralı: Trafik dosyasında zorunlu; Kasko dosyasında **isteğe bağlı** (değişmedi).
- **Ofis operasyon kuralı (Baran Global):** hesaplamaya uygun TÜM Kasko dosyalarında değer kaybı süreci açılır. Pert, çalınma, tam hasar veya hesaplamaya uygun olmayan Kasko dosyasında durum **Uygulanamaz** olur ve gerekçe zorunludur.
- Bu iki kavram **ayrı alanlar** olarak modellenir: `valueLossLegalRequirement` (mevzuat) ve `valueLossOfficePolicy` (ofis kuralı). Ofis kuralı sürümlenebilir ve firma bazında yapılandırılabilir; mevzuat alanının anlamını değiştirmez.

## 10. Kapsam dışı ve açık kararlar

Kapsam dışı (bu paket): PDF çıkarım teknolojisi seçimi, AI sağlayıcı entegrasyonu, gerçek şema/migration, UI ekranı, API endpoint'i.

Açık kararlar (karar kapısı):

- Kloz bölümleme yöntemi (kural tabanlı mı, AI destekli mi, karma mı) ve doğruluk eşiği.
- Kanonik alan sözlüğünün ilk şirket kapsamı (hangi sigorta şirketleri önce).
- Güven seviyesi ölçeği (ör. yüksek/orta/düşük vs 0-1) ve insan onayı eşiği.
- Poliçe analiz maliyetinin AI bütçesindeki payı ve cache stratejisi.
- `policy_*` kavramlarının Paket 05+ şema tasarımındaki normalizasyon derinliği.
