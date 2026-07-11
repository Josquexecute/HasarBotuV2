# CLAUDE.md

@AGENTS.md

## Claude Code-specific rules

- Her paket öncesinde `docs/PROJECT_STATUS.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/DECISION_LOG.md` ve göreve ilgili teknik planları oku.
- `v0.1.0-ui-baseline` tag'ini ve tamamlanmış foundation dallarını değiştirme.
- Kullanıcı açıkça istemedikçe remote ekleme, push, merge veya tag oluşturma.
- Beklenmeyen çalışma ağacı değişikliklerini silme, geri alma, stash yapma veya commit'e katma.
- Typecheck, lint, test, build, audit ve smoke kontrollerini gerçekten çalıştırmadan başarılı olarak raporlama.
- Görev kapsamı dışında kabul edilmiş UI baseline davranışını değiştirme.
- Windows PowerShell uyumluluğunu koru.
- `dist`, `node_modules`, build ve cache çıktıları kaynak kod değildir; workspace paketlerini Git'teki `src`, `test` ve yapılandırma dosyalarına göre değerlendir.
- Repo veya dal durumunu varsayma; her paket başlangıcında repo kökü, aktif dal, HEAD ve çalışma ağacını doğrula.
