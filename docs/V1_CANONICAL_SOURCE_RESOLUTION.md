# Aynı V1 kaynağının kopyalarını çözme

`run-v1-import.mjs --resolution-file <korumalı-json>` artık isteğe bağlı
`canonicalSources` alanını kabul eder. Bu karar yalnızca aynı stable source
identity ve birebir aynı `takip.json` SHA-256 değerine sahip kaynaklar içindir.
Kaynakları değiştirmez, yeniden adlandırmaz veya silmez.

Mevcut `hasarbotu-v1-resolution/1.0.0` manifestine şu alan eklenebilir:

```json
{
  "schemaVersion": "hasarbotu-v1-resolution/1.0.0",
  "canonicalSources": {
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": {
      "pathToken": "bbbbbbbbbbbbbbbb",
      "sourceHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "aliasPathTokens": ["dddddddddddddddd"]
    }
  }
}
```

Örnekteki tokenları önizlemedeki gerçek değerlerle değiştirin. Anahtar kaynak
kimliği; `pathToken` seçilen ana klasör; `sourceHash` ortak sidecar hash'i;
`aliasPathTokens` aynı kimliğin diğer **bütün** klasör tokenlarıdır.

Karardan önce evrakların aynı hasara ait olduğunu inceleyin. Evrak içeriği
eşitliği bu manifest alanıyla otomatik kanıtlanmaz. Yerel 11 Ekim uygulamasında
iki klasörün 78/78 evrak yolu, boyutu ve SHA-256 değeri ayrıca karşılaştırıldı.

Eksik/fazla alias, değişen sidecar, bulunmayan seçim veya ana klasörün geçersiz
plaka biçimi önizlemeyi reddeder. Geçerli biçimdeki aliasların plakası da ana
klasörle aynı olmalıdır. Ana kaynağın hasar türü ve hedef eşleme kontrolleri
korunur; çelişkili kanıt karantinada kalır.

Yalnız ana kaynak vaka/not/görev/kapanış aktarımına katılır. Diğer kaynaklar
`duplicate_alias` olarak immutable source revision/alias ve audit ile korunur.
Başarılı ana aktarım, ilgili eski karantinaları append-only çözüm kaydıyla
kapatır. Tekrar uygulama vaka, not, kapanış veya audit çoğaltmaz.

CLI'nin mevcut gerçek TTY, aktif aktör, tam plan hash'i ve açık uygulama onayı
korunur. Kod güncellendikten sonra eski onaylı planları kullanmayın; yeniden
önizleme alın. Kişisel veri içeren manifest ve kanıtları Git'e eklemeyin.
