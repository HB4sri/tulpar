//! Tarayıcıda çalışan iroh çekirdeği.
//!
//! Bağlantı kurmayı ve ham bayt akışlarını JavaScript'e açar. Dosya adı, boyutu,
//! ilerleme gibi her şey JavaScript tarafında, akışın başına yazılan başlıkla taşınır.
//! Tarayıcıda bütün trafik relay üzerinden geçer ve QUIC/TLS 1.3 ile uçtan uca şifrelidir;
//! TLS, iki tarafı Ed25519 açık anahtarlarıyla (uç nokta kimliği) doğrular.

use std::{cell::RefCell, rc::Rc};

use iroh::{
    Endpoint, EndpointAddr, EndpointId, RelayMode, RelayUrl, SecretKey,
    endpoint::{Connection, ConnectionError, Incoming, QuicTransportConfig, RecvStream, SendStream, presets},
};
use js_sys::{Promise, Uint8Array};
use tokio::sync::Notify;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

const ALPN: &[u8] = b"tulpar/1";
const OKUMA_PARCASI: usize = 256 * 1024;

/// n0'ın herkese açık relay'leri. iroh bunları sonu noktalı yazar (`….iroh.link.`);
/// iPhone'da (iOS WebKit) bu biçimle WebSocket bağlantısı kurulamıyor; noktasız hâlleri kullanılıyor.
/// Tanı sayfasında doğrulandı: noktasız adres bağlanıyor, noktalı adres bağlanamıyor.
const RELAYLER: [&str; 4] = [
    "https://euc1-1.relay.n0.iroh.link/",
    "https://use1-1.relay.n0.iroh.link/",
    "https://usw1-1.relay.n0.iroh.link/",
    "https://aps1-1.relay.n0.iroh.link/",
];

fn relay_modu() -> Result<RelayMode, JsValue> {
    let adresler = RELAYLER.iter().map(|u| u.parse::<RelayUrl>()).collect::<Result<Vec<_>, _>>();
    Ok(RelayMode::custom(adresler.map_err(hata)?))
}

/// Karşı tarafın açabileceği akış sayısı ve belleğe alabileceği veri sınırlanır.
fn tasima() -> QuicTransportConfig {
    QuicTransportConfig::builder()
        .max_concurrent_uni_streams(8u32.into())
        .max_concurrent_bidi_streams(0u32.into())
        .receive_window((16u32 * 1024 * 1024).into())
        .build()
}

fn anahtar_olustur(tohum: &Uint8Array) -> Result<SecretKey, JsValue> {
    let baytlar: [u8; 32] = tohum.to_vec().try_into().map_err(|_| hata("Anahtar 32 bayt olmalı"))?;
    Ok(SecretKey::from_bytes(&baytlar))
}

#[wasm_bindgen(start)]
fn yukle() {
    console_error_panic_hook::set_once();
}

fn hata(e: impl std::fmt::Display) -> JsValue {
    js_sys::Error::new(&e.to_string()).into()
}

/// Bu tarayıcıdaki iroh uç noktası.
#[wasm_bindgen]
pub struct Dugum {
    ep: Endpoint,
}

#[wasm_bindgen]
impl Dugum {
    /// Verilen 32 baytlık anahtarla bir uç nokta açar ve bir relay'e bağlanana kadar bekler.
    /// Anahtarı JavaScript üretir: sekme anahtarı rastgeledir, kodla eşleşmede koddan türetilir.
    /// Uç nokta hiçbir adres hizmetine yayımlanmaz; karşı taraf adresi bilet ya da koddan öğrenir.
    /// Sonuç: `Dugum`.
    pub fn baslat(tohum: Uint8Array) -> Promise {
        future_to_promise(async move {
            let anahtar = anahtar_olustur(&tohum)?;
            let ep = Endpoint::builder(presets::Minimal)
                .secret_key(anahtar)
                .relay_mode(relay_modu()?)
                .transport_config(tasima())
                .alpns(vec![ALPN.to_vec()])
                .bind()
                .await
                .map_err(hata)?;
            ep.online().await;
            Ok(Dugum { ep }.into())
        })
    }

    /// Koddan türetilen anahtarın adresi; `baglan` bununla çağrılır. Kodu gösteren tarafın
    /// hangi relay'i seçtiği bilinmediği için relay'lerin hepsi eklenir.
    pub fn koddan_bilet(tohum: Uint8Array) -> Result<String, JsValue> {
        let mut bilet = anahtar_olustur(&tohum)?.public().to_string();
        for relay in RELAYLER {
            bilet.push('~');
            bilet.push_str(relay);
        }
        Ok(bilet)
    }

