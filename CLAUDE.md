# CLAUDE.md

@AGENTS.md

## Claude Code-specific rules

- Varsayılan çalışma modu xhigh olmalıdır. Ultracode yalnız proje çapında mimari denetim, güvenlik incelemesi, kritik ve çözülemeyen hatalar veya açıkça istendiğinde kullanılmalıdır. Rutin paket geliştirmesinde dynamic workflow veya çoklu ajan başlatma.
- Her paket öncesinde `docs/PROJECT_STATUS.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/DECISION_LOG.md` ve göreve ilgili teknik planları oku.
- `v0.1.0-ui-baseline` tag'ini ve tamamlanmış foundation dallarını değiştirme.
- Kullanıcı açıkça istemedikçe remote ekleme, push, merge veya tag oluşturma.
- Beklenmeyen çalışma ağacı değişikliklerini silme, geri alma, stash yapma veya commit'e katma.
- Typecheck, lint, test, build, audit ve smoke kontrollerini gerçekten çalıştırmadan başarılı olarak raporlama.
- Görev kapsamı dışında kabul edilmiş UI baseline davranışını değiştirme.
- Windows PowerShell uyumluluğunu koru.
- `dist`, `node_modules`, build ve cache çıktıları kaynak kod değildir; workspace paketlerini Git'teki `src`, `test` ve yapılandırma dosyalarına göre değerlendir.
- Repo veya dal durumunu varsayma; her paket başlangıcında repo kökü, aktif dal, HEAD ve çalışma ağacını doğrula.

HasarBotu V2 için bundan sonra otonom çalışma moduna geç.

Her küçük adımda benden onay isteme. Önce CLAUDE.md, AGENTS.md, güncel ana yol haritası, DECISION_LOG, PROJECT_STATUS ve aktif Git durumunu oku ve gerekirse revize et; mevcut kilitli kararlara göre planla, uygula, doğrula ve commit et.

Kurallar:

- Gereksiz uzun analiz, tekrar, dosya içeriği dökümü ve token tüketimi yapma.
- Aynı bilgiyi tekrar tekrar özetleme.
- Küçük teknik kararları mevcut mimari ve proje kurallarına göre kendin ver.
- Her görevde güvenlik kapısını çalıştır.
- Korunan branch/tag/commit’leri değiştirme.
- Mevcut commit’i amend etme; aksi açıkça istenmedikçe yeni atomik commit oluştur.
- Başarısız test varken PASS deme.
- Kod, test, build, audit ve temiz checkout doğrulamalarını gerçekten çalıştır.
- Gerçek müşteri verisini repository’ye ekleme.
- Kapsam dışına çıkma.
- Yalnız şu durumlarda dur ve tek net soru sor:
  1. Geri döndürülemez işlem
  2. Veri kaybı riski
  3. Korunan ref veya başlangıç durumu uyuşmazlığı
  4. Yüksek güvenlik riski
  5. Belgelerde cevabı bulunmayan gerçek ürün kararı
- Bu durumlar yoksa görevi kendi başına tamamla.

Final raporunu kısa tut:

- Yapılanlar
- Commit
- Test/build/audit sonucu
- Kritik açık risk
- Sonraki mantıklı görev

Uzun ara rapor verme. İş tamamlanana kadar gereksiz yere durma.
