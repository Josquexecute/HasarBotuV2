# Dosyalar ekranında sonsuz kaydırma · 0.1.27

Dosyalar ekranı ilk 50 kaydı sunucudan alır. Tablo kaydırma alanının sonuna yaklaşınca sonraki 50 kayıt alta eklenir. Son grupta yükleme durur; aynı anda ikinci istek başlatılmaz. Klavye kullanımı ve otomatik gözlem desteği olmayan ortamlarda **Daha fazla dosya yükle** kullanılabilir.

Arama, filtreleme ve sıralama sunucuda uygulanır. Bunlar değişince liste ilk gruptan başlar; önceki sorgunun geç yanıtı eklenmez. Canlı kayıt değişiklikleri sayfa sınırını kaydırırsa aynı dosya kimliği iki kez gösterilmez. Sonraki grup yüklenemezse mevcut satırlar korunur ve açık tekrar deneme sunulur. Oturum hatasında liste temizlenir.

Kimlikli uygulama kabuğu yalnız bellekte bir liste dönüş görüntüsü tutar. Dosyadan listeye dönünce filtre, seçili dosya ve iki kaydırma ekseni korunur; önceden yüklenmiş aralık sunucudan yeniden okunur. Kullanıcı/kurum kapsamı kontrol edilir; veriler tarayıcı depolamasına yazılmaz. Oturum kabuğu kapanınca bu bellek bırakılır.

Genel arama ile açılmış bir listeden dosyaya gidilip liste düğmesiyle dönüldüğünde arama da korunur. Kullanıcı genel aramadan yeni bir sorgu gönderirse eski yerel sorgu geri yüklenmez; URL'deki yeni sorgu uygulanır.

Uyarı özetleri 100 kimlik sınırına göre gruplandırılır. Aynı anda en fazla iki grup istenir; kaydırmayla değişmeyen gruplar tekrar istenmez. Pencere odağı, uyarı değişiklik olayları ve **Listeyi Yenile** uyarıları da yeniler. 100. satırdan sonraki dosyalarda da uyarı durumu gösterilir.

Doğrulama: ilgili 39 test ve tüm frontend testlerinde 446 test başarılı; ortam koşullarına bağlı 8 test atlandı. İzole PostgreSQL/Fastify/Electron denemesinde 137 sentetik dosyayla otomatik 50→100→137 yükleme, gerçek HTTP 503 sonrası tekrar deneme, dosyadan dönüşte seçim/filtre/kaydırma konumu, güncel verinin yeniden okunması ve genel arama doğrulandı (11 kontrol). Derleme ve TypeScript kontrolü başarılı; lint 0 hata, kapsam dışındaki mevcut 11 uyarı ile tamamlandı. Paketlenmiş Windows uygulamasının gerçek açılışı, 55 arayüz dosyasının hash eşleşmesi, ofis profili ve çarpıyla tepsiye küçülme doğrulandı.
