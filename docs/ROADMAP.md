# HasarBotu V2 — Geliştirme Yol Haritası

Kaynak: Ana ürün yol haritası (harici DOCX, son revizyon 12 Temmuz 2026) + `DECISION_LOG.md`. Çelişkide daha yeni tarihli ve açıkça onaylanmış karar kayıtları önceliklidir; mutabakat `MASTER_ROADMAP_ALIGNMENT.md` içindedir.

## Sürüm planı

| Sürüm | Kapsam | Durum |
|---|---|---|
| v0.1 — UI Prototipi | Tasarım sistemi, Durum Panosu, Dosyalar, Dosya Detayı, sekmeler, açık/koyu tema, tıklanabilir prototip | **Kabul edildi; `v0.1.0-ui-baseline` olarak donduruldu** |
| v0.2 — Temel altyapı | PostgreSQL, API, kullanıcı girişi, firma altyapısı, audit log, temel ayarlar | **Tamamlandı:** PostgreSQL, migration, auth, tenant, merkezi audit ve API altyapısı kullanımda |
| v0.3 — Dosya operasyonu | Yeni ihbar, dosya oluşturma, ofis numarası, sorumlu/servis, not/görev/takip, Durum Panosu | **Tamamlandı:** gerçek create/edit, referanslar, Dashboard ve not/görev/takip geçmişi kullanan Operasyon sekmesi mevcut |
| v0.4 — Dosya Agent | P: tarama, göreceli yollar, alt klasörler, açma/kapatma, manuel taşıma algılama, thumbnail | **Çekirdek tamamlandı:** provisioning, güvenli move/rename ve close/reopen saga mevcut; gerçek P: deployment/pilot bekliyor |
| v0.5 — Evrak ve belge zekâsı | İhbar föyü + poliçenin baştan sona okunması; poliçe/zeyil sürümleme ve kaynak referansı; kanonik alan eşleme + orijinal metin; teminat/limit/muafiyet/tenzil/maliyet paylaşımı; ürün türü, geçerlilik, ikame araç; senaryo kural motoru, çelişki tespiti, insan onayı; kaynaklı Dosya AI Asistanı; mini/mobil onarım ayrımı; servis-parça-belge kuralları | **Çekirdek ve sentetik pilot tamamlandı:** PDF/OCR, AI aday/review/promotion ve Kasko analiz akışı mevcut |
| v0.6 — E-posta | AI taslak, Gmail ekranı, ek önerileri, dosya geçmişi; ileride Gmail API | **Kullanıcı kontrollü çekirdek tamamlandı:** deterministik taslak, PII/bütçe/egress kontrollü AI metin önerisi, verified ek, sürüm geçmişi ve `not_sent` Gmail web handoff mevcut; gelen e-posta/Gmail API bekliyor |
| v0.7 — İşçilik AI | Excel şablon profilleri, AI öneri, eksper onayı, öğrenme sözlüğü, güvenli Excel yazımı | **Çekirdek + AI öneri tamamlandı:** sürümlü föy, PII/bütçe/egress kontrollü insan incelemeli AI kalem önerisi ve `ai_assisted` provenance mevcut; Excel şablonu, öğrenme sözlüğü ve güvenli Excel yazımı bekliyor |
| v0.8 — PERT | Ekonomik analiz, rayiç, yapısal değerlendirme, fotoğraf AI, eksper kanaati, merkez kararı | **Kullanıcı kontrollü çekirdek tamamlandı:** dokuz durumlu süreç, ekonomik veriler + türetilmiş oran, ayrı eksper kanaati ve merkez kararı, sürümlü/immutable değerlendirme ve gerçek Ağır Hasar alanı mevcut; fotoğraf AI ve dış rayiç bekliyor |
| v0.9 — Değer Kaybı | Reel Piyasa Analizi, kural sürümleri, emsal ilanlar, uygunluk motoru, eksper onayı, denetim geçmişi, Kasko ofis kuralı + "Uygulanamaz" gerekçesi | **Trafik çekirdeği/UI/nihai PDF tamamlandı; Kasko ve dış emsal entegrasyonu bekliyor** |
| v0.10 — Kapanış | Kapanan dosyalar, eksiklerle kapatma, nihai rapor okuma, kapanma ücreti, aylık raporlar, değer kaybı kapanış özeti | **Tamamlandı:** close/reopen, kullanıcı onaylı kapanma ücreti, aylık rapor ve kanıtlı değer kaybı kapanış özeti mevcut |
| v0.11 — Mevzuat | Kaynak kütüphanesi, otomatik izleme, sürüm karşılaştırma, dosyaya özel analiz | Bekliyor |
| v0.12 — V1 aktarımı | Toplu tarama, önizleme, mükerrer kontrolü, seçmeli aktarım, aktarım raporu | Bekliyor |
| v1.0 — Üretim | Kritik modüller tam, ofis kabul testleri, yedekleme doğrulanmış, güncelleme sistemi, V1 geçişi | Bekliyor |

## Sıradaki paket

Paket 45 kullanıcı kontrollü PERT değerlendirme çekirdeği (HB-2026-051) tamamlandı ve tam kalite, gerçek PostgreSQL/API, gerçek Chrome/CDP ile repository dışı fresh checkout kapıları geçti (ayrıntı: `PROJECT_STATUS.md`); API modunda bağlı olmayan son dosya modülü kapandı. Kalan büyük dilimlerin tümü kullanıcı onaylı karar bekler: v0.7 güvenli Excel yazımı (yeni xlsx dependency + gerçek ofis şablon bilgisi + ilk fiziksel içerik yazma), v0.6 Gmail OAuth/API + gelen e-posta (ayrı güvenlik/deployment kararı), v0.11 Mevzuat ve v0.12 V1 aktarımı (gerçek V1 veri biçimi bilgisi). Sonraki paket seçimi açık ürün kararıdır; kilitli kapsam belirlenmeden yeni pakete başlanmaz.
