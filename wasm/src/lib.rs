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

    /// Bu bağlantının TLS oturum sırlarından türetilen 6 haneli doğrulama kodu. İki uçta aynı
    /// çıkar; araya giren biri iki ayrı oturum kurmak zorunda kalacağından kodlar farklı olur.
    pub fn dogrulama(&self) -> Result<String, JsValue> {
        let mut cikti = [0u8; 8];
        self.conn
            .export_keying_material(&mut cikti, b"tulpar dogrulama 1", b"")
            .map_err(|_| hata("Doğrulama kodu üretilemedi"))?;
        Ok(format!("{:06}", u64::from_be_bytes(cikti) % 1_000_000))
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
