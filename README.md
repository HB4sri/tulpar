<p align="center">
  <img src="docs/simge.svg" width="96" height="96" alt="Tulpar simgesi">
</p>

<h1 align="center">Tulpar</h1>

<p align="center">
  Hesapsız, ücretsiz, uçtan uca şifreli dosya paylaşımı. Tarayıcıda çalışır, kurulum gerektirmez.<br>
  <a href="https://tulpar.page"><strong>tulpar.page</strong></a>
</p>

Tulpar ücretsiz ve reklamsız, kişisel bir projedir. Ticari bir hizmet değildir.

## Nasıl kullanılır

1. Bir cihazda sayfayı açın; ekranda bir QR kod çıkar.
2. Diğer cihazın kamerasıyla QR kodu okutun ya da "Kod göster" ile 8 karakterlik kodu alıp diğer cihaza yazın.
3. İki ekrandaki **doğrulama kodunun** aynı olduğunu kontrol edin.
4. Dosyaları iki yönde de gönderebilirsiniz. Gelen dosya "Kaydet" ile indirilir.

## Dosyalar nereden geçer?

Tarayıcılar farklı ağlardaki cihazlara doğrudan bağlanamaz. Bu yüzden iki cihaz da internetteki bir **aktarma
sunucusuna** (İngilizcesi *relay*) bağlanır; şifreli paketler bu sunucunun üzerinden karşı cihaza
geçer. Aktarma sunucusu zarfı taşıyan ama açamayan bir postane gibidir: Dosyanın içeriğini ve adını
okuyamaz, dosyaları saklamaz.

