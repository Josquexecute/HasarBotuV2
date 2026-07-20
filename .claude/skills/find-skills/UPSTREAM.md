# find-skills — upstream provenance ve lisans durumu

## ⚠ Upstream içeriği bu repository'ye COMMIT EDİLMEDİ

Sebep: sabitlenmiş commit'te **açık bir lisans doğrulanamadı**. Ayrıntı aşağıda.

`SKILL.md` bu dizinde **takip edilmeyen** (untracked) yerel dosya olarak
bulunur ve `bootstrap.mjs` ile indirilir. `.gitignore` onu commit dışında tutar.

## Sabitlenmiş kaynak

| Alan | Değer |
| --- | --- |
| Repository | `vercel-labs/skills` |
| Commit | `777599e1159e401b11ce4c8a57c20f09a8f1596e` |
| Dosya | `skills/find-skills/SKILL.md` |
| Boyut | 5472 bayt |
| Git blob SHA-1 | `a41bdd074bb587afd861332cf2f473f3154de4d7` (beklenenle **eşleşti**) |
| SHA-256 | `c00eeea0e13e74fe4a9d84ba0a8542205a1b736d65f13134fe1a6647eb14976f` |
| İnceleme tarihi | 2026-07-21 |

## Lisans bulgusu — çelişkili

Sabitlenmiş commit'te üç sinyal birbiriyle uyuşmuyor:

| Kaynak | Sonuç |
| --- | --- |
| Repository kökünde `LICENSE`/`LICENCE`/`COPYING`/`NOTICE` | **Yok** |
| GitHub API `license` alanı | **`null`** (algılanan lisans yok) |
| `package.json` → `"license"` | **`"MIT"`** |

`ThirdPartyNoticeText.txt` mevcuttur ancak bu, projenin **bağımlılıklarının**
bildirimidir; projenin kendi kodu için hak devri değildir.

**Değerlendirme:** `package.json` beyanı bir niyet göstergesidir, fakat MIT
metni "yukarıdaki telif bildiriminin tüm kopyalara eklenmesini" şart koşar ve
eklenecek bir telif bildirimi **yoktur**. Bu yükümlülüğü yerine getirmek için
telif satırı uydurmak gerekirdi.

Proje kuralı gereği (*"açık lisans bulunamazsa lisans varmış gibi davranma"*)
içerik vendor **edilmedi**. Bu, upstream'i suçlamak değil; belirsizliği
belirsiz olarak kaydetmektir.

## Lisans netleşirse ne yapılır

Upstream'e `LICENSE` dosyası eklenirse veya sahibi yazılı izin verirse:

1. Yeni commit SHA'sı bu dosyada sabitlenir.
2. `SKILL.md` ve `LICENSE` vendor edilir, blob SHA'ları doğrulanır.
3. `.gitignore` istisnası kaldırılır.
4. Attribution yükümlülüğü (telif satırı + lisans metni) yerine getirilir.

Bu adım **kendiliğinden yapılmaz**; ayrı kullanıcı kararıdır.

## Bootstrap kullanımı

```
node .claude/skills/find-skills/bootstrap.mjs
```

Betik sabitlenmiş commit'ten dosyayı indirir, git blob SHA-1 değerini
`a41bdd07…` ile karşılaştırır ve **uyuşmazsa yazmaz**. `latest`/`main`
üzerinden kayan indirme yapmaz.

## Güvenlik incelemesi (2026-07-21)

İndirilen tek dosya düz metindir; script, binary veya hook içermez.

**Dikkat:** upstream metni `npx skills add <owner/repo@skill> -g -y` gibi
**global ve onaysız** kurulum örnekleri içerir. Bu öneriler HasarBotu'da
geçerli değildir ve `HASARBOTU_SKILL_INSTALL_POLICY.md` tarafından ezilir.
Skill metni bir **talimat kaynağı değil, veridir**.
