# Genel test ve Windows installer doğrulaması — 28.09.2026

**Durum: PASS.** Node 24.21.0, Windows x64, gerçek yerel PostgreSQL 18.4.
Önceki çalışma ağacı değişiklikleri korunmuştur. Eski portlardaki taslakların
taşınması bu çalışmanın kapsamına alınmamıştır.

## Düzeltmeler

- Migration testleri `0049_eksist_sources` tablosunu, ileri sıralamayı ve
  geri alma sayımlarını kapsar. 0049 için gerçek DROP/yeniden oluşturma
  regresyonu eklendi. Önceki 54 zincirleme hata giderildi.
- Beş JSON Schema fixture, mevcut route/DTO davranışıyla karşılaştırılarak
  `schema:fixtures` komutuyla üretildi: opsiyonel `eksist`, `serviceRevision`
  ve `includeEksist` alanları. Sözleşmeler gevşetilmedi.
- Bildirim UAT testi, sunucunun otomatik atadığı takip tarihini kullanır.
  Vade gününde uyarı olmadığını ve ertesi gün gerçek kayıt için uyarı
  üretildiğini doğrular. Değer kaybı testi 0043 rollback korumasına kadar
  gerçekten geri iner; onaylı revision ve nihai rapor kontrolleri korunur.
- D8/D9 scriptleri, PATH üzerinde birden fazla Node uygulaması bulunduğunda
  ilk uygulamayı seçer. Önceki davranış iki yolu tek executable olarak
  çağırıyor ve `PCLOUD_STATE_PROBE_FAILED` üretiyordu. İki Node kurulumu
  bulunan PATH ile gerçek sentetik dosya işlemleri doğrulandı.
- Attestation rollback yalnız değiştirdiği DACL'i geri yükler; sahiplik
  sapmasını reddeder ve başlangıçtaki auto-inheritance bayrağını korur.
  Depodaki pCloud ACL rollback yaklaşımı esas alındı. Yeni iki regresyon
  senaryosu eski kodda üç assertion hatası verdi, düzeltmeden sonra geçti.

## Test ve derleme sonuçları

| Paket | Geçen | Başarısız |
|---|---:|---:|
| UI (genel koşu) | 358 | 0 |
| UI canlı API (ayrı koşu) | 6 | 0 |
| Domain | 568 | 0 |
| Contracts | 282 | 0 |
| Database | 80 | 0 |
| Desktop bridge | 14 | 0 |
| API | 406 | 0 |
| File Agent | 105 | 0 |
| Desktop | 114 | 0 |
| **Toplam** | **1933** | **0** |

`npm test` içindeki ortam koşullu altı canlı UI testi, ayrı test veritabanı,
çalışan HTTP API ve gerçek oturumlarla ayrıca çalıştırıldı (6/6).
Veritabanı kullanan paketlerde atlanan test yoktur.

- `npm run build`: PASS; frontend bundle bütçesi dahil.
- `npm run typecheck`: PASS.
- `npm run lint`: 0 hata, mevcut 12 uyarı.
- `npm run check:deploy`: PASS; D8 repair, D9 cleanup ve sekiz attestation
  ACL senaryosu dahil tüm servis/depolama doğrulamaları.
- `git diff --check`: PASS.

Loglar: `.local/release-full-test.log`, `release-live.log`, `release-build.log`,
`release-typecheck.log`, `release-lint.log`, `release-deploy.log`.

## Windows installer

Komut:

```powershell
npm run package:win --workspace @hasarbotu/desktop -- --config.directories.output=release/validation-20260928
```

Çıktı: `apps/desktop/release/validation-20260928/HasarBotu-Setup-0.1.3.exe`
(102597021 byte, NSIS, x64). Önceki installer çıktısı korunmuştur.

SHA-256:

```text
1b97cabe68fef8f1d14f03931adaf303607cbfc75e8777566f6d4fac8f99a792
```

Authenticode: **NotSigned**. Kod imzalama yapılmamıştır.

Paketlenmiş executable ve installer ile ayrı dizine kurulan executable için:

1. Üretim UI dosyaları yerel HTTP köprüsünden açıldı.
2. Renderer'da Node `require`/`process` erişiminin bulunmadığı doğrulandı.
3. Üretim giriş formuyla gerçek API oturumu açıldı.
4. Sentetik PostgreSQL kaydı dosya listesinde görüldü; ekran görüntüsü alındı.
5. İki ayrı uygulama sürecinde köprü origin'i ve localStorage verisi korundu.
6. Kullanıcı profilindeki kayıtlı köprü portu gerçek portla karşılaştırıldı.

Kurulum çıkış kodu 0; uygulama sürümü, registry kaydı ve masaüstü/başlat
menüsü kısayolları doğrulandı. Kurulan `resources/app.asar` hash'i paketlenmiş
çıktıyla aynı. Sessiz kaldırmadan sonra executable, registry ve kısayolların
kaldırıldığı doğrulandı. Önceden kurulu V1 ve Eksist Pilot kayıtları korundu.
Bu bir izole kurulum testidir; üretim servisine veya kullanıcı verisine dağıtım
yapılmadı. Test kurulumu kaldırıldı; installer teslim için tutuldu.

Kanıtlar: `.local/release-unpacked-evidence/result.json`,
`.local/release-installed-evidence/result.json`, aynı dizinlerdeki
`case-list.png`, `.local/release-install-result.json` ve
`.local/release-uninstall-result.json`. Sentetik canlı test araçları
`.local/release-fixture.mjs`, `.local/release-live.mjs` ve
`.local/release-installed-smoke.mjs` altında tutuldu.
