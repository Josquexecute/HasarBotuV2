# Kullanıcı kontrollü GitHub yayını

Yeni sürümler şimdilik yalnız **özel** `Josquexecute/HasarBotuV2` deposunda
hazırlanır. Kaynağı GitHub'a gönderme ve **Publish release** adımları kullanıcıya
aittir; otomasyon kendiliğinden yayın yapmaz.

## İlk yayın: 0.1.16

1. Doğrulanan değişiklikleri `main` dalına gönderin.
2. GitHub **Actions → HasarBotu sürümünü doğrula ve taslak hazırla** çalışmasının
   başarılı olmasını bekleyin. Kontroller başarısızsa hazır sürüm oluşturulmaz.
3. **Releases** sayfasındaki otomatik hazırlanmış **Draft: HasarBotu 0.1.16**
   kaydını açın. Çalışma özetindeki bağlantı da bu taslağa gider.
4. Başlığı ve açıklamayı inceleyin. Kurulum dosyası `HasarBotu-Kurulum.exe` ve
   `SHA256SUMS.txt` taslağa eklenmiş olmalıdır. Açıklamada **Paket yükleniyor**
   yazıyorsa çalışma tamamlanmamıştır; yayınlamayın.
5. Hazır taslakta **Publish release** düğmesine basın. Ardından **Yayınlanan özel
   sürümün bütünlüğünü doğrula** çalışmasının başarılı olduğunu kontrol edin.

Boş bir **Create a new release** formu açmaya gerek yoktur. GitHub'ın o formu,
etiket yazılınca değişiklik açıklamasını kendiliğinden doldurmaz. Burada açıklama,
paket ve `v0.1.16` etiketi doğrulama sonrasında hazır taslakta birlikte hazırlanır.
Etiket, test edilen `main` kaydına sabitlenir; daha sonra değişen `main` nedeniyle
paketin başka kaynak koduyla eşleşmesi önlenir. Hazır etiketi değiştirmeyin.

## Sonraki sürümler

Önceki sürüm yayınlandıktan sonra yeni yayın için masaüstü sürümünü artırın:

```powershell
npm version 0.1.17 --workspace @hasarbotu/desktop --no-git-tag-version
```

`apps/desktop/package.json` ve `package-lock.json` değişikliklerini kaynakla birlikte
gönderin. Aynı sürüm henüz taslakken sonraki `main` gönderimleri taslağı yeniden
doğrular ve günceller. Yayınlanmış bir sürümün paketi değiştirilmez; sürüm artırılır.

Açıklama önceki yayınla yeni kaynak kaydı arasındaki commit başlıklarından üretilir.
`feat: ...` ve `fix: ...` başlıkları özellik/düzeltme olarak gruplanır. İlk karşılaştırma
0.1.15'in kaynak kaydını kullanır. Daha anlaşılır sürüm özeti gerekiyorsa
`.github/release-notes/<sürüm>.md` ekleyin. Taslakta kişisel ekleri otomatik bloğun
dışına yazın; yeniden hazırlama bunları korur. Gizli `hasarbotu-*` doğrulama
işaretlerini silmeyin. Açıklama uygulamadaki 4.000 karakter sınırına uymalıdır;
aşılırsa çalışma hata verir ve yayın için hazır taslak üretmez.

## Doğrulama ve yapılandırma

Windows x64 çalışması Node 24 ile kilitli bağımlılıkları kurar; TypeScript, ESLint,
build, çalışma alanı testleri, gerçek Electron testleri ve arka plan klasör keşfi
testini çalıştırır. PostgreSQL test kümesi yalnız çalışma için oluşturulur ve
kapatılır; ofis veritabanına bağlanılmaz. Test sonuçlarında atlanan kontroller ayrı
gösterilir. Gerçek Google hesabı ve ofis sunucusunun yeni sürüm kabulü bu çalışma
tarafından doğrulanmış sayılmaz.

NSIS paketi ayrıca gerçekten açılır; sürümü, ofis profili, paketlenmiş arayüz
dosyaları, HTTP sunumu ve normal kapanışı kontrol edilir. Taslağa eklenen dosyanın
Windows sürüm bilgisi, uzunluğu ve SHA-256 değeri kontrol edilir. Kullanıcı yayından
sonra yapılan kontrol, özel depodan gerçek dosyayı indirip kaynak kaydı, sürüm ve
dosya bütünlüğünü yeniden doğrular. Kurulum henüz Authenticode imzalı değildir.

Depodaki **Settings → Secrets and variables → Actions → Variables** alanında
`HASARBOTU_OFFICE_API_ORIGIN`, `HASARBOTU_OFFICE_LAN_IPV4` ve
`HASARBOTU_OFFICE_LAN_HOSTNAME` hazırlanmıştır. Bunlar paketle dağıtılan bağlantı
parametreleridir; parola veya API anahtarı değildir. Özel depo yayını GitHub'ın
otomatik token'ını kullanır; ek kişisel token veya secret gerekmez.

## Dağıtım kapsamı

Yeni özel sürümleri yalnız GitHub'da bu depoya erişimi olan kişiler indirebilir.
`HasarBotu-Downloads` deposundaki herkese açık 0.1.15 bağlantısı bu akışla
güncellenmez. Yalnız özel yayın kararı değişmedikçe buraya kopyalama yapılmaz.

GitHub yayını, ofis API'sini veya veritabanı migrasyonlarını otomatik kurmaz.
Uygulama içindeki güncelleme düğmesi de GitHub yerine ofisin kimlik doğrulamalı
güncelleme kaynağını kullanır. Kullanıcı yayını ve paket kabulü sonrasında aynı
doğrulanmış dosya ayrıca [ofis güncelleme kaynağına](DESKTOP_UPDATES.md) aktarılır.
Bu aktarım tamamlanana kadar mevcut ofis sürümü değişmez.

İlk gerçek GitHub Actions çalışması, bu dosyalar kullanıcı tarafından `main` dalına
gönderildikten sonra yapılacaktır. Yerel kontrolün geçmesi, GitHub çalışmasının
zaten gerçekleştiği anlamına gelmez.
