// HB-2026-175: deterministik "her zaman hazır" freshness-gate test çifti.
//
// `deploy/windows-service/pcloud-session0-freshness-gate.mjs`nin GERÇEK
// davranışı zaten kendi ayrı testlerinde (services/file-agent) gerçek bir
// spawn ile kanıtlanmıştır. `services/api`nin GERÇEK PostgreSQL E2E
// testleri (case-lifecycle, file-operations, workspace-provisioning, vb.)
// SENTETİK/geçici dosya sistemi kökleri kullanır -- gerçek bir pCloud DB'ye
// karşılık gelmezler, dolayısıyla gerçek aracı burada kullanmak anlamsızdır.
//
// Bu araç, `checkCaseFreshness`in (services/file-agent/src/freshness-gate-
// client.ts) beklediği TAM CLI sözleşmesini (JSON stdout + `CaseStatus`
// alanı + exit 0) karşılayan, deterministik olarak HER ZAMAN "ready" diyen
// GERÇEK bir alt-süreçtir (mock DEĞİL) -- HB-2026-171'in dispatch kapısı bu
// testlerde de GERÇEKTEN spawn edilip GERÇEKTEN JSON ayrıştırılarak
// çalıştırılır, yalnızca DÖNÜŞ DEĞERİ sabittir.
console.log(JSON.stringify({
  SchemaVersion: 'hasarbotu-pcloud-session0-freshness-gate/1.0.0',
  CaseStatus: 'ready',
  Entries: [],
  ConflictNamesFound: [],
  Summary: { TotalFiles: 0, ReadyCount: 0, SyncingCount: 0, UnknownCount: 0, ConflictCount: 0 },
}))
process.exit(0)
