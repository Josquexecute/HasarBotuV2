# VibeSec-Skill — upstream provenance

Bu dizindeki `SKILL.md` ve `LICENSE` upstream'den **değiştirilmeden** alınmıştır.
HasarBotu kuralları yalnız `HASARBOTU_SECURITY_OVERLAY.md` içindedir.

## Sabitlenmiş kaynak

| Alan | Değer |
| --- | --- |
| Repository | `BehiSecc/VibeSec-Skill` |
| Commit | `0590993b35ad51961f65a4d01cf1196dfead05bb` |
| Lisans | Apache-2.0 (`LICENSE` birlikte vendor edildi) |
| Alınma tarihi | 2026-07-21 |

## Dosya bütünlüğü

Git blob SHA-1 değerleri upstream ağacındakiyle **birebir** doğrulandı; SHA-256
değerleri yerel olarak hesaplandı.

| Dosya | Git blob SHA-1 | SHA-256 |
| --- | --- | --- |
| `SKILL.md` | `8aee9831a311edd5d055771c31149e6b73bd7ddd` | `d83cd2d3002a7d77cf4ee395d82059f925429dcd584f9c02ea55f0dee7ca94da` |
| `LICENSE` | `261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64` | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |

`README.md` bilinçli olarak alınmadı: skill davranışına katkısı yoktur.

## Alım öncesi güvenlik incelemesi (2026-07-21)

Sabitlenmiş commit'teki ağaç yalnız üç düz metin dosyası içeriyordu
(`SKILL.md`, `LICENSE`, `README.md`).

- Install/lifecycle script: **yok**
- Binary, executable, `.node`/`.wasm`: **yok**
- Symlink (mode 120000) veya submodule (mode 160000): **yok**
- Nested `.git`: **yok**
- Shell download pipe (`curl … | sh`): **yok**
- Telemetry, auto-update, background service: **yok**
- Kullanıcı home dizinine yazma: **yok**

`SKILL.md` içindeki dış adresler (`http://127.1`, `http://2130706433`,
`http://legit.com.evil.com` vb.) SSRF ve açık yönlendirme **örnekleridir**;
çalıştırılan istek değildir. Talimat enjeksiyonu deseni (önceki talimatları
yok say, gizle, zorla) bulunmadı.

## Güncelleme prosedürü

Upstream'i **latest/main üzerinden kaydırma**. Güncelleme istenirse:

1. Yeni commit SHA'sını belirle ve bu dosyada sabitle.
2. Yeni ağacı indirmeden önce A bölümü incelemesini (script/binary/symlink/
   pipe/telemetry) tekrarla.
3. `SKILL.md` ve `LICENSE` dosyalarını indirip `git hash-object` ile upstream
   blob SHA'larına karşı doğrula; uyuşmazsa **durdur**.
4. İçerik farkını gözden geçir; yeni talimatların HasarBotu invariantlarıyla
   çeliştiği yerleri `HASARBOTU_SECURITY_OVERLAY.md` içinde açıkça karşıla.
5. Bu tabloyu yeni SHA'larla güncelle ve ayrı commit at.

Upstream `SKILL.md` üzerinde **yerel değişiklik yapılmaz**. Projeye özgü her
kural overlay dosyasına yazılır; böylece bir sonraki güncellemede çakışma
çözmek yerine dosyayı doğrudan değiştirmek yeterli olur.