Tulpar, [iroh](https://iroh.computer) yazılımını geliştiren n0 şirketinin herkese açık, ücretsiz
aktarma sunucularını kullanır. n0 bu sunucuları ücretsiz "Community" planı olarak sunar ve
[belgelerinde](https://docs.iroh.computer/iroh-services/relays/public) geliştirme ve hobi kullanımı
için uygun olduğunu yazar. Ticari ölçekteki kullanım için ücretli sunucularını ya da kişinin kendi
sunucusunu önerir. Bu sunucular için çalışma süresi garantisi yoktur ve hız sınırlıdır.

İki cihaz aynı ağdaysa (ör. evdeki Wi-Fi) Tulpar bağlandıktan sonra doğrudan bağlantı da dener.
Kurulursa dosyalar aktarma sunucusuna uğramadan, ağın hızında gider. Kurulamazsa (farklı ağlar,
misafir ağları, cihazları birbirinden ayıran ağlar) aktarma sunucusu kullanılmaya devam eder.
Ekranda hangi yolun kullanıldığı yazar. Bunun için her bağlantıda cihazın internetteki adresi
Cloudflare'in STUN sunucusundan öğrenilir; dosyalar bu sunucudan geçmez.

- **Hız:** Aktarma sunucusunda ölçülen hız saniyede yaklaşık 0,4 MB'dir; 10 MB'lik bir dosya yaklaşık 30 saniyede
  gider. n0 hız sınırlarını yayımlamaz, gerektiğinde değiştirir.
- **Kullanım büyürse:** Tulpar, n0'ın ücretli aktarma sunucularına ya da kendi aktarma sunucusuna
  geçirilir. Koşullar değişirse bu bölüm de güncellenir.

## Sorun giderme

Tulpar bir cihazda ya da ağda çalışmıyorsa [tanılama sayfasını](https://tulpar.page/tanilama/) açın.
Sayfa, tarayıcının uygun olup olmadığını, aktarma sunucularına ulaşılıp ulaşılamadığını ve bu ağda
doğrudan bağlantının kurulup kurulamadığını kontrol eder.
Sonuçları "Sonuçları kopyala" düğmesiyle alabilirsiniz.

## Güvenlik modeli

**Korunanlar**

- Dosyaların içeriği ve adı iki tarayıcı arasında uçtan uca şifrelidir: iroh bağlantısı
  QUIC/TLS 1.3 kullanır, iki taraf birbirini Ed25519 açık anahtarlarıyla doğrular.
  Her bağlantıda yeni oturum anahtarı üretilir.
- Aktarma sunucusu yalnızca şifreli paketleri taşır. Dosyalar hiçbir sunucuda saklanmaz.
- Doğrudan bağlantı WebRTC ile kurulur ve DTLS ile şifrelenir. Kurulum bilgileri ve şifreleme
  anahtarının parmak izi, kimliği zaten doğrulanmış Tulpar bağlantısı üzerinden değiştirilir; bu
  yüzden araya kimse giremez. Karşı cihazdan yalnızca yerel ağ adresleri kabul edilir. Cihazın
  internetteki adresi karşı tarafa yalnızca iki cihazın adresi aynıysa gönderilir. Adreslerin aynı
  olup olmadığını anlamak için adresin 16 bitlik kısa bir özeti paylaşılır. Bu özet adresi ele
  vermez ama olası adresleri daraltır.
- QR kod, bağlanılacak cihazın açık anahtarını ve tek kullanımlık 128 bitlik bir değer içerir.
  Değer her bağlantıda ve 3 dakikada bir yenilenir; bağlı cihaz yokken sekmenin anahtarı da
  yenilenir. QR ile gelen yeni cihaz için her zaman onay sorulur; değeri bilmeyen tanımadık
  cihazların istekleri soru sorulmadan reddedilir. Onay sorusunda bağlanan cihazın kendine verdiği
  ad tırnak içinde yazar.
- Bağlantı bilerek kesildiyse, iki taraftan biri yeniden bağlanmak istediğinde diğerinde onay sorulur.
- 8 karakterlik kod 5 dakika geçerlidir ve bir kez kullanılabilir. Koddan anahtar PBKDF2
  (200.000 tur) ile türetilir. Kodla gelen her bağlantıda onay sorulur; bağlantı kabul edilince
  iki taraf rastgele anahtarlı asıl adreslerine geçer ve koddan türetilen adres bir daha
  kullanılmaz. Kodla gelen 3 istek reddedilirse kod kendiliğinden yenilenir. **QR kod, 8
  karakterlik koddan daha güvenlidir**; mümkünse QR kodu kullanın.
- Doğrulama kodu bağlantının TLS oturumundan türetilir; araya biri girerse iki ekrandaki kod büyük
  olasılıkla farklı olur. QR ile bağlanmada araya girilemez, çünkü telefon bilgisayarın anahtarını
  QR koddan doğrular. 8 karakterlik kodla bağlanmada ise kodu öğrenen ve özel bir araç kullanan
  biri, iki ekranda aynı doğrulama kodunu çıkarmayı deneyebilir.
- Alınan dosyalar kaydedilene ya da listeden kaldırılana kadar tarayıcının belleğinde durur.
  Toplamları 2 GB (iPhone'da 600 MB) ile sınırlıdır. Kaydedilen dosyanın bellekteki kopyası bir
  dakika sonra bırakılır.

**Kullanırken**

- Yalnızca kendi cihazınızdaki QR kodu okutun. Başkasının gönderdiği Tulpar bağlantısını açmayın;
  dosya göndermek isteyen biri sizin QR kodunuzu okutmalı.
- 8 karakterlik kodu yüksek sesle okumayın ve ekran paylaşırken göstermeyin.
- Program dosyalarını (ör. .exe, .apk) yalnızca güvendiğiniz bir kaynaktan geldiyse açın.

**Görülebilenler**

- n0'ın aktarma sunucuları:
  - iki tarafın IP adresi, bağlantı zamanı ve aktarılan veri miktarı,
  - iki cihazın kimlik numaraları (kimin kimle bağlandığı; ad ya da kişi bilgisi olmadan),
  - bağlantının Tulpar'a ait olduğu,
  - trafiğin şeklinden dosya sayısı ve yaklaşık boyutları, doğrudan bağlantıya geçildiği,
  - kodla bağlanmada koddan türetilen kimlik numarası.

  n0 [SSS sayfasında](https://docs.iroh.computer/about/faq) bu bilgileri kaydetmediğini yazar.
- Sayfayı sunan Cloudflare (tulpar.page): sayfanın istenmesi (IP, zaman, tarayıcı). Ağ hatası
  olduğunda tarayıcı Cloudflare'e bir hata raporu da gönderebilir; raporda dosyalarla ilgili bilgi
  yoktur.
- Adresteki `#` işaretinden sonraki kısım hiçbir sunucuya gitmez. Sayfa açılınca adres çubuğundan
  silinir ama tarayıcı geçmişinde kalabilir. Bu kısım tek kullanımlıktır ve en çok 3 dakika
  geçerlidir.
- Cloudflare'in STUN sunucusu (her bağlantıda, iki cihazdan da): IP adresi ve zaman. Cloudflare bu
  bilgileri sayfayı sunarken de görür.
- Ağ yöneticisi ve internet sağlayıcısı: bağlanılan sunucu adları ve veri miktarı. STUN sorgusu
  şifresiz gider; aynı ağdaki doğrudan aktarımın varlığı ve miktarı da görülebilir.
- Eşleşilen cihaz: cihazınızın adı; doğrudan bağlantı denenirken cihazın yerel ağ adresi ya da
  tarayıcının ürettiği geçici yerel adı ve internet adresinin 16 bitlik özeti; iki cihaz aynı
  ağdaysa ortak internet adresi.

**Bir web uygulamasının sağlayamadıkları**

- Sayfanın kodu her açılışta sunucudan gelir. Kodu değiştirebilen biri (ör. GitHub ya da
  Cloudflare hesabını ele geçiren) şifrelemeden önce dosyaları okuyabilir.
- Ağda TLS denetimi yapan bir güvenlik duvarı da sayfanın kodunu değiştirebilir. Anlamak için
  tarayıcıda kilit simgesine tıklayıp sertifikayı veren kuruluşa bakın. Bilinen bir sertifika
  kuruluşu yerine güvenlik duvarının ya da kurumun adı yazıyorsa denetim vardır.
- Şifreleme dosyayı yolda korur. İndirilen dosya cihazda düz hâliyle durur. Tarayıcı büyük
  dosyaları kaydedilmeden önce de geçici olarak diske yazabilir.
- Kurum ya da şirket bilgisayarlarında kullanmadan önce bilgi işlem kurallarını kontrol edin.

## Derleme

Gerekenler: Rust (`rust-toolchain.toml`), [wasm-bindgen](https://github.com/wasm-bindgen/wasm-bindgen)
0.2.130, WebAssembly destekli clang (ya da `~/.araclar` altında [wasi-sdk](https://github.com/WebAssembly/wasi-sdk)), Node.js.

```bash
npm run derle       # wasm/ → docs/pkg/
npm run lisanslar   # docs/THIRD_PARTY_LICENSES.txt
```

Yayındaki sürüm GitHub Actions'ta derlenir (`.github/workflows/yayinla.yml`). Yayımlanan bütün
dosyaların SHA-256 özetleri [tulpar.page/SHA256SUMS](https://tulpar.page/SHA256SUMS) dosyasında ve
iş akışı günlüğünde yer alır. Sürüm numarası
`package.json` dosyasındadır ve sayfanın alt bilgisinde görünür.

## Yayın

**https://tulpar.page**: Cloudflare Pages. İş akışı derlenmiş siteyi `yayin` dalına yeni bir commit
olarak ekler, Cloudflare bu dalı yayımlar. Dal silinemez ve geçmişi değiştirilemez; her yayın
dalda geriye dönük görülebilir. Güvenlik başlıkları `docs/_headers` dosyasındadır.

## Lisans

[MIT](LICENSE). Kullanılan açık kaynak yazılımların lisansları:
[docs/THIRD_PARTY_LICENSES.txt](docs/THIRD_PARTY_LICENSES.txt).