    pub fn kimlik(&self) -> String {
        self.ep.id().to_string()
    }

    /// Karşı tarafın bağlanması için gereken bilgi: `<kimlik>~<relay adresi>`.
    pub fn bilet(&self) -> String {
        let adres = self.ep.addr();
        let relay = adres.relay_urls().next().map(|u| u.to_string()).unwrap_or_default();
        format!("{}~{}", adres.id, relay)
    }

    /// Gelen bir bağlantı isteğini bekler. El sıkışma burada beklenmez (`Gelen::tamamla`), böylece
    /// takılan bir istek arkasındakileri bekletmez. Sonuç: `Gelen`, uç nokta kapandıysa `null`.
    pub fn bekle(&self) -> Promise {
        let ep = self.ep.clone();
        future_to_promise(async move {
            let Some(gelen) = ep.accept().await else {
                return Ok(JsValue::NULL);
            };
            Ok(Gelen { gelen: RefCell::new(Some(gelen)) }.into())
        })
    }

    /// Bilet (`<kimlik>~<relay>[~<relay>…]`) ile karşı tarafa bağlanır. Sonuç: `Baglanti`.
    /// Relay'ler yalnız bilinen listeden kabul edilir.
    pub fn baglan(&self, bilet: String) -> Promise {
        let ep = self.ep.clone();
        future_to_promise(async move {
            let mut parcalar = bilet.split('~');
            let kimlik: EndpointId = parcalar.next().unwrap_or_default().parse().map_err(hata)?;
            let mut adres = EndpointAddr::new(kimlik);
            for relay in parcalar.filter(|r| !r.is_empty()) {
                if !RELAYLER.contains(&relay) {
                    return Err(hata("Bilinmeyen relay adresi"));
                }
                adres = adres.with_relay_url(relay.parse::<RelayUrl>().map_err(hata)?);
            }
            let conn = ep.connect(adres, ALPN).await.map_err(hata)?;
            Ok(Baglanti { conn }.into())
        })
    }

    pub fn kapat(&self) -> Promise {
        let ep = self.ep.clone();
        future_to_promise(async move {
            ep.close().await;
            Ok(JsValue::UNDEFINED)
        })
    }
}

/// Henüz el sıkışması tamamlanmamış gelen bağlantı isteği.
#[wasm_bindgen]
pub struct Gelen {
    gelen: RefCell<Option<Incoming>>,
}

#[wasm_bindgen]
impl Gelen {
    /// El sıkışmayı tamamlar. Sonuç: `Baglanti`. Yalnız bir kez çağrılabilir.
    pub fn tamamla(&self) -> Promise {
        let gelen = self.gelen.borrow_mut().take();
        future_to_promise(async move {
            let gelen = gelen.ok_or_else(|| hata("İstek zaten işlendi"))?;
            let conn = gelen.await.map_err(hata)?;
            Ok(Baglanti { conn }.into())
        })
    }
}

/// İki tarayıcı arasındaki bağlantı. Her dosya kendi tek yönlü akışında gider.
#[wasm_bindgen]
pub struct Baglanti {
    conn: Connection,
}

#[wasm_bindgen]
impl Baglanti {
    /// Karşı tarafın doğrulanmış kimliği (TLS el sıkışmasında kanıtlanan açık anahtar).
    pub fn karsi_kimlik(&self) -> String {
        self.conn.remote_id().to_string()
    }

    /// 6 haneli doğrulama kodu: bu bağlantının TLS oturum sırlarından ve iki tarafın rastgele
    /// değerlerinden türetilir. İki uçta aynı çıkar; araya giren biri iki ayrı oturum kurmak zorunda
    /// kalacağından kodlar farklı olur.
    ///
    /// `bagli_deger` bağlanan tarafın, `kabul_degeri` bağlantıyı kabul eden tarafın değeridir.
    /// Bağlanan taraf kendi değerini önce SHA-256 özetiyle bağlar (taahhüt), karşının değerini
    /// aldıktan sonra açar; JavaScript, kabul eden tarafta özetin tuttuğunu denetler. Böylece
    /// araya giren biri kendi değerini kodları eşitleyecek biçimde seçemez: iki oturumun her
    /// birinde son değeri dürüst taraf verir ve kodların tutma olasılığı milyonda birdir.
    pub fn dogrulama(&self, bagli_deger: Uint8Array, kabul_degeri: Uint8Array) -> Result<String, JsValue> {
        let (a, b) = (bagli_deger.to_vec(), kabul_degeri.to_vec());
        if a.len() != 32 || b.len() != 32 {
            return Err(hata("Doğrulama değeri 32 bayt olmalı"));
        }
        let mut cikti = [0u8; 8];
        self.conn
            .export_keying_material(&mut cikti, b"tulpar dogrulama 2", &[a, b].concat())
            .map_err(|_| hata("Doğrulama kodu üretilemedi"))?;
        Ok(format!("{:06}", u64::from_be_bytes(cikti) % 1_000_000))
    }

