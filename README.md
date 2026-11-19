# Tulpar

Hesapsız, ücretsiz, uçtan uca şifreli dosya paylaşımı. Tarayıcıda çalışır, kurulum gerektirmez:
**https://tulpar.page**

Tulpar ücretsiz ve reklamsız, kişisel bir projedir. Ticari bir hizmet değildir.

## Nasıl kullanılır

1. Bir cihazda sayfayı açın; ekranda bir QR kod çıkar.
2. Diğer cihazın kamerasıyla QR kodu okutun ya da "Kod göster" ile 8 karakterlik kodu alıp diğer cihaza yazın.
3. İki ekrandaki **doğrulama kodunun** aynı olduğunu kontrol edin.
4. Dosyaları iki yönde de gönderebilirsiniz. Gelen dosya "Kaydet" ile indirilir.

## Dosyalar nereden geçer?

Tarayıcılar birbirine doğrudan bağlanamaz. Bu yüzden iki cihaz da internetteki bir **aktarma
sunucusuna** (İngilizcesi *relay*) bağlanır; şifreli paketler bu sunucunun üzerinden karşı cihaza
geçer. Aktarma sunucusu zarfı taşıyan ama açamayan bir postane gibidir: Dosyanın içeriğini ve adını
okuyamaz, dosyaları saklamaz.

Tulpar, [iroh](https://iroh.computer) yazılımını geliştiren n0 şirketinin herkese açık, ücretsiz
aktarma sunucularını kullanır. n0 bu sunucuları ücretsiz "Community" planı olarak sunar ve
[belgelerinde](https://docs.iroh.computer/iroh-services/relays/public) geliştirme ve hobi kullanımı
için uygun olduğunu yazar. Ticari ölçekteki kullanım için ücretli sunucularını ya da kişinin kendi
sunucusunu önerir. Bu sunucular için çalışma süresi garantisi yoktur ve hız sınırlıdır.

- **Hız:** Ölçülen hız saniyede yaklaşık 0,4 MB'dir; 10 MB'lik bir dosya yaklaşık 30 saniyede
  gider. n0 hız sınırlarını yayımlamaz, gerektiğinde değiştirir.
- **Kullanım büyürse:** Tulpar, n0'ın ücretli aktarma sunucularına ya da kendi aktarma sunucusuna
  geçirilir. Koşullar değişirse bu bölüm de güncellenir.

## Güvenlik modeli

**Korunanlar**

- Dosyaların içeriği ve adı iki tarayıcı arasında uçtan uca şifrelidir: iroh bağlantısı
  QUIC/TLS 1.3 kullanır, iki taraf birbirini Ed25519 açık anahtarlarıyla doğrular.
  Her bağlantıda yeni oturum anahtarı üretilir.
- Aktarma sunucusu yalnızca şifreli paketleri taşır. Dosyalar hiçbir sunucuda saklanmaz.
- QR kod, bağlanılacak cihazın açık anahtarını ve tek kullanımlık 128 bitlik bir değer içerir.
  Değer kullanılınca ve 3 dakikada bir yenilenir. QR ile gelen yeni cihaz için her zaman onay
  sorulur; değeri bilmeyen tanımadık cihazların istekleri soru sorulmadan reddedilir.
- Bağlantı bilerek kesildiyse, iki taraftan biri yeniden bağlanmak istediğinde diğerinde onay sorulur.
- 8 karakterlik kod 5 dakika geçerlidir ve bir kez kullanılabilir. Koddan anahtar PBKDF2
  (200.000 tur) ile türetilir. Kodla gelen her bağlantıda onay sorulur; bağlantı kabul edilince
  iki taraf rastgele anahtarlı asıl adreslerine geçer ve koddan türetilen adres bir daha
  kullanılmaz. **QR kod, 8 karakterlik koddan daha güvenlidir**; mümkünse QR kodu kullanın.
- Doğrulama kodu bağlantının TLS oturumundan türetilir; araya biri girerse iki ekrandaki kod büyük
  olasılıkla farklı olur. QR ile bağlanmada araya girilemez, çünkü telefon bilgisayarın anahtarını
  QR koddan doğrular.

**Görülebilenler**

- n0'ın aktarma sunucuları: iki tarafın IP adresi, bağlantı zamanı ve aktarılan veri miktarı.
  n0 [SSS sayfasında](https://docs.iroh.computer/about/faq) bu bilgileri kaydetmediğini yazar.
- Sayfayı sunan Cloudflare (tulpar.page) ya da GitHub (yedek adres): sayfanın istenmesi (IP,
  zaman, tarayıcı). Adresteki `#` işaretinden sonraki kısım bu sunuculara gitmez.
- Ağ yöneticisi ve internet sağlayıcısı: bağlanılan sunucu adları ve veri miktarı.

**Bir web uygulamasının sağlayamadıkları**

- Sayfanın kodu her açılışta sunucudan gelir. Kodu değiştirebilen biri (ör. hesabı ele geçiren)
  şifrelemeden önce dosyaları okuyabilir.
- Ağda TLS denetimi yapan bir güvenlik duvarı da sayfanın kodunu değiştirebilir. Anlamak için
  tarayıcıda kilit simgesine tıklayıp sertifikayı veren kuruluşa bakın. Bilinen bir sertifika
  kuruluşu yerine güvenlik duvarının ya da kurumun adı yazıyorsa denetim vardır.
- Şifreleme dosyayı yolda korur. İndirilen dosya cihazda düz hâliyle durur.
- Kurum ya da şirket bilgisayarlarında kullanmadan önce bilgi işlem kurallarını kontrol edin.

## Derleme

Gerekenler: Rust (`rust-toolchain.toml`), [wasm-bindgen](https://github.com/wasm-bindgen/wasm-bindgen)
0.2.130, WebAssembly destekli clang (ya da `~/.araclar` altında [wasi-sdk](https://github.com/WebAssembly/wasi-sdk)), Node.js.

```bash
npm run derle       # wasm/ → docs/pkg/
npm run lisanslar   # docs/THIRD_PARTY_LICENSES.txt
```

Yayındaki sürüm GitHub Actions'ta derlenir (`.github/workflows/yayinla.yml`). Derlenen dosyaların
SHA-256 özetleri `docs/pkg/SHA256SUMS` dosyasında ve iş akışı günlüğünde yer alır. Sürüm numarası
`package.json` dosyasındadır ve sayfanın alt bilgisinde görünür.

## Yayın

- **https://tulpar.page**: Cloudflare Pages. İş akışı derlenmiş siteyi `yayin` dalına koyar,
  Cloudflare bu dalı yayımlar. Güvenlik başlıkları `docs/_headers` dosyasındadır.
- **https://hb4sri.github.io/tulpar/**: GitHub Pages, yedek adres. Aynı derleme çıktısı.

## Lisans

[MIT](LICENSE). Kullanılan açık kaynak yazılımların lisansları:
[docs/THIRD_PARTY_LICENSES.txt](docs/THIRD_PARTY_LICENSES.txt).
