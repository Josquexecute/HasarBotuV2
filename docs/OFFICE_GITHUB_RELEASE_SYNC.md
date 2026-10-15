# GitHub yayınından ofis güncellemesine aktarım

`scripts/sync-office-github-release.mjs`, özel `Josquexecute/HasarBotuV2` deposundaki
son **yayınlanmış** sürümü ofisin mevcut güncelleme klasörüne aktarır. Taslaklar ve
ön sürümler aktarılmaz. Başarılı `desktop-release.yml` çalışması, kaynak kaydı,
paketin SHA-256/uzunluğu, checksum dosyası ve Windows sürüm bilgisi doğrulanır.
Eski sürüme dönülmez; aynı sürümün farklı dosyayla değiştirilmesi reddedilir.

Bu aktarım aracı kullanıcı bilgisayarında kurulum başlatmaz. Kullanıcılar mevcut
**Ayarlar → Uygulama güncellemeleri** düğmesiyle ofiste yayımlanan paketi alır.
GitHub hesabı veya token çalışan bilgisayarlarına dağıtılmaz. Ofis API'si ve
veritabanı migrasyonları ayrıca yönetilir.

## Etkinleştirme koşulu

Ofis bilgisayarında özel depoyu okuyabilecek GitHub yetkisi gerekir. Kaynak yayını
için kullanılan GitHub Actions token'ı ofise kalıcı erişim sağlamaz. Başka bir
bilgisayardaki GitHub oturumunu veya token'ını ofise kopyalamayın.

Önerilen yetki, yalnız `HasarBotuV2` deposunda **Contents: Read-only** ve
**Actions: Read-only** izinli fine-grained token'dır. Token'ı sohbete veya Git'e
yazmayın. Aşağıdaki gizli Windows istemiyle girildiğinde yalnız görev sahibi
Windows hesabının açabildiği DPAPI biçiminde saklanır. Önceden yetkilendirilmiş ofis
GitHub CLI oturumu varsa şifreli token dosyası olmadan da kullanılabilir.

Yetki doğrulanmadan zamanlanmış görev kaydedilmez. Ofiste bu yetki henüz yoksa
otomatik aktarım **etkin değildir**; mevcut güncelleme kaynağı korunur.

## Yönetici kurulumu

Ofisin açık Windows oturumundaki yönetici hesabıyla çalışın. Yönetici/SYSTEM
yazma izinleriyle korunan `C:\ProgramData\HasarBotu\github-release-sync` klasörü
oluşturun. Token ve ayarlar bu klasörde kalmalıdır. Çalıştırılacak kaynakları da
korunan bir klasörde tutun; geçici veya herkesin yazabildiği dizin kullanmayın.

Şu beş JavaScript dosyasını mevcut runtime'ın
`services\api\tools\release-sync` altına birlikte kopyalayın:

- `scripts/sync-office-github-release.mjs`
- `scripts/office-release-sync.mjs`
- `scripts/published-release.mjs`
- `scripts/release-notes.mjs`
- `scripts/publish-desktop-release.mjs`

Yayınlayıcı mevcut runtime'ın `@hasarbotu/contracts` paketini kullanır. Bu nedenle
bu konum, runtime'ın `services\api\node_modules` bağımlılıklarına erişmelidir.
`deploy/windows-service/*office-release-sync*.ps1` dosyalarını da korunan kurulum
klasörüne birlikte kopyalayın. `config.json` örneği:

```json
{
  "githubExecutable": "C:/Program Files/GitHub CLI/gh.exe",
  "publisherScript": "C:/ProgramData/HasarBotu/runtime-20261011/services/api/tools/release-sync/publish-desktop-release.mjs",
  "releaseDirectory": "C:/ProgramData/HasarBotu/desktop-releases",
  "stateDirectory": "C:/ProgramData/HasarBotu/github-release-sync"
}
```

Gerçek `gh.exe` konumunu `Get-Command gh.exe` ile doğrulayın. Ayar dosyası
`stateDirectory` içinde bulunmalıdır. PowerShell dosyalarının bulunduğu korunan
klasörde, görev sahibi Windows hesabıyla:

```powershell
./set-office-release-sync-credential.ps1 -Configuration C:/ProgramData/HasarBotu/github-release-sync/config.json
./register-office-release-sync.ps1 `
  -Configuration C:/ProgramData/HasarBotu/github-release-sync/config.json `
  -NodeExecutable C:/ProgramData/HasarBotu/runtime-20261011/runtime/node.exe `
  -SyncScript C:/ProgramData/HasarBotu/runtime-20261011/services/api/tools/release-sync/sync-office-github-release.mjs
```

`HasarBotu-GitHub-Release-Sync` görevi Windows girişinde ve beş dakikada bir,
pencere göstermeden çalışır. Üst üste görev çalıştırılmaz. Ofis Windows hesabının
oturum açmış olması gerekir; bu hesap DPAPI anahtarının sahibidir. GitHub'a
ulaşılamazsa veya doğrulama başarısızsa mevcut ofis sürümü değiştirilmez.

`status.json` içinde son kontrol zamanı, sürümler ve `PASS`, `NO_PUBLISHED_RELEASE`,
`AUTH_REQUIRED` veya `BLOCKED` sonucu bulunur. Token görev argümanlarına ve loglara
yazılmaz. Aynı sürüm tekrar kontrol edildiğinde mevcut dosyanın hash'i de doğrulanır.
Görevi durdurmak için yalnız bu isimli görevi devre dışı bırakın; API, pCloud ve
diğer servisleri değiştirmeyin.

Yayınlayıcı `.publish.lock` ile elle başlatılan ve zamanlanmış yayınların aynı anda
manifest değiştirmesini engeller. Yayın işlemi zorla sonlandırılırsa, tekrar
yayınlamadan önce kilitteki PID'nin artık çalışmadığını doğrulayıp yalnız bu kilit
dosyasını kaldırın. Çalışan yayın işleminin kilidini kaldırmayın.
