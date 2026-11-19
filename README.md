# Tulpar

Hesapsız, ücretsiz, uçtan uca şifreli dosya paylaşımı. Tarayıcıda çalışır, kurulum gerektirmez:
**https://tulpar.page**

## Nasıl kullanılır

1. Bir cihazda sayfayı açın; ekranda bir QR kod çıkar.
2. Diğer cihazın kamerasıyla QR kodu okutun ya da "Kod göster" ile 8 karakterlik kodu alıp diğer cihaza yazın.
3. İki ekrandaki **doğrulama kodunun** aynı olduğunu kontrol edin.
4. Dosyaları iki yönde de gönderebilirsiniz. Gelen dosya "Kaydet" ile indirilir.

## Güvenlik modeli

**Korunanlar**

- Dosyaların içeriği ve adı iki tarayıcı arasında uçtan uca şifrelidir: [iroh](https://iroh.computer)
  bağlantısı QUIC/TLS 1.3 kullanır, iki taraf birbirini Ed25519 açık anahtarlarıyla doğrular.
  Her bağlantıda yeni oturum anahtarı üretilir.
- Tarayıcıda bütün trafik n0'ın herkese açık relay sunucularından geçer. Relay şifreli paketleri
  taşır, içeriği okuyamaz. Dosyalar hiçbir sunucuda saklanmaz.
- QR kod, bağlanılacak cihazın açık anahtarını ve tek kullanımlık 128 bitlik bir değer içerir.
  Değer kullanılınca ve 3 dakikada bir yenilenir. QR ile gelen yeni cihaz için her zaman onay
  sorulur; değeri bilmeyen tanımadık cihazların istekleri soru sorulmadan reddedilir.
- Bağlantı bilerek kesildiyse, iki taraftan biri yeniden bağlanmak istediğinde diğerinde onay sorulur.
- Eşleşme kodu 8 karakterdir, 5 dakika geçerlidir ve bir kez kullanılabilir. Koddan anahtar
  PBKDF2 (200.000 tur) ile türetilir. Kodla gelen her bağlantıda onay sorulur; eşleşme kabul
  edilince iki taraf rastgele anahtarlı asıl adreslerine geçer ve koddan türetilen adres bir daha
  kullanılmaz. **QR kod, kodla eşleşmeden daha güçlüdür**; mümkünse QR kodu kullanın.
- Doğrulama kodu bağlantının TLS oturumundan türetilir; araya biri girerse iki ekrandaki kod büyük
  olasılıkla farklı olur. QR ile eşleşmede araya girilemez, çünkü telefon PC'nin anahtarını QR koddan doğrular.

**Görülebilenler**

- n0 relay'leri: iki tarafın IP adresi, uç nokta kimlikleri, bağlantı zamanı ve aktarılan veri miktarı.
- GitHub: sayfanın istenmesi (IP, zaman, tarayıcı). Adresteki `#` sonrası GitHub'a gitmez.
- Ağ yöneticisi ve internet sağlayıcısı: bağlanılan sunucu adları ve veri miktarı.

**Bir web uygulamasının sağlayamadıkları**

- Sayfanın kodu her açılışta GitHub'dan gelir. Kodu değiştirebilen biri (ör. hesabı ele geçiren)
  şifrelemeden önce dosyaları okuyabilir.
- Ağda TLS denetimi yapan bir güvenlik duvarı da sayfanın kodunu değiştirebilir. Anlamak için
  tarayıcıda kilit simgesine tıklayıp sertifikayı veren kuruluşa bakın. Bilinen bir sertifika
  kuruluşu yerine güvenlik duvarının ya da kurumun adı yazıyorsa denetim vardır.
- Şifreleme dosyayı yolda korur. İndirilen dosya cihazda düz hâliyle durur.
- Kurum ya da şirket bilgisayarlarında kullanmadan önce bilgi işlem kurallarını kontrol edin.

**Hız ve süreklilik**

n0'ın ücretsiz relay'leri bağlantı başına hız sınırı uygular ve geliştirme ile kişisel kullanım
içindir; ölçülen hız yaklaşık 0,4 MB/sn'dir (10 MB yaklaşık 30 saniye). Sınırlar ve hizmet koşulları
değişebilir.

## Derleme

Gerekenler: Rust (`rust-toolchain.toml`), [wasm-bindgen](https://github.com/wasm-bindgen/wasm-bindgen)
0.2.130, WebAssembly destekli clang (ya da `~/.araclar` altında [wasi-sdk](https://github.com/WebAssembly/wasi-sdk)), Node.js.

```bash
npm run derle       # wasm/ → docs/pkg/
npm run lisanslar   # docs/THIRD_PARTY_LICENSES.txt
```

Yayındaki sürüm GitHub Actions'ta derlenir (`.github/workflows/yayinla.yml`). Derlenen dosyaların
SHA-256 özetleri `docs/pkg/SHA256SUMS` dosyasında ve iş akışı günlüğünde yer alır.

## Yayın

- **https://tulpar.page**: Cloudflare Pages. İş akışı derlenmiş siteyi `yayin` dalına koyar,
  Cloudflare bu dalı yayımlar. Güvenlik başlıkları `docs/_headers` dosyasındadır.
- **https://hb4sri.github.io/tulpar/**: GitHub Pages, yedek adres. Aynı derleme çıktısı.

## Lisans

[MIT](LICENSE). Kullanılan açık kaynak yazılımların lisansları:
[docs/THIRD_PARTY_LICENSES.txt](docs/THIRD_PARTY_LICENSES.txt).