    /// İki tarafın dış adres anahtarlarını, adresleri göstermeden karşılaştırmak için CPace
    /// (bk. `Karsilastirma`). `teklif_eden`: doğrudan bağlantıyı teklif eden taraf mı?
    /// `anahtarlar`: her yuva için bir anahtar (IPv4 dış adresi, IPv6 ağ öneki); anahtarı olmayan
    /// yuvaya boş dize verilir ve yerine rastgele bir değer konur, karşı taraf bunu ayırt edemez.
    pub fn karsilastir(&self, teklif_eden: bool, v4: String, v6: String) -> Result<Karsilastirma, JsValue> {
        let mut sid = [0u8; 16];
        self.conn
            .export_keying_material(&mut sid, b"tulpar cpace 1", b"")
            .map_err(|_| hata("Karşılaştırma başlatılamadı"))?;
        let mut yuvalar = Vec::new();
        for (ad, anahtar) in [(&b"tulpar v4"[..], v4), (&b"tulpar v6"[..], v6)] {
            let prs = if anahtar.is_empty() { rastgele::<32>()?.to_vec() } else { anahtar.into_bytes() };
            yuvalar.push(cpace::Yuva::yeni(&prs, ad, &sid)?);
        }
        Ok(Karsilastirma { teklif_eden, sid, yuvalar, iskler: Vec::new() })
    }

    /// Gönderim için yeni bir akış açar. Sonuç: `Gonderici`.
    pub fn akis_ac(&self) -> Promise {
        let conn = self.conn.clone();
        future_to_promise(async move {
            let akis = conn.open_uni().await.map_err(hata)?;
            Ok(Gonderici { akis: Rc::new(RefCell::new(Some(akis))) }.into())
        })
    }

    /// Karşı tarafın açtığı akışı bekler. Sonuç: `Alici`, bağlantı kapandıysa `null`.
    pub fn akis_bekle(&self) -> Promise {
        let conn = self.conn.clone();
        future_to_promise(async move {
            match conn.accept_uni().await {
                Ok(akis) => Ok(Alici { akis: Rc::new(RefCell::new(Some(akis))), iptal: Rc::new(Notify::new()) }.into()),
                Err(_) => Ok(JsValue::NULL),
            }
        })
    }

    /// Bağlantı kapanınca çözülür. Sonuç: karşı taraf `kapat` ile kapattıysa onun verdiği neden,
    /// değilse hatanın metni.
    pub fn kapanis(&self) -> Promise {
        let conn = self.conn.clone();
        future_to_promise(async move {
            let neden = match conn.closed().await {
                ConnectionError::ApplicationClosed(k) => String::from_utf8_lossy(&k.reason).into_owned(),
                e => e.to_string(),
            };
            Ok(neden.into())
        })
    }

    /// Bağlantıyı kapatır; `neden` karşı tarafın `kapanis` sonucuna iletilir.
    /// Anlamını JavaScript belirler.
    pub fn kapat(&self, neden: String) {
        self.conn.close(0u8.into(), neden.as_bytes());
    }
}

fn rastgele<const N: usize>() -> Result<[u8; N], JsValue> {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).map_err(hata)?;
    Ok(b)
}

fn onaltili(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn onaltilidan(s: &str, uzunluk: usize) -> Result<Vec<u8>, JsValue> {
    if s.len() != uzunluk * 2 || !s.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err(hata("Beklenmeyen karşılaştırma iletisi"));
    }
    Ok((0..uzunluk).map(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap()).collect())
}

/// CPace (draft-irtf-cfrg-cpace, ristretto255 ve SHA-512): iki taraf ortak bir sırrı (burada dış
/// adres anahtarını) bilip bilmediklerini, sırrı göstermeden öğrenir. Karşı taraf her yuva için
/// yalnız tek bir tahminin doğru olup olmadığını öğrenebilir; iletilerden çevrim dışı deneme
/// yapılamaz.
mod cpace {
    use curve25519_dalek::{
        ristretto::{CompressedRistretto, RistrettoPoint},
        scalar::Scalar,
        traits::IsIdentity,
    };
    use sha2::{Digest, Sha512};
    use wasm_bindgen::JsValue;

