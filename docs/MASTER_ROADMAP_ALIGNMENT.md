# HasarBotu V2 — Ana Yol Haritası Hizalama Denetimi

Tarih: 2026-07-12
Kaynak: "HasarBotu V2 — Baştan Sona Ana Yol Haritası" (harici DOCX, son revizyon 12 Temmuz 2026, 33 bölüm). Belge repository'ye eklenmez; bu denetim onun repo kararlarıyla mutabakatıdır.
Öncelik kuralı (belgenin kendi hükmü): uygulama sırasında `DECISION_LOG.md` içindeki daha yeni tarihli ve açıkça onaylanmış kararlar önceliklidir.

## 1. Hizalı alanlar (fark yok)

Dosya türleri (yalnız Trafik/Kasko); caseId ana kimlik + plaka klasör örnekleri; storageRootKey+relativePath (mutlak `P:\` yazılmaz); tek ana Dosya Agent ve yetkileri; UI-first kuralı, tema/menü/navigasyon/sekmeler; evrak koşullu kural motoru ve Trafik/Kasko zorunlu evrak kuralları; onarım onayı eşiği (100.000 TL sürümlü); PERT ayrımı (AI önerisi/eksper kanaati/merkez kararı); kapanma ücreti akışı ve durumları; Excel güvenli yazım modeli; mevzuat kaynak hiyerarşisi ve onaysız etkinleşmeme; V1 aktarımı salt-okunur akışı; kritik işlem modeli; not/görev/takip/tatil kuralları; AI'nin onaysız yazamayacağı işlemler; hedef workspace yapısı; "muafiyetsiz alanı tek başına karar değildir"; gerçek poliçe/müşteri verisi fixture yasağı.

## 2. Yol haritasının getirdiği ve repo'ya işlenen güncellemeler

| # | Konu | Önceki repo durumu | Yeni karar (işlendi) |
|---|---|---|---|
| G1 | Kapsam sonucu | 4 durum (`belirsiz` tek) | **5 durum:** kapsamda / şartlı / kapsam dışı / **bilgi yetersiz** / **kaynaklar çelişkili** (CASCO_* belgeleri) |
| G2 | Mini vs mobil onarım | Tek alan (`miniMobileRepair`) | **Ayrıldı:** mini onarım = poliçe teminatı/hizmeti; mobil onarım = operasyon yöntemi; ayrı alan/kural/durum |
| G3 | Muafiyet akışı | "Tedarik yapılmaz / servis değişmezse operasyon yok" (kalıcı ton) | **Geçici durdurma + aksiyon seçenekleri:** uygun servise geçilirse yeniden değerlendirme ve engel kalkışı; serviste kalınırsa poliçedeki gerçek muafiyet/tenzil/**maliyet paylaşımı** uygulanarak devam; oran sabit kodlanmaz; çözüm yoksa portal notu + onay + bekletme/kapatma |
| G4 | Maliyet paylaşımı | Modellenmemişti | AI cevabına, senaryo kurallarına, kapanış kaydına ve `policy_cost_shares` kavramına eklendi |
| G5 | AI cevap standardı | 8 bölüm; "poliçede açık hüküm bulunamadı" | **9 bölüm** (+İnsan onayı gereksinimi; muafiyet satırına tenzil/maliyet paylaşımı; işlem satırına gerekli belgeler); tam ifade: **"Poliçede bu konuda açık ve doğrulanabilir bir hüküm bulunamadı."** |
| G6 | AI kaynak sırası | Tanımsız | 1. Dosya belgeleri → 2. Not/e-postalar → 3. Firma bilgi bankası → 4. Resmî mevzuat → 5. İnternet (mevzuatta blog/forum geçersiz kuralı saklı) |
| G7 | Poliçe veri kavramları | 14 kavram | **26 kavram**: + `policy_pages`, `policy_sections`, `policy_cost_shares`, `policy_service_rules`, `policy_part_rules`, `policy_required_documents`, `policy_external_references`, `policy_action_holds`, `policy_portal_notes`, `policy_decision_history`, `part_price_references`, `ai_usage_ledger`, `backup_runs`, `restore_test_runs` |
| G8 | Harici web klozu | Kapsanmamıştı | URL + erişim tarihi + içerik hash + kullanılan sürüm arşivi; güncel web sayfası geçmiş poliçeye kendiliğinden uygulanmaz |
| G9 | Çıkarım metadata | Yöntem/tarih/güven | + **model sürümü ve çıkarım zamanı**; ham metin aralığı |
| G10 | Parça bedeli | KDV hariç + iskontosuz + kaynak/tarih/belge | + liste/KDV/KDV-dahil, iskonto ve **gerçek satın alma bedeli**, sigorta payı / araç sahibi payı, para birimi, hesap kuralı, kullanıcı onayı; kullanım alanları (değer kaybı, hasar maliyeti, PERT, parça listesi, onarım onayı); referans bedel ödeme tutarıyla karıştırılmaz |
| G11 | Değer kaybı uygunluk | Süreç durumları vardı | Ayrı **uygunluk ekseni**: Hesaplamaya Uygun / Veri Eksik / Eksper İncelemesi Gerekli / Değer Kaybı Oluşmaz / Referans Modülle Hesaplanamaz / Ağır Hasar Nedeniyle Hesaplanamaz / **Uygulanamaz (gerekçe zorunlu)**; pert/çalınma/tam hasar Kasko'da Uygulanamaz; ofis kuralı "hesaplamaya uygun TÜM Kasko dosyaları" |
| G12 | Reel piyasa ölçütleri | Genel referans | Son 30 gün ilan, ≥3 emsal, marka/model/paket eşleşmesi, ±%10 km, aykırı dışlama, ilan görüntüsü+numarası, eksper rayiç onayı |
| G13 | Kasko poliçe evrakı | "Kasko Poliçe" | **Tüm sayfalar + zeyiller zorunlu; yalnız özet yetersiz**; hasar tarihinde geçerlilik + sürüm/zeyil/çelişki kontrolü |
| G14 | Ofis numarası | YYYY/N sıralı | + aktifleştirmede otomatik; aynı numara iki kez kullanılmaz; iptal edilen tekrar dağıtılmaz; yeniden açılan eski numarasını korur |
| G15 | AI maliyet politikası | ~20 USD hedef | **Ücretli bulut AI varsayılan KAPALI; yönetici etkinleştirir**; yapılandırılabilir üst sınır; ucuz model önce → zor vakada güçlü model; modül/kullanıcı/model/dosya bazlı maliyet raporu; buluta giden içerik görünür+onaylı+auditli; içerik hash cache |
| G16 | Yedekleme | "Fiziksel pCloud klasörleri yedek sisteminin parçası değildir" (ARCHITECTURE) | **Fiziksel dosyalar bağımsız yedek kapsamına alındı**: BitLocker'lı harici disk ikinci kopya; günlük/haftalık/aylık; saklama 14 gün / 8 hafta / 12 ay; gerçek restore testi + hash doğrulama + audit (`backup_runs`, `restore_test_runs`) |
| G17 | İlk sigorta şirketi | Tanımsız | **Türkiye Sigorta** önceliği; baştan çoklu şirket şablonu |
| G18 | Kapanış koşullu evrak | Fatura/İbra/Taahhütname koşullu | İbra+Taahhütname **anlaşmalı ve yetkili servislerde zorunlu**; muafiyetli kapanışta kloz+portal notu+onay+maliyet paylaşımı kaydı |
| G19 | E-posta türleri | Genel liste | + muafiyet/tenzil/servis-parça bilgilendirmesi, portal muafiyet notu taslağı, servis değişikliği |
| G20 | Test senaryoları | 5 kasko senaryosu | **12 zorunlu anonim kasko senaryosu** + yedek/geri yükleme ve AI bütçe testleri |
| G21 | Kullanıcı girişi | Username örneği | E-posta+şifre birincil; **Google ile giriş** planlı (auth teknolojisi hâlâ açık karar) |

## 3. Çelişkiler ve karar gerektiren noktalar (körü körüne uygulanmadı)

| # | Konu | Çelişki | Değerlendirme | Durum |
|---|---|---|---|---|
| K1 | Dosya durumu | DOCX: Açık/Beklemede/Kapanmaya Hazır/Kapalı. HB-2026-003: yaşam döngüsü yalnız `open/closed`; Beklemede vb. sunum/operasyon durumudur. DOCX aynı belgede "Kapanmaya Hazır"ı hem durum hem aşama sayıyor (iç tutarsızlık) | Domain enum'u kod değişikliğidir ve mevcut karar sunum/yaşam döngüsü ayrımını bilinçli kurdu. Sessizce genişletme riskli | **Karar gerekli (Paket 05 öncesi):** `cases.status` 2'li mi 4'lü mü? Öneri: `open/closed` çekirdek + `Beklemede/Kapanmaya Hazır` türetilmiş operasyon görünümü |
| K2 | Aşama listesi | DOCX 11 öğe ("İhbar Alındı", "Kapanış Evrakları Bekleniyor", "Kapalı" aşama olarak). Domain 10 kod; "Kapalı" aşama değil | "Kapalı"nın aşama sayılması yaşam döngüsüyle çakışır; ad farkları etiket düzeyinde | **Karar gerekli:** aşama seti güncellenecekse domain `CASE_STAGES` sürümlü değişiklik ister; etiket eşlemesi UI katmanında |
| K3 | 7/24 bağlı yedek diski | DOCX: sürekli bağlı BitLocker'lı disk "bağımsız ikinci kopya" | Sürekli bağlı disk, fidye yazılımı/yanlış silmede eşzamanlı bozulabilir; AUDIT planındaki "mümkünse çevrimdışı/immutable" ilkesi hâlâ doğru | **Kabul + risk kaydı:** karar işlendi; periyodik çevrimdışı rotasyon/immutable hedef önerisi risk olarak açık bırakıldı |
| K4 | İnternet araştırması kaynak sırasında | DOCX AI kaynak sırasına 5. adım olarak internet ekliyor | Mevzuatta blog/forum geçersiz kuralı ile çelişmemeli | **Kabul + sınır:** internet yalnız en son sırada, açıkça etiketli ve poliçe/mevzuat hükmü gibi sunulmadan |
| K5 | Google ile giriş | "Ücretli servis olmadan çalışamayan temel mimari kurulmayacak" yasağı | Google OAuth kesinti/erişim bağımlılığı yaratır | **Kabul + sınır:** e-posta+şifre birincil ve tek başına yeterli; Google girişi opsiyonel ektir |
| K6 | Poliçe ham metni DB'de | `policy_pages/sections` tam metin saklama PII/hacim getirir | DOCX §33 de sürüm+hassas veri sınıfı+saklama politikası şartını koyuyor | **Kabul + şart:** Paket 05+ şemasında hassas veri sınıfı ve saklama politikası zorunlu tasarım girdisi |
| K7 | "Değer Kaybı Oluşmaz" | Hem süreç durumları (repo) hem uygunluk durumları (DOCX) listesinde aynı ad | İki ayrı eksende aynı ad karışıklık üretir | **Not:** uygunluk vs süreç eksenleri ayrı alanlar; ad çakışması şema tasarımında çözülmeli |

## 4. Eski kalmış / güncellenen repo belgeleri

- `ROADMAP.md` DOCX sürüm planına (v0.1→v1.0) hizalandı; tamamlanan aşamalar işaretlendi.
- `ARCHITECTURE.md` yedek kapsamı düzeltildi (G16) ve depolama kökünün ileride disk/sunucu/NAS'a taşınabilirliği not edildi.
- `CASCO_POLICY_*` üçlüsü G1-G9 ile güncellendi; `DOMAIN_RULES`, `PRODUCT_REQUIREMENTS`, `DATABASE_MODEL_PLAN`, `SECURITY_AND_AI_POLICY`, `TESTING_AND_ACCEPTANCE`, `API_CONTRACT_PLAN` ilgili maddelerle güncellendi.
- Karar kaydı: `DECISION_LOG.md` HB-2026-008.

## 5. Kod ↔ belge kanıt durumu (varsayım yok)

- Domain `CaseStatus = open/closed`, `CASE_STAGES` 10 kod, `followUpDate: LocalDate` — kaynaktan doğrulandı; K1/K2 dışında DOCX ile uyumlu.
- Contracts/API yalnız health + read-only Cases sözleşmesi içerir; poliçe kavramlarının hiçbiri henüz kodda yoktur (beklenen — v0.5 kapsamı).
- UI mock durum etiketi (`Açık/Beklemede/Gecikmiş/Kontrol Bekliyor`) DOCX 4'lü listesinden de farklıdır; UI baseline dokunulmadı (K1 kararına bağlı).
- 379/379 test bu görevde değişmeden geçti; bu görev yalnız dokümantasyondur.

## 6. Paket 05 kabul kapısına etkisi

DOCX §28 kabul kapısı aynen benimsendi: poliçe, muafiyet, maliyet paylaşımı, kaynak referansı, AI kullanımı ve yedekleme kavramları veri modelinde **daraltılmadan** karşılanabilmeli; SQL/migration küçük, geri alınabilir, test edilebilir adımlarla; kabul edilmiş UI davranışı değişmemeli. Ek olarak K1/K2 (durum/aşama seti) Paket 05 şema tasarımından **önce** karara bağlanmalıdır.
