# HasarBotu V2 — Geliştirme Yol Haritası

Kaynak: Ana ürün yol haritası (harici DOCX, son revizyon 12 Temmuz 2026) + `DECISION_LOG.md`. Çelişkide daha yeni tarihli ve açıkça onaylanmış karar kayıtları önceliklidir; mutabakat `MASTER_ROADMAP_ALIGNMENT.md` içindedir.

## Sürüm planı

| Sürüm | Kapsam | Durum |
|---|---|---|
| v0.1 — UI Prototipi | Tasarım sistemi, Durum Panosu, Dosyalar, Dosya Detayı, sekmeler, açık/koyu tema, tıklanabilir prototip | **Kabul edildi; `v0.1.0-ui-baseline` olarak donduruldu** |
| v0.2 — Temel altyapı | PostgreSQL, API, kullanıcı girişi, firma altyapısı, audit log, temel ayarlar | **Kısmen tamamlandı:** workspace + domain + contracts (sertleştirilmiş) + Node 24/Fastify API iskeleti ve `/health` hazır; **PostgreSQL/migration (Paket 05) sırada** |
| v0.3 — Dosya operasyonu | Yeni ihbar, dosya oluşturma, ofis numarası, sorumlu/servis, not/görev/takip, Durum Panosu | Bekliyor |
| v0.4 — Dosya Agent | P: tarama, göreceli yollar, alt klasörler, açma/kapatma, manuel taşıma algılama, thumbnail | Bekliyor |
| v0.5 — Evrak ve belge zekâsı | İhbar föyü + poliçenin baştan sona okunması; poliçe/zeyil sürümleme ve kaynak referansı; kanonik alan eşleme + orijinal metin; teminat/limit/muafiyet/tenzil/maliyet paylaşımı; ürün türü, geçerlilik, ikame araç; senaryo kural motoru, çelişki tespiti, insan onayı; kaynaklı Dosya AI Asistanı; mini/mobil onarım ayrımı; servis-parça-belge kuralları | Planlandı (`CASCO_POLICY_*` belgeleri) |
| v0.6 — E-posta | AI taslak, Gmail ekranı, ek önerileri, dosya geçmişi; ileride Gmail API | Bekliyor |
| v0.7 — İşçilik AI | Excel şablon profilleri, AI öneri, eksper onayı, öğrenme sözlüğü, güvenli Excel yazımı | Bekliyor |
| v0.8 — PERT | Ekonomik analiz, rayiç, yapısal değerlendirme, fotoğraf AI, eksper kanaati, merkez kararı | Bekliyor |
| v0.9 — Değer Kaybı | Reel Piyasa Analizi, kural sürümleri, emsal ilanlar, uygunluk motoru, eksper onayı, denetim geçmişi, Kasko ofis kuralı + "Uygulanamaz" gerekçesi | Bekliyor |
| v0.10 — Kapanış | Kapanan dosyalar, eksiklerle kapatma, nihai rapor okuma, kapanma ücreti, aylık raporlar, değer kaybı kapanış özeti | Bekliyor |
| v0.11 — Mevzuat | Kaynak kütüphanesi, otomatik izleme, sürüm karşılaştırma, dosyaya özel analiz | Bekliyor |
| v0.12 — V1 aktarımı | Toplu tarama, önizleme, mükerrer kontrolü, seçmeli aktarım, aktarım raporu | Bekliyor |
| v1.0 — Üretim | Kritik modüller tam, ofis kabul testleri, yedekleme doğrulanmış, güncelleme sistemi, V1 geçişi | Bekliyor |

## Sıradaki paket

**Paket 05 — PostgreSQL bağlantısı ve migration altyapısı.** Kabul kapısı: poliçe, muafiyet, maliyet paylaşımı, kaynak referansı, AI kullanımı ve yedekleme kavramları veri modelinde daraltılmadan karşılanabilmeli; SQL/migration küçük, geri alınabilir, test edilebilir adımlarla; kabul edilmiş UI davranışı değişmemeli. Ayrıca dosya durumu/aşama seti kararı (K1/K2, `MASTER_ROADMAP_ALIGNMENT.md` §3) Paket 05 şemasından önce çözülmelidir. Paket 05 tamamlanmadan gerçek dosya taşıma veya üretim verisi yazma sürecine geçilmez.