    use super::{hata, rastgele};

    const DSI: &[u8] = b"CPaceRistretto255";

    /// Uzunluğu başa eklenmiş (LEB128) dizilerin art arda eklenmesi.
    pub fn lv_cat(parcalar: &[&[u8]]) -> Vec<u8> {
        let mut cikti = Vec::new();
        for p in parcalar {
            let mut n = p.len();
            loop {
                let b = (n & 0x7f) as u8;
                n >>= 7;
                if n == 0 {
                    cikti.push(b);
                    break;
                }
                cikti.push(b | 0x80);
            }
            cikti.extend_from_slice(p);
        }
        cikti
    }

    fn sha512(veri: &[u8]) -> [u8; 64] {
        Sha512::digest(veri).into()
    }

    pub struct Yuva {
        y: Scalar,
        pub benim: [u8; 32],
    }

    impl Yuva {
        pub fn yeni(prs: &[u8], ci: &[u8], sid: &[u8]) -> Result<Self, JsValue> {
            // generator_string: SHA-512 blok boyu 128 bayt; DSI ve PRS ilk bloğa sığmazsa dolgu olmaz.
            let dolgu = 128usize.saturating_sub(1 + lv_cat(&[prs]).len() + lv_cat(&[DSI]).len());
            let g = RistrettoPoint::from_uniform_bytes(&sha512(&lv_cat(&[DSI, prs, &vec![0u8; dolgu], ci, sid])));
            let y = Scalar::from_bytes_mod_order_wide(&rastgele::<64>()?);
            Ok(Yuva { y, benim: (g * y).compress().to_bytes() })
        }

        /// Ortak oturum anahtarı (ISK). `teklif_eden` sıralamayı belirler: önce teklif edenin iletisi.
        pub fn isk(&self, karsi: &[u8], sid: &[u8], teklif_eden: bool) -> Result<[u8; 64], JsValue> {
            let karsi: [u8; 32] = karsi.try_into().map_err(|_| hata("Geçersiz nokta"))?;
            let nokta = CompressedRistretto(karsi).decompress().ok_or_else(|| hata("Geçersiz nokta"))?;
            let k = nokta * self.y;
            if k.is_identity() {
                return Err(hata("Geçersiz nokta"));
            }
            let (ya, yb) = if teklif_eden { (&self.benim, &karsi) } else { (&karsi, &self.benim) };
            let isk_dsi = [DSI, b"_ISK"].concat();
            let mut girdi = lv_cat(&[&isk_dsi, sid, k.compress().as_bytes()]);
            girdi.extend(lv_cat(&[ya, b""]));
            girdi.extend(lv_cat(&[yb, b""]));
            Ok(sha512(&girdi))
        }
    }

    /// İki tarafın ayrı etiketi: karşıdan gelen etiketi geri yollamak eşleşme sayılmasın.
    pub fn etiket(isk: &[u8; 64], teklif_eden: bool) -> [u8; 16] {
        let rol: &[u8] = if teklif_eden { b"teklif" } else { b"yanit" };
        let h = sha512(&lv_cat(&[b"tulpar etiket 1", rol, isk]));
        h[..16].try_into().unwrap()
    }
}

/// Dış adres anahtarlarının gizli karşılaştırması. Akış:
/// 1. iki taraf `ileti()` sonucunu değiştirir;
/// 2. her taraf karşının iletisini `etiketler()` ile işler ve çıkan etiketleri gönderir;
/// 3. `eslesenler()` karşıdan gelen etiketlerle hangi yuvaların tuttuğunu söyler.
/// Etiketi doğru çıkan karşı taraf aynı anahtarı biliyordur.
#[wasm_bindgen]
pub struct Karsilastirma {
    teklif_eden: bool,
    sid: [u8; 16],
    yuvalar: Vec<cpace::Yuva>,
    iskler: Vec<[u8; 64]>,
}

#[wasm_bindgen]
impl Karsilastirma {
    /// Karşıya gönderilecek ileti: her yuva için 32 baytlık nokta, onaltılı.
    pub fn ileti(&self) -> String {
        self.yuvalar.iter().map(|y| onaltili(&y.benim)).collect()
    }

    /// Karşının iletisini işler; karşıya gönderilecek etiketleri döner (yuva başına 16 bayt, onaltılı).
    pub fn etiketler(&mut self, karsi: String) -> Result<String, JsValue> {
        let baytlar = onaltilidan(&karsi, 32 * self.yuvalar.len())?;
        let mut iskler = Vec::new();
        for (yuva, nokta) in self.yuvalar.iter().zip(baytlar.chunks(32)) {
            iskler.push(yuva.isk(nokta, &self.sid, self.teklif_eden)?);
        }
        let cikti = iskler.iter().map(|i| onaltili(&cpace::etiket(i, self.teklif_eden))).collect();
        self.iskler = iskler;
        Ok(cikti)
    }

