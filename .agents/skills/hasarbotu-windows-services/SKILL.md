---
name: hasarbotu-windows-services
description: HasarBotu API, File Agent ve ilişkili Windows servislerinin WinSW paketleri, hesap/ACL/secret yapılandırması, install/start/stop/restart/deploy ve rollback görevlerinde kullan.
---

# HasarBotu Windows Servisleri

## Başlangıç

- Önce `$hasarbotu-production-safety` kurallarını uygula.
- `docs/PROJECT_STATUS.md`, ilgili en yeni D5–D9 kararları, `docs/DEPLOYMENT_AND_OPERATIONS_PLAN.md` ve `docs/RUNBOOK_FAZ_A_WINDOWS_SERVICE_DEPLOYMENT.md` dosyalarını oku.
- `deploy/windows-service/README.md`, WinSW XML'leri, ilgili PowerShell/Node araçları ve testlerini incele.

## Sınırlar

- Servis adı, hesap, startup mode, runtime root, deployed artifact ve mevcut state'i canlı salt-okunur sorguyla doğrula; tarihsel kaydı güncel durum diye kullanma.
- Service Control Manager, hesap/LSA, ACL, environment, artifact deploy ve servis state değişikliğini production mutation say.
- Parolayı argv, dosya çıktısı, transcript, log veya sohbetten geçirme. Secret değerini asla çıktılamama kuralını uygula; yalnız var/yok ve güvenli kimlik göster.
- File Agent için en-az-yetki hesabı ve ACL sınırını koru. API'nin mevcut LocalSystem artık riskini kendiliğinden refactor etme.
- Gerçek serviste sentetik test veya failure injection çalıştırma. Production servisini test fixture'ı olarak repurpose etme; bunun için mevcut, açıkça onaylı kontrollü araç sözleşmesini izle.

Install/deploy/ACL/start/stop/restart mutation'ında preflight → tam servis/artefakt/ACL planı ve rollback → preview → açık onay → taze state/hash → atomik apply → PID/state/health/auth/ACL doğrulaması → audit sırasını uygula. Bir adım başarısızsa sonraki adıma geçme; rollback sonucunu ayrıca doğrula.

## Doğrulama

- `npm run check:deploy` çalıştır.
- Değişen aracın `*.tests.ps1` veya `*.test.mjs` testini sentetik/geçici ortamda çalıştır.
- API/File Agent build ve workspace testlerini çalıştır.
- Production apply onaylandıysa servis `Status/StartType`, gerçek PID değişimi, `/health`, File Agent kimlik doğrulaması, deployed manifest/hash ve log redaksiyonunu bağımsız doğrula.
- İmza, admin yetkisi, Session 0 veya gerçek servis hesabı bağlamı doğrulanmadıysa UNRUN/BLOCKED yaz.