    /// Karşının etiketlerini denetler. Sonuç: tutan yuvaların bit maskesi (1: IPv4, 2: IPv6).
    pub fn eslesenler(&self, karsi: String) -> Result<u8, JsValue> {
        if self.iskler.is_empty() {
            return Err(hata("Önce karşının iletisi işlenmeli"));
        }
        let baytlar = onaltilidan(&karsi, 16 * self.iskler.len())?;
        let mut maske = 0u8;
        for (i, (isk, gelen)) in self.iskler.iter().zip(baytlar.chunks(16)).enumerate() {
            let beklenen = cpace::etiket(isk, !self.teklif_eden);
            // Sabit süreli karşılaştırma.
            if beklenen.iter().zip(gelen).fold(0u8, |f, (a, b)| f | (a ^ b)) == 0 {
                maske |= 1 << i;
            }
        }
        Ok(maske)
    }
}

/// JavaScript sırayla beklediği için akış aynı anda tek bir işte kullanılır;
/// iş süresince `Option` içinden alınır, bitince geri konur.
#[wasm_bindgen]
pub struct Gonderici {
    akis: Rc<RefCell<Option<SendStream>>>,
}

#[wasm_bindgen]
impl Gonderici {
    /// Veriyi yazar; karşı taraf yetişemezse bekler.
    pub fn yaz(&self, veri: Uint8Array) -> Promise {
        let yuva = self.akis.clone();
        let veri = veri.to_vec();
        future_to_promise(async move {
            let mut akis = yuva.borrow_mut().take().ok_or_else(|| hata("Akış meşgul"))?;
            let sonuc = akis.write_all(&veri).await;
            *yuva.borrow_mut() = Some(akis);
            sonuc.map_err(hata)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Akışı kapatır ve karşı taraf her şeyi alana kadar bekler. Karşı taraf akışı durdurduysa
    /// (ör. dosyayı reddetti) hata döner.
    pub fn bitir(&self) -> Promise {
        let yuva = self.akis.clone();
        future_to_promise(async move {
            let mut akis = yuva.borrow_mut().take().ok_or_else(|| hata("Akış meşgul"))?;
            akis.finish().map_err(hata)?;
            match akis.stopped().await.map_err(hata)? {
                None => Ok(JsValue::UNDEFINED),
                Some(_) => Err(hata("Alıcı aktarımı durdurdu")),
            }
        })
    }

    pub fn iptal(&self) {
        if let Some(mut akis) = self.akis.borrow_mut().take() {
            let _ = akis.reset(0u8.into());
        }
    }
}

#[wasm_bindgen]
pub struct Alici {
    akis: Rc<RefCell<Option<RecvStream>>>,
    /// Okuma sürerken akış `akis` yuvasında değildir; iptal o sırada bu sinyalle iletilir.
    iptal: Rc<Notify>,
}

#[wasm_bindgen]
impl Alici {
    /// Hazır olan veriyi (en çok 256 KB) tek seferde okur. Sonuç: `Uint8Array`, akış bittiyse `null`.
    pub fn oku(&self) -> Promise {
        let yuva = self.akis.clone();
        let iptal = self.iptal.clone();
        future_to_promise(async move {
            let mut akis = yuva.borrow_mut().take().ok_or_else(|| hata("Akış kapalı ya da meşgul"))?;
            let mut tampon = vec![0u8; OKUMA_PARCASI];
            let sonuc = tokio::select! {
                s = akis.read(&mut tampon) => Some(s),
                _ = iptal.notified() => None,
            };
            let Some(sonuc) = sonuc else {
                let _ = akis.stop(0u8.into());
                return Err(hata("Aktarım iptal edildi"));
            };
            *yuva.borrow_mut() = Some(akis);
            match sonuc.map_err(hata)? {
                Some(n) => Ok(Uint8Array::from(&tampon[..n]).into()),
                None => Ok(JsValue::NULL),
            }
        })
    }

    /// Akışı durdurur; karşı tarafın gönderimi hata ile biter.
    pub fn iptal(&self) {
        match self.akis.borrow_mut().take() {
            Some(mut akis) => {
                let _ = akis.stop(0u8.into());
            }
            // Okuma sürüyor: okuyan taraf sinyali alıp akışı durdurur.
            None => self.iptal.notify_one(),
        }
    }
}
