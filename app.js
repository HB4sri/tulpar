// Yayında dosya adresleri sürümle (?v=) istenir; önbellekte eski çekirdek ile yeni sayfa karışmasın.
const SURUM = new URL(import.meta.url).searchParams.get("v") ?? "";
const pkgAdresi = ad => new URL(`./pkg/${ad}?v=${SURUM}`, import.meta.url).href;
const { default: init, Dugum } = await import(pkgAdresi("tulpar_cekirdek.js"));

// Her akış bir çerçeveyle başlar: [4 bayt başlık uzunluğu][JSON başlık], ardından varsa içerik.
// Dosya başlığı: { ad, boyut }. Tanışma başlığı: { tip: "tanitim", ad, sir?, adres? } (içerik yok).
const PARCA = 256 * 1024;
const BASLIK_SINIRI = 16 * 1024;
// Gelen dosya bellekte tutulur; iPhone ve iPad'de tarayıcı sekmesi daha az belleğe izin verir.
const IOS = /iPhone|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const EN_BUYUK_DOSYA = IOS ? 300 * 1024 ** 2 : 1024 ** 3;
const BASLAMA_SURESI = 30000;
const BAGLANMA_SURESI = 30000;
const YENIDEN_SURESI = 10000;
const YENIDEN_EN_UZUN_ARA = 30000;
const YENIDEN_TOPLAM_SURE = 15 * 60000;
const TANITIM_SURESI = 10000;
const ONAY_SURESI = 120000;
const KOD_SURESI = 5 * 60000;
const QR_SURESI = 3 * 60000;
const ENGEL_SURESI = 60000;
const EN_COK_BEKLEYEN = 4;

// Kapanma nedenleri. Karşı taraf yalnız DURDURAN_NEDENLER'de kendiliğinden yeniden bağlanmayı bırakır.
const KESILDI = "kesildi";       // kullanıcı bilerek kesti
const DEGISTI = "degisti";       // yerine başka bir cihaz kabul edildi
const REDDEDILDI = "reddedildi"; // bağlantı isteği reddedildi
const MESGUL = "mesgul";         // başka bir istek yanıt bekliyor
const KAPANDI = "kapandi";       // sayfa kapandı ya da yenilendi, tanışma olmadı
const YENILENDI = "yenilendi";   // aynı cihaz yeni bir bağlantıyla geldi, eskisi kapandı
const GECIS = "gecis";           // kodla eşleşme kabul edildi, asıl adrese geçiliyor
const DURDURAN_NEDENLER = [KESILDI, DEGISTI, REDDEDILDI];

const $ = id => document.getElementById(id);
const durum = $("durum");

let dugum = null;
let kodDugumu = null;
let kodZamani = null;
// Canlı geri sayımların bitiş anları (ms); ekrandaki süreler saniyede bir bunlardan yazılır.
let qrBitis = 0;
let kodBitis = 0;
let onayBitis = 0;
let kodKullanildi = false;
let mevcut = null; // { baglanti, ad, karsiKimlik, yeniden, dugum }
let bilerekKesildi = false;
let bekleyenOnay = null;
let bekleyenBaglanti = 0;
const engellenenler = new Map(); // kimlik -> engelin bittiği zaman
const kaydedilmemis = new Set(); // alınmış ama henüz kaydedilmemiş dosyaların bağlantıları
let gonderimKuyrugu = Promise.resolve();

// --- Sekme hafızası ---

// sessionStorage yalnız bu sekmeye aittir ve sekme kapanınca silinir. Sayfa yenilense de kimlik,
// QR'daki tek kullanımlık değer, bağlanılan adres, son bağlanan cihaz ve "onay gerekli" bilgisi
// korunur. Eşleşme kodu hiçbir yere yazılmaz. Gizli modda erişilemeyebilir.
const ANAHTAR_HAFIZASI = "tulpar-anahtar";
const SIR_HAFIZASI = "tulpar-sir";
const BILET_HAFIZASI = "tulpar-bilet";
const KARSI_HAFIZASI = "tulpar-karsi";
const ONAY_HAFIZASI = "tulpar-onay";

function hafizaOku(ad) {
  try { return sessionStorage.getItem(ad); } catch { return null; }
}

function hafizaYaz(ad, deger) {
  try { sessionStorage.setItem(ad, deger); } catch {}
}

function hafizaSil(...adlar) {
  try { for (const ad of adlar) sessionStorage.removeItem(ad); } catch {}
}

const onaltilik = baytlar => [...baytlar].map(b => b.toString(16).padStart(2, "0")).join("");

function base64url(baytlar) {
  return btoa(String.fromCharCode(...baytlar)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Bu sekmenin 32 baytlık gizli anahtarı. Tarayıcının güvenli rastgele sayı üretecinden gelir.
function sekmeAnahtari() {
  const kayitli = hafizaOku(ANAHTAR_HAFIZASI);
  if (kayitli && /^[0-9a-f]{64}$/.test(kayitli)) {
    return Uint8Array.from(kayitli.match(/../g), h => parseInt(h, 16));
  }
  const yeni = crypto.getRandomValues(new Uint8Array(32));
  hafizaYaz(ANAHTAR_HAFIZASI, onaltilik(yeni));
  return yeni;
}

// QR'daki tek kullanımlık 128 bitlik değer. QR'ı okutan cihaz bunu tanışma mesajında gönderir;
// tutarsa ekranda onay sorulur, tutmazsa (ve cihaz tanıdık değilse) istek sorusuz reddedilir.
// Kullanılınca ve QR_SURESI'nde bir yenilenir.
function qrSirri() {
  let sir = hafizaOku(SIR_HAFIZASI);
  if (!sir || !/^[A-Za-z0-9_-]{22}$/.test(sir)) {
    sir = base64url(crypto.getRandomValues(new Uint8Array(16)));
    hafizaYaz(SIR_HAFIZASI, sir);
  }
  return sir;
}

function qrYenile() {
  hafizaSil(SIR_HAFIZASI);
  if (dugum) qrGoster();
}

// Bağlantı bilerek kesildiyse (hangi taraf keserse kessin) bir sonraki istek onay ister.
function onayGerekliMi() {
  return hafizaOku(ONAY_HAFIZASI) === "1";
}

function onayGerekliYap(deger) {
  if (deger) hafizaYaz(ONAY_HAFIZASI, "1");
  else hafizaSil(ONAY_HAFIZASI);
}

// --- Cihaz adı ---

// Ad bu cihazda kalıcıdır (localStorage); karşı tarafa tanışma mesajıyla gider.
// Varsayılan ad cihaz hakkında bilgi vermez: rastgele bir sıfat ve hayvan adıdır.
const AD_HAFIZASI = "tulpar-cihaz-adi";
const SIFATLAR = [
  "Mavi", "Kızıl", "Ak", "Kara", "Boz", "Yeşil", "Altın", "Gümüş", "Hızlı", "Sessiz",
  "Çevik", "Bilge", "Cesur", "Yağız", "Al", "Demir", "Gök", "Yaman", "Uslu", "Neşeli",
];
const HAYVANLAR = [
  "Kartal", "Şahin", "Doğan", "Turna", "Kurt", "Geyik", "Pars", "Kaplan", "Tilki", "Sungur",
  "Kuğu", "Yunus", "Atmaca", "Ceylan", "Kunduz", "Baykuş", "Serçe", "Martı", "Sincap", "Kaplumbağa",
];

function rastgeleAd() {
  const [a, b] = crypto.getRandomValues(new Uint32Array(2));
  return `${SIFATLAR[a % SIFATLAR.length]} ${HAYVANLAR[b % HAYVANLAR.length]}`;
}

function adKaydet(ad) {
  try { localStorage.setItem(AD_HAFIZASI, ad); } catch {}
}

// Karşıdan gelen ad güvenilmez veridir: yalnız textContent ile gösterilir, denetim ve yön
// karakterleri atılır, kısaltılır.
function adDuzelt(ad) {
  return String(ad ?? "")
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ").trim().slice(0, 40) || "Adsız cihaz";
}

// İlk açılışta rastgele bir ad üretilip saklanır; sonra hep aynı ad kullanılır.
let oturumAdi = null;
function cihazAdi() {
  let ad = null;
  try { ad = localStorage.getItem(AD_HAFIZASI); } catch {}
  if (!ad) {
    // localStorage kullanılamıyorsa ad en azından bu sayfa açık kaldıkça aynı kalsın.
    ad = oturumAdi ??= rastgeleAd();
    adKaydet(ad);
  }
  return adDuzelt(ad);
}

function adiGoster() {
  $("cihaz-adi").textContent = cihazAdi();
}

// --- Yardımcılar ---

// Kalan süre sayaç biçiminde: 2:05.
function sureYaz(ms) {
  const sn = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(sn / 60)}:${String(sn % 60).padStart(2, "0")}`;
}

// QR'ın yenilenmesine, kodun ve onay sorusunun süresine kalan zamanı ekrana yazar. QR'ın süresi
// dolunca yenilenir; ekranda onay sorusu varken yenileme soru kapanana kadar bekler.
function surelerGuncelle() {
  const simdi = Date.now();
  if (qrBitis && simdi >= qrBitis && !bekleyenOnay) {
    qrYenile();
    return;
  }
  if (qrBitis) $("qr-sure").textContent = `Yenilenmesine kalan süre: ${sureYaz(qrBitis - simdi)}`;
  if (kodBitis) $("kod-sure").textContent = `Kalan süre: ${sureYaz(kodBitis - simdi)}`;
  if (onayBitis) $("onay-sure").textContent = `Yanıt için kalan süre: ${sureYaz(onayBitis - simdi)}`;
}

const bekle = ms => new Promise(coz => setTimeout(coz, ms));

// Aktarım sonuçlarını ekran okuyucuya bildirir (görünmeyen canlı bölge).
function duyur(metin) {
  $("duyuru").textContent = metin;
}

function durumYaz(metin, tur = "") {
  durum.textContent = metin;
  durum.className = tur;
}

function zamanAsimi(soz, ms) {
  let zaman;
  return Promise.race([
    soz,
    new Promise((_, ret) => { zaman = setTimeout(() => ret(new Error("Zaman aşımı")), ms); }),
  ]).finally(() => clearTimeout(zaman));
}

function boyutYaz(bayt) {
  const birimler = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (bayt >= 1024 && i < birimler.length - 1) { bayt /= 1024; i++; }
  // Sayı ile birim arasında bölünmeyen boşluk: satır sonunda "12,5" ile "MB" ayrılmasın.
  return bayt.toLocaleString("tr-TR", { maximumFractionDigits: i ? 1 : 0 }) + "\u00a0" + birimler[i];
}

function gruplara(metin, uzunluk) {
  return metin.match(new RegExp(`.{1,${uzunluk}}`, "g")).join(" ");
}

function birlestir(a, b) {
  const c = new Uint8Array(a.length + b.length);
  c.set(a);
  c.set(b, a.length);
  return c;
}

function cerceve(baslik) {
  const json = new TextEncoder().encode(JSON.stringify(baslik));
  const on = new Uint8Array(4 + json.length);
  new DataView(on.buffer).setUint32(0, json.length);
  on.set(json, 4);
  return on;
}

// Akışın başındaki başlığı okur; başlıktan sonra gelmiş içerik `ilk` olarak döner.
async function basligiOku(alici) {
  let tampon = new Uint8Array(0);
  let uzunluk = null;
  while (uzunluk === null || tampon.length < 4 + uzunluk) {
    const parca = await alici.oku();
    if (!parca) throw new Error("Başlık eksik");
    tampon = birlestir(tampon, parca);
    if (uzunluk === null && tampon.length >= 4) {
      uzunluk = new DataView(tampon.buffer).getUint32(0);
      if (uzunluk > BASLIK_SINIRI) throw new Error("Başlık çok büyük");
    }
  }
  const baslik = JSON.parse(new TextDecoder().decode(tampon.subarray(4, 4 + uzunluk)));
  if (typeof baslik !== "object" || baslik === null) throw new Error("Geçersiz başlık");
  return { baslik, ilk: tampon.slice(4 + uzunluk) };
}

// Karşıdan gelen dosya adı: denetim ve yön karakterleri (ör. uzantıyı gizleyen U+202E) atılır,
// yol ve sistem için sorunlu karakterler "_" olur, uzunluk sınırlanır.
function dosyaAdiDuzelt(ad) {
  let temiz = String(ad ?? "")
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  if (temiz.length > 150) {
    const nokta = temiz.lastIndexOf(".");
    const uzanti = nokta > 0 && temiz.length - nokta <= 10 ? temiz.slice(nokta) : "";
    temiz = temiz.slice(0, 150 - uzanti.length) + uzanti;
  }
  return temiz || "dosya";
}

// --- Ekranın kilitlenmesini önleme ---

// Aktarım sürerken telefonun ekranı kapanıp sayfa uyumasın. Desteklenmiyorsa sessizce geçer.
let surenAktarim = 0;
let ekranKilidi = null;

async function ekranKilidiAl() {
  if (!surenAktarim || ekranKilidi || document.hidden) return;
  try {
    ekranKilidi = await navigator.wakeLock.request("screen");
    ekranKilidi.addEventListener("release", () => { ekranKilidi = null; });
  } catch {}
}

function aktarimBasladi() {
  surenAktarim++;
  ekranKilidiAl();
}

function aktarimBitti() {
  surenAktarim = Math.max(0, surenAktarim - 1);
  if (!surenAktarim && ekranKilidi) {
    ekranKilidi.release().catch(() => {});
    ekranKilidi = null;
  }
}

// --- Aktarım listesi ---

const svg = yol => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${yol}</svg>`;
const SIMGE_GIDEN = svg('<path d="M12 19V5M6 11l6-6 6 6"/>');
const SIMGE_GELEN = svg('<path d="M12 5v14M6 13l6 6 6-6"/>');
const SIMGE_SIL = svg('<path d="M6 6l12 12M18 6L6 18"/>');

// Satır karşı cihazın kimliğiyle işaretlenir; o cihaz adını değiştirince satırdaki ad da güncellenir.
function satirEkle(yon, ad, boyut, oturum) {
  const li = document.createElement("li");
  li.innerHTML = `
    <span class="yon">${yon === "giden" ? SIMGE_GIDEN : SIMGE_GELEN}</span>
    <div class="ust-satir"><span class="ad"></span><span class="boyut"></span>
      <button class="sil" title="Listeden kaldır" aria-label="Listeden kaldır">${SIMGE_SIL}</button></div>
    <div class="kim"></div>
    <div class="cubuk"><span></span></div>
    <div class="bilgi"><span class="metin"></span><span class="ek"></span></div>`;
  li.querySelector(".ad").textContent = ad;
  li.querySelector(".boyut").textContent = boyutYaz(boyut);
  const kim = li.querySelector(".kim");
  kim.dataset.onek = yon === "giden" ? "Kime: " : "Kimden: ";
  kim.dataset.kimlik = oturum.karsiKimlik;
  kim.textContent = kim.dataset.onek + oturum.ad;
  $("aktarimlar").prepend(li);
  $("temizle").hidden = false;

  const cubuk = li.querySelector(".cubuk span");
  const metin = li.querySelector(".metin");
  const ek = li.querySelector(".ek");
  const t0 = performance.now();
  let sonCizim = 0;

  return {
    // Ekran saniyede en çok beş kez güncellenir.
    ilerle(bayt, zorla = false) {
      const simdi = performance.now();
      if (!zorla && simdi - sonCizim < 200) return;
      sonCizim = simdi;
      const oran = boyut ? Math.min(1, bayt / boyut) : 1;
      cubuk.style.transform = `scaleX(${oran.toFixed(3)})`;
      const sn = (simdi - t0) / 1000;
      metin.textContent = "%" + Math.floor(oran * 100);
      ek.textContent = sn > 0.5 ? boyutYaz(bayt / sn) + "/sn" : "";
    },
    yaz(m) { metin.textContent = m; },
    tamam(m, ekOge) {
      li.className = "tamam";
      duyur(`${m}. Dosya: ${ad}`);
      cubuk.style.transform = "scaleX(1)";
      metin.textContent = m;
      ek.replaceChildren(...(ekOge ? [ekOge] : []));
    },
    hata(m) {
      li.className = "hata";
      duyur(`${m}. Dosya: ${ad}`);
      metin.textContent = m;
      ek.textContent = "";
    },
  };
}

// --- Gönderme ---

async function dosyaGonder(dosya) {
  // Kuyruğa eklendiği andaki değil, gönderim anındaki bağlantı kullanılır.
  const oturum = mevcut;
  if (!oturum) {
    satirEkle("giden", dosya.name, dosya.size, { ad: "—", karsiKimlik: "" }).hata("Gönderilemedi: Bağlantı yok");
    return;
  }
  const satir = satirEkle("giden", dosya.name, dosya.size, oturum);
  satir.yaz("Hazırlanıyor…");
  aktarimBasladi();
  try {
    if (oturum.dogrudan) {
      try {
        await dogrudanGonder(oturum.dogrudan, dosya, satir);
        satir.tamam("Gönderildi");
        return;
      } catch (e) {
        console.error(e);
        if (e.reddedildi || mevcut !== oturum) throw e;
        // Doğrudan yol koptu: bu oturumda bir daha denenmez, dosya aktarma sunucusundan gider.
        dogrudanKapat(oturum, oturum.pc);
        satir.yaz("Aktarma sunucusundan yeniden gönderiliyor…");
      }
    }
    await irohGonder(oturum, dosya, satir);
    satir.tamam("Gönderildi");
  } catch (e) {
    console.error(e);
    satir.hata("Gönderilemedi");
  } finally {
    aktarimBitti();
  }
}

async function irohGonder(oturum, dosya, satir) {
  const gonderici = await oturum.baglanti.akis_ac();
  await gonderici.yaz(cerceve({ ad: dosya.name, boyut: dosya.size }));

  let gonderilen = 0;
  satir.ilerle(0, true);
  // Bir parça gönderilirken sıradaki diskten okunur.
  let sonraki = dosya.slice(0, PARCA).arrayBuffer();
  while (gonderilen < dosya.size) {
    const parca = new Uint8Array(await sonraki);
    const bas = gonderilen + parca.length;
    if (bas < dosya.size) sonraki = dosya.slice(bas, bas + PARCA).arrayBuffer();
    await gonderici.yaz(parca);
    gonderilen = bas;
    satir.ilerle(gonderilen);
  }
  satir.ilerle(gonderilen, true);
  satir.yaz("Diğer cihazın alması bekleniyor…");
  await gonderici.bitir();
}

function dosyalariSirala(dosyalar) {
  if (!mevcut) return;
  for (const dosya of dosyalar) {
    gonderimKuyrugu = gonderimKuyrugu.then(() => dosyaGonder(dosya));
  }
}

async function tanitimGonder(baglanti, ek = {}) {
  const gonderici = await baglanti.akis_ac();
  await gonderici.yaz(cerceve({ tip: "tanitim", ad: cihazAdi(), dogrudan: DOGRUDAN_DESTEK ? 1 : 0, ...ek }));
  gonderici.bitir().catch(() => {});
}

// --- Alma ---

async function dosyaAl(alici, baslik, ilk, oturum) {
  const ad = dosyaAdiDuzelt(baslik.ad);
  const boyut = baslik.boyut;
  if (!Number.isSafeInteger(boyut) || boyut < 0 || boyut > EN_BUYUK_DOSYA) {
    alici.iptal();
    satirEkle("gelen", ad, 0, oturum).hata(`Alınmadı: Dosya ${boyutYaz(EN_BUYUK_DOSYA)} sınırını aşıyor`);
    return;
  }
  const satir = satirEkle("gelen", ad, boyut, oturum);
  aktarimBasladi();
  try {
    const parcalar = [ilk];
    let alinan = ilk.length;
    satir.ilerle(alinan, true);
    for (;;) {
      if (alinan > boyut) {
        alici.iptal();
        throw new Error("Dosya beklenenden büyük geldi");
      }
      const parca = await alici.oku();
      if (!parca) break;
      parcalar.push(parca);
      alinan += parca.length;
      satir.ilerle(alinan);
    }
    if (alinan !== boyut) throw new Error("Dosya eksik geldi");
    dosyaHazir(parcalar, ad, satir);
  } catch (e) {
    console.error(e);
    satir.hata("Aktarım yarıda kesildi");
  } finally {
    aktarimBitti();
  }
}

// Alınan parçalardan dosyayı oluşturur ve satıra Kaydet bağlantısını koyar.
function dosyaHazir(parcalar, ad, satir) {
  // Tür her zaman ikili dosya: karşının verdiği tür (ör. text/html) sayfada açılıp çalışmasın.
  const blob = new Blob(parcalar, { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = ad;
  a.textContent = "Kaydet";
  a.className = "kaydet";
  // Dosya kendiliğinden inmez; kullanıcı Kaydet'e basar. Kaydedildikten bir dakika sonra
  // bellekteki kopya bırakılır.
  kaydedilmemis.add(a);
  a.addEventListener("click", () => {
    kaydedilmemis.delete(a);
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.replaceWith("Kaydedildi");
    }, 60000);
  }, { once: true });
  satir.tamam("Alındı", a);
}

async function almaDongusu(oturum) {
  for (;;) {
    const alici = await oturum.baglanti.akis_bekle();
    if (!alici) return;
    zamanAsimi(basligiOku(alici), TANITIM_SURESI).then(({ baslik, ilk }) => {
      if (baslik.tip === "rtc") {
        rtcMesaji(oturum, baslik);
      } else if (baslik.tip === "tanitim") {
        // Karşı taraf adını değiştirdi.
        oturum.ad = adDuzelt(baslik.ad);
        adlariGuncelle(oturum);
        if (mevcut === oturum) bagliYaz(oturum);
      } else {
        dosyaAl(alici, baslik, ilk, oturum);
      }
    }).catch(e => {
      console.error(e);
      alici.iptal();
    });
  }
}

// --- Doğrudan bağlantı (WebRTC, yalnız aynı ağ) ---

// Aktarma sunucusu üzerinden kurulmuş, kimliği doğrulanmış bağlantı sinyal kanalı olarak kullanılır:
// iki taraf WebRTC tekliflerini (SDP) bu kanaldan değiştirir. SDP'deki DTLS parmak izi bu kanaldan
// geldiği için doğrudan bağlantının arasına kimse giremez. TURN sunucusu verilmez; dosyalar hiçbir
// sunucudan geçmez. Kurulamazsa aktarma sunucusu kullanılmaya devam eder. Teklifi bağlanan taraf
// yapar, kabul eden yanıtlar.
//
// Tarayıcılar yerel adresi "xxx.local" takma adıyla gizler ve karşı cihaz bu adı çoğu ağda çözemez.
// Bu yüzden Cloudflare'in STUN sunucusundan (site zaten Cloudflare'de) cihazın dış adresi öğrenilir;
// aynı evdeki iki cihaz bu adres üzerinden modem aracılığıyla buluşur. Dış adres karşı tarafa yalnız
// iki cihaz aynı ağdaysa, yani karşı taraf o adresi zaten biliyorsa verilir:
//  1. Teklif dış adres olmadan gider; yanında adres anahtarlarının 16 bitlik özeti bulunur.
//  2. Yanıtlayan taraf, özeti tutan kendi dış adresini yanıta ekler. Kısa özet adresi ele vermez:
//     aynı özete on binlerce adres düşer.
//  3. Teklif eden taraf, gelen adresin anahtarı kendisininkiyle birebir aynıysa kendi dış adresini
//     gönderir. Her iki taraf da yalnız kendi anahtarıyla birebir eşleşen adresleri kullanır.
const DOGRUDAN_DESTEK = typeof RTCPeerConnection === "function";
const STUN = [{ urls: "stun:stun.cloudflare.com:3478" }];
const DOGRUDAN_SURESI = 15000;          // bu sürede kurulamazsa denemekten vazgeçilir
const DOGRUDAN_PARCA = 64 * 1024;       // bütün tarayıcıların kabul ettiği ileti boyutu
const DOGRUDAN_TAMPON = 8 * 1024 ** 2;  // gönderim tamponu bunu aşınca boşalması beklenir (Chrome 16 MB üstünü kabul etmez)

function yolYaz(oturum) {
  if (mevcut !== oturum) return;
  $("yol").textContent = oturum.dogrudan ? "Aktarım yolu: Doğrudan (aynı ağ)" : "Aktarım yolu: Aktarma sunucusu";
  $("yol").hidden = false;
}

function adaylarHazir(pc, ms = 3000) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise(coz => {
    const zaman = setTimeout(coz, ms);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(zaman);
        coz();
      }
    });
  });
}

// "candidate:VAKIF BİLEŞEN İLETİM ÖNCELİK ADRES KAPI typ TÜR ..." satırından adres ve tür.
function adayCoz(satir) {
  const p = satir.replace(/^a=/, "").split(" ");
  return { adres: p[4] || "", tur: p[7] || "" };
}

// Aynı ağın anahtarı: IPv4'te dış adresin kendisi, IPv6'da adresin ilk 64 biti (ağ öneki).
function agAnahtari(adres) {
  if (!adres.includes(":")) return adres;
  const [bas, son] = adres.split("::");
  const a = bas ? bas.split(":") : [];
  const b = son ? son.split(":") : [];
  const tam = son === undefined ? a : [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b];
  return tam.slice(0, 4).map(x => parseInt(x, 16).toString(16)).join(":");
}

const anahtarlar = pc => [...new Set(pc.dis.map(a => agAnahtari(adayCoz(a.candidate).adres)))];

async function anahtarOzeti(tuz, anahtar) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${tuz} ${anahtar}`)));
  return h[0] * 256 + h[1];
}

// SDP'den dış adres (srflx) satırları çıkarılır; bunlar ayrıca ve yalnız aynı ağda paylaşılır.
const disSiz = sdp => sdp.split("\r\n").filter(l => !(l.startsWith("a=candidate:") && adayCoz(l).tur === "srflx")).join("\r\n");

const adayPaketi = a => ({ candidate: a.candidate, sdpMid: a.sdpMid, sdpMLineIndex: a.sdpMLineIndex });

// Karşıdan gelen dış adreslerden yalnız anahtarı bizimkiyle birebir aynı olanlar alınır.
function adaylarSec(liste, benim) {
  if (!Array.isArray(liste)) return [];
  return liste.slice(0, 8).filter(a =>
    a && typeof a.candidate === "string" && a.candidate.startsWith("candidate:") && a.candidate.length < 512 &&
    adayCoz(a.candidate).tur === "srflx" && benim.includes(agAnahtari(adayCoz(a.candidate).adres))
  ).map(a => ({
    candidate: a.candidate,
    sdpMid: typeof a.sdpMid === "string" ? a.sdpMid : null,
    sdpMLineIndex: Number.isInteger(a.sdpMLineIndex) ? a.sdpMLineIndex : null,
  }));
}

async function rtcGonder(oturum, mesaj) {
  const gonderici = await oturum.baglanti.akis_ac();
  await gonderici.yaz(cerceve({ tip: "rtc", ...mesaj }));
  gonderici.bitir().catch(() => {});
}

function dogrudanKapat(oturum, pc) {
  if (oturum.pc !== pc) return;
  oturum.dogrudan = null;
  pc.close();
  yolYaz(oturum);
}

function rtcOlustur(oturum) {
  const pc = new RTCPeerConnection({ iceServers: STUN });
  oturum.pc = pc;
  pc.dis = [];
  pc.onicecandidate = e => {
    if (e.candidate && adayCoz(e.candidate.candidate).tur === "srflx") pc.dis.push(e.candidate);
  };
  // İki tarafta aynı kimlikle (0) açılan denetim kanalı; açıldığında doğrudan yol hazırdır.
  const denetim = pc.createDataChannel("denetim", { negotiated: true, id: 0 });
  denetim.onopen = () => {
    if (oturum.pc !== pc) return;
    oturum.dogrudan = pc;
    yolYaz(oturum);
  };
  denetim.onclose = () => dogrudanKapat(oturum, pc);
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") dogrudanKapat(oturum, pc);
  };
  pc.ondatachannel = e => {
    if (e.channel.label === "dosya") dogrudanAl(e.channel, oturum);
    else e.channel.close();
  };
  oturum.baglanti.kapanis().then(() => dogrudanKapat(oturum, pc));
  setTimeout(() => { if (!oturum.dogrudan) dogrudanKapat(oturum, pc); }, DOGRUDAN_SURESI);
  return pc;
}

async function dogrudanBaslat(oturum) {
  if (!DOGRUDAN_DESTEK || !oturum.karsiDogrudan || oturum.rol !== "teklif") return;
  try {
    const pc = rtcOlustur(oturum);
    await pc.setLocalDescription(await pc.createOffer());
    await adaylarHazir(pc);
    const tuz = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");
    const ag = await Promise.all(anahtarlar(pc).map(a => anahtarOzeti(tuz, a)));
    await rtcGonder(oturum, { tur: "teklif", sdp: disSiz(pc.localDescription.sdp), tuz, ag });
  } catch (e) {
    console.error(e);
  }
}

async function rtcMesaji(oturum, baslik) {
  if (!DOGRUDAN_DESTEK) return;
  try {
    const pc = oturum.pc;
    if (baslik.tur === "teklif" && typeof baslik.sdp === "string" && oturum.rol === "yanit" && !pc) {
      const pc = rtcOlustur(oturum);
      await pc.setRemoteDescription({ type: "offer", sdp: disSiz(baslik.sdp) });
      await pc.setLocalDescription(await pc.createAnswer());
      await adaylarHazir(pc);
      const ozetler = Array.isArray(baslik.ag) ? baslik.ag.slice(0, 8) : [];
      const ortak = [];
      if (typeof baslik.tuz === "string" && baslik.tuz.length <= 64) {
        for (const a of pc.dis) {
          if (ozetler.includes(await anahtarOzeti(baslik.tuz, agAnahtari(adayCoz(a.candidate).adres)))) ortak.push(adayPaketi(a));
        }
      }
      await rtcGonder(oturum, { tur: "yanit", sdp: disSiz(pc.localDescription.sdp), adaylar: ortak });
    } else if (baslik.tur === "yanit" && typeof baslik.sdp === "string" && oturum.rol === "teklif" && pc?.signalingState === "have-local-offer") {
      await pc.setRemoteDescription({ type: "answer", sdp: disSiz(baslik.sdp) });
      const gelen = adaylarSec(baslik.adaylar, anahtarlar(pc));
      for (const a of gelen) await pc.addIceCandidate(a);
      if (gelen.length) {
        const uyan = gelen.map(a => agAnahtari(adayCoz(a.candidate).adres));
        const benim = pc.dis.filter(a => uyan.includes(agAnahtari(adayCoz(a.candidate).adres)));
        await rtcGonder(oturum, { tur: "aday", adaylar: benim.map(adayPaketi) });
      }
    } else if (baslik.tur === "aday" && oturum.rol === "yanit" && pc?.signalingState === "stable") {
      for (const a of adaylarSec(baslik.adaylar, anahtarlar(pc))) await pc.addIceCandidate(a);
    }
  } catch (e) {
    console.error(e);
  }
}

function kanalAcilsin(kanal, ms) {
  return new Promise((coz, ret) => {
    if (kanal.readyState === "open") return coz();
    const zaman = setTimeout(() => ret(new Error("Doğrudan kanal açılmadı")), ms);
    kanal.onopen = () => { clearTimeout(zaman); coz(); };
    kanal.onclose = () => { clearTimeout(zaman); ret(new Error("Doğrudan kanal kapandı")); };
  });
}

function tamponBosalsin(kanal) {
  return new Promise(coz => {
    const bitti = () => {
      kanal.removeEventListener("bufferedamountlow", bitti);
      kanal.removeEventListener("close", bitti);
      coz();
    };
    kanal.addEventListener("bufferedamountlow", bitti);
    kanal.addEventListener("close", bitti);
  });
}

// Dosyayı doğrudan kanaldan gönderir: önce başlık (JSON), sonra parçalar; alıcı bütün dosyayı
// aldığında "tamam", sınırı aşan dosyayı reddettiğinde "buyuk" yanıtı verir.
async function dogrudanGonder(pc, dosya, satir) {
  const kanal = pc.createDataChannel("dosya", { ordered: true });
  kanal.binaryType = "arraybuffer";
  kanal.bufferedAmountLowThreshold = DOGRUDAN_TAMPON / 2;
  try {
    await kanalAcilsin(kanal, 10000);
    let kapandi = false;
    const yanit = new Promise((coz, ret) => {
      kanal.onmessage = e => {
        if (e.data === "tamam") coz();
        else if (e.data === "buyuk") ret(Object.assign(new Error("Diğer cihaz dosyayı almadı"), { reddedildi: true }));
      };
      kanal.onclose = () => {
        kapandi = true;
        ret(new Error("Doğrudan kanal kapandı"));
      };
    });
    yanit.catch(() => {});
    kanal.send(JSON.stringify({ ad: dosya.name, boyut: dosya.size }));
    let gonderilen = 0;
    satir.ilerle(0, true);
    let sonraki = dosya.slice(0, PARCA).arrayBuffer();
    while (gonderilen < dosya.size) {
      const buyuk = new Uint8Array(await sonraki);
      const bas = gonderilen + buyuk.length;
      if (bas < dosya.size) sonraki = dosya.slice(bas, bas + PARCA).arrayBuffer();
      for (let i = 0; i < buyuk.length; i += DOGRUDAN_PARCA) {
        if (kapandi) await yanit;
        if (kanal.bufferedAmount > DOGRUDAN_TAMPON) await tamponBosalsin(kanal);
        if (kapandi) await yanit;
        kanal.send(buyuk.subarray(i, i + DOGRUDAN_PARCA));
      }
      gonderilen = bas;
      satir.ilerle(gonderilen);
    }
    satir.ilerle(gonderilen, true);
    satir.yaz("Diğer cihazın alması bekleniyor…");
    await zamanAsimi(yanit, 60000);
  } finally {
    kanal.onclose = null;
    kanal.close();
  }
}

// Doğrudan kanaldan gelen dosya. Denetimler aktarma sunucusundan gelen dosyayla aynıdır.
function dogrudanAl(kanal, oturum) {
  kanal.binaryType = "arraybuffer";
  let satir = null;
  let ad = "";
  let boyut = 0;
  let alinan = 0;
  let bitti = false;
  const parcalar = [];
  const yarida = () => {
    if (bitti) return;
    bitti = true;
    if (satir) {
      satir.hata("Aktarım yarıda kesildi");
      aktarimBitti();
    }
    kanal.close();
  };
  kanal.onmessage = e => {
    if (bitti) return;
    try {
      if (!satir) {
        if (typeof e.data !== "string" || e.data.length > BASLIK_SINIRI) throw new Error("Geçersiz başlık");
        const baslik = JSON.parse(e.data);
        if (typeof baslik !== "object" || baslik === null) throw new Error("Geçersiz başlık");
        ad = dosyaAdiDuzelt(baslik.ad);
        boyut = baslik.boyut;
        if (!Number.isSafeInteger(boyut) || boyut < 0 || boyut > EN_BUYUK_DOSYA) {
          bitti = true;
          kanal.send("buyuk");
          satirEkle("gelen", ad, 0, oturum).hata(`Alınmadı: Dosya ${boyutYaz(EN_BUYUK_DOSYA)} sınırını aşıyor`);
          return;
        }
        satir = satirEkle("gelen", ad, boyut, oturum);
        aktarimBasladi();
        satir.ilerle(0, true);
      } else {
        if (typeof e.data === "string") throw new Error("Beklenmeyen ileti");
        const parca = new Uint8Array(e.data);
        alinan += parca.length;
        if (alinan > boyut) throw new Error("Dosya beklenenden büyük geldi");
        parcalar.push(parca);
        satir.ilerle(alinan);
      }
      if (alinan === boyut) {
        bitti = true;
        satir.ilerle(alinan, true);
        kanal.send("tamam");
        dosyaHazir(parcalar, ad, satir);
        aktarimBitti();
      }
    } catch (err) {
      console.error(err);
      yarida();
    }
  };
  kanal.onclose = yarida;
}

// --- Kodlar ---

// Karıştırılabilecek 0, 1, I, L ve O harfleri yok. 8 karakter yaklaşık 40 bit.
const KOD_HARFLERI = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const KOD_UZUNLUGU = 8;

function kodUret() {
  // Mod yanlılığı olmasın diye 248'den (31 × 8) büyük baytlar atılır.
  let kod = "";
  while (kod.length < KOD_UZUNLUGU) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 248 && kod.length < KOD_UZUNLUGU) kod += KOD_HARFLERI[b % 31];
    }
  }
  return kod;
}

function kodDuzelt(kod) {
  return kod.toUpperCase().replace(/[\s-]/g, "");
}

// Eşleşme kodundan iki tarafın da aynı anahtarı türetmesi için. PBKDF2 (200 bin tur) deneme
// yanılmayı yavaşlatır: kodu, açık anahtarından geriye doğru bulmak çok pahalı olur.
async function kodTohumu(kod) {
  const malzeme = await crypto.subtle.importKey("raw", new TextEncoder().encode(kod), "PBKDF2", false, ["deriveBits"]);
  const bitler = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode("tulpar/kod/2"), iterations: 200000 },
    malzeme, 256);
  return new Uint8Array(bitler);
}

// Bağlantının TLS oturumundan türetilir; araya biri girerse iki ekrandaki kod farklı olur.
function dogrulamaKodu(baglanti) {
  return gruplara(baglanti.dogrulama(), 3);
}

// --- Bağlantı ---

function adlariGuncelle(oturum) {
  for (const kim of document.querySelectorAll("#aktarimlar .kim")) {
    if (kim.dataset.kimlik === oturum.karsiKimlik) kim.textContent = kim.dataset.onek + oturum.ad;
  }
}

function bagliYaz(oturum) {
  durumYaz(`Bağlandı: ${oturum.ad}. Dosyaları iki yönde de gönderebilirsiniz.`, "tamam");
}

// Bağlantı yokken gösterilen bölümler: QR ve kod alanı (yeni bir eşleşme için) ve verilmişse
// "Yeniden bağlan".
function bagliDegilGoster(bilet) {
  $("dogrulama").hidden = true;
  $("paylasim").hidden = true;
  $("kes").hidden = true;
  $("baglan").hidden = false;
  if (bilet) {
    $("yeniden-dugme").onclick = () => bilettenBaglan(bilet, "Bağlanılamadı. Diğer cihazdaki sayfa açık mı?");
    $("yeniden").hidden = false;
  }
}

// Tanışma ve (gerekirse) onay tamamlanmış bir bağlantıyı etkin bağlantı yapar.
function baglandi(oturum) {
  // Eski bağlantı kapanır. Aynı cihazın yeni bağlantısıysa karşı taraf bunu kopma saymaz;
  // başka bir cihaz kabul edildiyse eski cihaz geri bağlanmaya çalışmaz.
  if (mevcut) mevcut.baglanti.kapat(mevcut.karsiKimlik === oturum.karsiKimlik ? YENILENDI : DEGISTI);
  mevcut = oturum;
  bilerekKesildi = false;
  hafizaYaz(KARSI_HAFIZASI, oturum.karsiKimlik);
  // Yalnız bağlanan taraf kopunca ya da sayfa yenilenince yeniden arar; bağlantıyı kabul eden
  // tarafta eski bir adres kalırsa iki taraf aynı anda birbirini arayıp bağlantıları düşürür.
  if (!oturum.yeniden) hafizaSil(BILET_HAFIZASI);
  // Aynı cihaz bu arada adını değiştirdiyse eski satırlar da yeni adı göstersin.
  adlariGuncelle(oturum);
  bagliYaz(oturum);
  $("baglan").hidden = true;
  $("yeniden").hidden = true;
  $("paylasim").hidden = false;
  $("kes").hidden = false;
  $("dogrulama-kodu").textContent = dogrulamaKodu(oturum.baglanti);
  $("dogrulama").hidden = false;
  almaDongusu(oturum);
  yolYaz(oturum);
  dogrudanBaslat(oturum);
  oturum.baglanti.kapanis().then(neden => {
    // Kod uç noktası tek kullanımlıktır; onun üzerindeki oturum bitince kapatılır.
    if (oturum.dugum && oturum.dugum !== dugum) {
      if (oturum.dugum === kodDugumu) kodDugumu = null;
      oturum.dugum.kapat();
    }
    if (mevcut !== oturum) return;
    mevcut = null;
    $("yol").hidden = true;
    const yeniden = oturum.yeniden ?? tumRelaylerle(`${oturum.karsiKimlik}~`);
    if (neden === GECIS || neden === YENILENDI) {
      // Karşı taraf aynı cihazdan yeni bir bağlantı kuruyor; kısa bir süre beklenir.
      durumYaz("Bağlanılıyor…");
      $("paylasim").hidden = true;
      $("kes").hidden = true;
      setTimeout(() => {
        if (mevcut) return;
        durumYaz("Bağlantı koptu. Diğer cihazın yeniden bağlanması bekleniyor…", "hata");
        bagliDegilGoster(yeniden);
      }, 15000);
      return;
    }
    // Bilerek kesilen bir bağlantıdan sonra yeni istek, hangi taraf keserse kessin onay ister.
    if (bilerekKesildi || neden === KESILDI || neden === DEGISTI) onayGerekliYap(true);
    const durdur = bilerekKesildi || DURDURAN_NEDENLER.includes(neden);
    if (oturum.yeniden && !durdur) {
      $("dogrulama").hidden = true;
      $("paylasim").hidden = true;
      $("kes").hidden = true;
      kendiligindenBaglan(oturum.yeniden);
      return;
    }
    durumYaz(bilerekKesildi ? "Bağlantı kesildi."
      : neden === KESILDI ? `${oturum.ad} bağlantıyı kesti.`
      : neden === DEGISTI ? `${oturum.ad} başka bir cihazı kabul etti.`
      : "Bağlantı koptu. Diğer cihazın yeniden bağlanması bekleniyor…", "hata");
    // Bu cihaz da karşı tarafa bağlanabilir; bilerek kesildiyse karşıda onay sorulur.
    bagliDegilGoster(yeniden);
  });
}

// Gelen bağlantı isteğini ekranda sorar. Sonuç: kabul edildiyse true, başka bir soru
// ekrandaysa MESGUL.
function onaySor(ad, kod, baglanti) {
  if (bekleyenOnay) return Promise.resolve(MESGUL);
  return new Promise(coz => {
    const bitir = sonuc => {
      if (bekleyenOnay !== bitir) return;
      bekleyenOnay = null;
      clearTimeout(zaman);
      $("onay").hidden = true;
      coz(sonuc);
    };
    bekleyenOnay = bitir;
    const zaman = setTimeout(() => bitir(false), ONAY_SURESI);
    baglanti.kapanis().then(() => bitir(false));
    $("onay-metin").textContent = `${ad} bağlanmak istiyor.`;
    $("onay-kod").textContent = kod;
    $("onay-uyari").textContent = mevcut ? `Kabul ederseniz ${mevcut.ad} ile bağlantı kesilir.` : "";
    $("onay-uyari").hidden = !mevcut;
    $("onay-kabul").onclick = () => bitir(true);
    $("onay-ret").onclick = () => bitir(false);
    onayBitis = Date.now() + ONAY_SURESI;
    $("onay").hidden = false;
    surelerGuncelle();
  });
}

// Reddedilen cihaz bir süre sessizce geri çevrilir; ekran sürekli soruyla doldurulamasın.
function engelliMi(kimlik) {
  const bitis = engellenenler.get(kimlik);
  if (bitis && bitis > Date.now()) return true;
  engellenenler.delete(kimlik);
  return false;
}

// Bu cihaza (QR ya da kodla) gelen bağlantı: önce karşının tanışma mesajı okunur, gerekirse onay
// sorulur, kabul edilirse bu cihazın tanışma mesajı gönderilir (karşı taraf için "kabul edildi").
//
// Kurallar:
// - Kodla gelen istek ve QR'daki tek kullanımlık değeri bilen yeni cihaz: her zaman onay sorulur.
// - Bu sekmede son bağlanan cihaz (sayfa yenilendi, ağ koptu): sorusuz kabul edilir. Bağlantı
//   bilerek kesildiyse ya da başka bir cihazın yerine geçecekse onay sorulur.
// - Ne QR değerini bilen ne de tanıdık olan istek: soru sorulmadan reddedilir.
async function gelenBaglanti(gelen, d) {
  if (bekleyenBaglanti >= EN_COK_BEKLEYEN) {
    gelen.free();
    return;
  }
  bekleyenBaglanti++;
  try {
    let baglanti;
    try {
      baglanti = await zamanAsimi(gelen.tamamla(), BAGLANMA_SURESI);
    } catch (e) {
      console.error(e);
      return;
    }
    const kodla = d === kodDugumu;
    const karsiKimlik = baglanti.karsi_kimlik();
    if ((kodla && kodKullanildi) || engelliMi(karsiKimlik)) {
      baglanti.kapat(REDDEDILDI);
      return;
    }
    let baslik;
    try {
      const alici = await zamanAsimi(baglanti.akis_bekle(), TANITIM_SURESI);
      if (!alici) return;
      ({ baslik } = await zamanAsimi(basligiOku(alici), TANITIM_SURESI));
      if (baslik.tip !== "tanitim") throw new Error("Tanışma mesajı bekleniyordu");
    } catch (e) {
      console.error(e);
      baglanti.kapat(KAPANDI);
      return;
    }
    const ad = adDuzelt(baslik.ad);
    const tanidik = !kodla && karsiKimlik === hafizaOku(KARSI_HAFIZASI);
    // QR'daki değer eşleştiği anda, araya bir bekleme girmeden tüketilir: aynı değerle gelen
    // ikinci bir istek onu kullanamaz.
    const qrIle = !kodla && typeof baslik.sir === "string" && baslik.sir === qrSirri();
    if (qrIle) qrYenile();
    if (!kodla && !qrIle && !tanidik) {
      baglanti.kapat(REDDEDILDI);
      return;
    }
    const sor = kodla || qrIle || onayGerekliMi() || (mevcut && mevcut.karsiKimlik !== karsiKimlik);
    if (sor) {
      const kabul = await onaySor(ad, dogrulamaKodu(baglanti), baglanti);
      if (kabul !== true) {
        if (kabul !== MESGUL) engellenenler.set(karsiKimlik, Date.now() + ENGEL_SURESI);
        baglanti.kapat(kabul === MESGUL ? MESGUL : REDDEDILDI);
        return;
      }
      // Soru ekrandayken kod başka bir istekle kullanılmış olabilir.
      if (kodla && kodKullanildi) {
        baglanti.kapat(REDDEDILDI);
        return;
      }
    }
    if (kodla) {
      kodKullanildi = true;
      koduGizle();
    }
    onayGerekliYap(false);
    // Kodla eşleşmede karşı taraf bu bağlantıyı kapatıp bu sekmenin rastgele anahtarlı asıl
    // adresine yeniden bağlanır; koddan türetilen adres bir daha kullanılmaz.
    try {
      await tanitimGonder(baglanti, { adres: dugum.bilet() });
    } catch (e) {
      console.error(e);
      return;
    }
    baglandi({ baglanti, ad, karsiKimlik, yeniden: null, dugum: d, rol: "yanit", karsiDogrudan: baslik.dogrudan === 1 });
  } finally {
    bekleyenBaglanti--;
  }
}

// Her istek kendi başına işlenir; el sıkışması takılan bir istek diğerlerini bekletmez.
async function gelenleriBekle(d) {
  for (;;) {
    let gelen;
    try {
      gelen = await d.bekle();
    } catch (e) {
      console.error(e);
      await bekle(1000);
      continue;
    }
    if (!gelen) return;
    gelenBaglanti(gelen, d);
  }
}

// Diğer taraf sayfayı yenileyince başka bir relay seçmiş olabilir; hepsi denenir.
function tumRelaylerle(bilet) {
  const [kimlik, ...relaylar] = bilet.split("~");
  return [kimlik, ...new Set([...relaylar.filter(Boolean), ...Object.values(RELAY_HARFLERI)])].join("~");
}

// Karşının tanışma mesajında bildirdiği asıl adres: yalnız bilinen biçim ve relay'ler kabul edilir.
function adresGecerli(adres) {
  if (typeof adres !== "string") return false;
  const [kimlik, relay = "", ...fazla] = adres.split("~");
  return /^[0-9a-f]{64}$/.test(kimlik) && !fazla.length && (relay === "" || Object.values(RELAY_HARFLERI).includes(relay));
}

function baglanZamanli(bilet, ms) {
  let gecKaldi = false;
  const soz = dugum.baglan(tumRelaylerle(bilet));
  // Süre dolduktan sonra kurulan bağlantıyı bekleyen yok; açık kalmasın.
  soz.then(b => { if (gecKaldi) b.kapat(KAPANDI); }, () => {});
  return zamanAsimi(soz, ms).catch(e => {
    gecKaldi = true;
    throw e;
  });
}

// Bağlanan taraf: adını (QR'dan geliyorsa tek kullanımlık değerle) gönderir, karşının tanışma
// mesajını (kabul) bekler. Sonuç: "tamam", "reddedildi", "mesgul" ya da "basarisiz".
async function kur(bilet, ms, sir, gecis = false) {
  const baglanti = await baglanZamanli(bilet, ms);
  try {
    await tanitimGonder(baglanti, sir ? { sir } : {});
    // Karşıda onay sorulursa iki ekrandaki kod karşılaştırılabilsin.
    $("dogrulama-kodu").textContent = dogrulamaKodu(baglanti);
    $("dogrulama").hidden = false;
    durumYaz("Diğer cihazın onayı bekleniyor…");
    const sonuc = await zamanAsimi((async () => {
      const alici = await baglanti.akis_bekle();
      if (!alici) return { neden: await baglanti.kapanis() };
      const { baslik } = await basligiOku(alici);
      return baslik.tip === "tanitim" ? baslik : { neden: "beklenmeyen" };
    })(), ONAY_SURESI);
    if (sonuc.tip !== "tanitim") {
      baglanti.kapat(KAPANDI);
      if (!mevcut) $("dogrulama").hidden = true;
      return sonuc.neden === REDDEDILDI ? "reddedildi" : sonuc.neden === MESGUL ? "mesgul" : "basarisiz";
    }
    // Karşı taraf asıl adresini bildirir; yeniden bağlanmalarda o kullanılır.
    const yeniden = adresGecerli(sonuc.adres) ? sonuc.adres : bilet;
    hafizaYaz(BILET_HAFIZASI, yeniden);
    if (yeniden.split("~")[0] !== baglanti.karsi_kimlik()) {
      // Kodla eşleşme kabul edildi: koddan türetilen adresten karşının asıl adresine geçilir.
      // Koddan türetilen kimlik hiçbir yerde "tanıdık" olarak saklanmaz.
      if (gecis) throw new Error("Asıl adrese geçilemedi");
      baglanti.kapat(GECIS);
      durumYaz("Bağlanılıyor…");
      return kur(yeniden, ms, undefined, true);
    }
    baglandi({ baglanti, ad: adDuzelt(sonuc.ad), karsiKimlik: baglanti.karsi_kimlik(), yeniden, dugum: null, rol: "teklif", karsiDogrudan: sonuc.dogrudan === 1 });
    return "tamam";
  } catch (e) {
    baglanti.kapat(KAPANDI);
    if (!mevcut) $("dogrulama").hidden = true;
    throw e;
  }
}

const MESGUL_METNI = "Diğer cihaz başka bir isteği yanıtlıyor. Biraz sonra tekrar deneyin.";

function reddedildiYaz(bilet, hataMetni) {
  durumYaz("Bağlantı isteği reddedildi.", "hata");
  $("yeniden-dugme").onclick = () => bilettenBaglan(bilet, hataMetni);
  $("yeniden").hidden = false;
}

// Bağlantı istemeden koptuysa (diğer taraf sayfayı yeniledi, ağ gidip geldi) sayfa açık kaldıkça
// artan aralıklarla yeniden dener. Sayfa arka plandayken bekler.
async function kendiligindenBaglan(bilet) {
  const hataMetni = "Bağlanılamadı. Diğer cihazdaki sayfa açık mı?";
  const baslangic = Date.now();
  let ara = 2000;
  for (let deneme = 1; Date.now() - baslangic < YENIDEN_TOPLAM_SURE; deneme++) {
    while (document.hidden) await bekle(1000);
    if (mevcut || bilerekKesildi) return;
    durumYaz(`Bağlantı koptu. Yeniden bağlanılıyor… (${deneme}. deneme)`, "hata");
    try {
      const sonuc = await kur(bilet, YENIDEN_SURESI);
      if (sonuc === "tamam") return;
      if (sonuc === "reddedildi") {
        reddedildiYaz(bilet, hataMetni);
        $("baglan").hidden = false;
        return;
      }
    } catch (e) {
      console.error(e);
    }
    // Bir sonraki denemeye kalan süre canlı gösterilir.
    const sonraki = Date.now() + ara;
    while (Date.now() < sonraki) {
      if (mevcut || bilerekKesildi) return;
      durumYaz(`Bağlantı koptu. Yeniden bağlanmaya kalan süre: ${sureYaz(sonraki - Date.now())}`, "hata");
      await bekle(Math.min(1000, sonraki - Date.now()));
    }
    ara = Math.min(ara * 2, YENIDEN_EN_UZUN_ARA);
  }
  if (mevcut) return;
  durumYaz(hataMetni, "hata");
  bagliDegilGoster(bilet);
}

// Sonuç: bağlantı kurulduysa true.
async function bilettenBaglan(bilet, hataMetni, sir) {
  durumYaz("Bağlanılıyor…");
  $("yeniden").hidden = true;
  $("yeniden-dugme").onclick = () => bilettenBaglan(bilet, hataMetni, sir);
  try {
    const sonuc = await kur(bilet, BAGLANMA_SURESI, sir);
    if (sonuc === "tamam") return true;
    if (sonuc === "reddedildi") {
      reddedildiYaz(bilet, hataMetni);
      return false;
    }
    if (sonuc === "mesgul") {
      durumYaz(MESGUL_METNI, "hata");
      $("yeniden").hidden = false;
      return false;
    }
  } catch (e) {
    console.error(e);
  }
  durumYaz(hataMetni, "hata");
  $("yeniden").hidden = false;
  return false;
}

// --- Kodla eşleşme ---

// Kod tek kullanımlık ve 5 dakika geçerlidir; hiçbir yere kaydedilmez.
async function kodGoster() {
  const dugme = $("kod-goster");
  dugme.disabled = true;
  dugme.textContent = "Hazırlanıyor…";
  koduBirak();
  const kod = kodUret();
  let yeni;
  let gecKaldi = false;
  try {
    const soz = kodTohumu(kod).then(t => Dugum.baslat(t));
    // Süre dolduktan sonra açılan uç nokta sahipsiz kalmasın.
    soz.then(d => { if (gecKaldi) d.kapat(); }, () => {});
    yeni = await zamanAsimi(soz, BASLAMA_SURESI).catch(e => {
      gecKaldi = true;
      throw e;
    });
  } catch (e) {
    console.error(e);
    dugme.disabled = false;
    dugme.textContent = "Kod göster";
    durumYaz("Kod hazırlanamadı. Tekrar deneyin.", "hata");
    return;
  }
  kodDugumu = yeni;
  kodKullanildi = false;
  dugme.hidden = true;
  $("kod").textContent = gruplara(kod, 4);
  $("kod").hidden = $("kod-aciklama").hidden = false;
  $("kod-aciklama").textContent = "Bu kodu diğer cihazdaki Tulpar sayfasına yazın. Kod bir kez kullanılabilir.";
  kodBitis = Date.now() + KOD_SURESI;
  $("kod-sure").hidden = false;
  surelerGuncelle();
  gelenleriBekle(yeni);
  kodZamani = setTimeout(() => {
    if (kodKullanildi) return;
    koduBirak();
    $("kod-aciklama").textContent = "Kodun süresi doldu. Yeni kod için Kod göster düğmesine basın.";
    $("kod-aciklama").hidden = false;
  }, KOD_SURESI);
}

// Ekrandaki kodu kaldırır; "Kod göster" yeniden kullanılabilir olur.
function koduGizle() {
  clearTimeout(kodZamani);
  kodBitis = 0;
  $("kod").hidden = $("kod-aciklama").hidden = $("kod-sure").hidden = true;
  const dugme = $("kod-goster");
  dugme.hidden = false;
  dugme.disabled = false;
  dugme.textContent = "Kod göster";
}

// Kodu gizler ve kod uç noktasını bırakır. Üzerinde süren bir bağlantı varsa uç nokta o bağlantı
// bitince kapanır (baglandi); yoksa hemen kapatılır.
function koduBirak() {
  koduGizle();
  const eski = kodDugumu;
  kodDugumu = null;
  if (eski && mevcut?.dugum !== eski) eski.kapat();
}

async function kodlaBaglan(girilen) {
  const kod = kodDuzelt(girilen);
  if (kod.length !== KOD_UZUNLUGU) {
    durumYaz(`Kod ${KOD_UZUNLUGU} karakter olmalı.`, "hata");
    return;
  }
  if ([...kod].some(h => !KOD_HARFLERI.includes(h))) {
    durumYaz("Kodda 0, 1, I, L ve O yok. Kodu kontrol edin.", "hata");
    return;
  }
  durumYaz("Kod hazırlanıyor…");
  const bilet = Dugum.koddan_bilet(await kodTohumu(kod));
  $("baglan").hidden = true;
  if (!(await bilettenBaglan(bilet, "Bağlanılamadı. Kodu ve diğer cihazdaki sayfanın açık olduğunu kontrol edin."))) {
    $("baglan").hidden = false;
  }
}

// --- QR bağlantısı ---

// QR'daki bilgi: PC'nin 32 baytlık açık anahtarı (base64url, 43 karakter), relay'in tek harfi
// ve "." ardından tek kullanımlık değer. Telefon bağlanırken bu anahtarı TLS ile doğrular.
const RELAY_HARFLERI = {
  e: "https://euc1-1.relay.n0.iroh.link/",
  u: "https://use1-1.relay.n0.iroh.link/",
  w: "https://usw1-1.relay.n0.iroh.link/",
  a: "https://aps1-1.relay.n0.iroh.link/",
};

function biletKisalt(bilet) {
  const [kimlik, relay = ""] = bilet.split("~");
  if (!/^[0-9a-f]{64}$/.test(kimlik)) throw new Error("Beklenmeyen kimlik biçimi");
  const harf = Object.keys(RELAY_HARFLERI).find(h => RELAY_HARFLERI[h] === relay) ?? "";
  return base64url(kimlik.match(/../g).map(h => parseInt(h, 16))) + harf;
}

function biletAc(kisa) {
  const [anahtar, sir = ""] = kisa.split(".");
  const ikili = atob(anahtar.slice(0, 43).replace(/-/g, "+").replace(/_/g, "/"));
  if (ikili.length !== 32) throw new Error("Geçersiz bağlantı bilgisi");
  const harf = anahtar.slice(43);
  if (harf && !RELAY_HARFLERI[harf]) throw new Error("Geçersiz sunucu bilgisi");
  const kimlik = onaltilik([...ikili].map(c => c.charCodeAt(0)));
  return { bilet: `${kimlik}~${RELAY_HARFLERI[harf] ?? ""}`, sir: /^[A-Za-z0-9_-]{22}$/.test(sir) ? sir : "" };
}

// QR'dan gelen bilgiyi okur ve adres çubuğundan siler. Sayfa yenilenirse aynı sekmede
// yeniden bağlanabilmek için adres sekme hafızasında tutulur.
function biletiAl() {
  const hash = location.hash.slice(1);
  if (hash) {
    history.replaceState(null, "", location.pathname + location.search);
    const { bilet, sir } = biletAc(hash);
    hafizaYaz(BILET_HAFIZASI, bilet);
    return { bilet, sir, kaynak: "adres" };
  }
  const bilet = hafizaOku(BILET_HAFIZASI);
  return bilet && adresGecerli(bilet.split("~").slice(0, 2).join("~")) ? { bilet, kaynak: "hafiza" } : null;
}

function qrGoster() {
  const adres = `${location.origin}${location.pathname}#${biletKisalt(dugum.bilet())}.${qrSirri()}`;
  const qr = qrcode(0, "M");
  qr.addData(adres);
  qr.make();
  $("qr-resim").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  qrBitis = Date.now() + QR_SURESI;
  surelerGuncelle();
  const dugme = $("adres-kopyala");
  dugme.dataset.adres = adres;
  dugme.onclick = async () => {
    try {
      await navigator.clipboard.writeText(adres);
      dugme.textContent = "Kopyalandı. Yalnızca kendi cihazınıza gönderin.";
    } catch {
      dugme.textContent = "Kopyalanamadı";
    }
    setTimeout(() => { dugme.textContent = "Bağlantı adresini kopyala"; }, 2000);
  };
}

// --- Başlangıç ---

// Sorunun nerede olduğu anlaşılsın diye teknik hata metnini de küçük yazıyla gösterir.
function hataGoster(metin, e) {
  console.error(e);
  durumYaz(metin, "hata");
  $("ayrinti").textContent = `Ayrıntı: ${e?.message || e}`;
  $("ayrinti").hidden = false;
}

async function basla() {
  // Başka bir sitenin çerçevesi içinde açıldıysa çalışma: üstüne sahte bir arayüz konabilir.
  if (window.top !== window.self) {
    durumYaz("Tulpar başka bir sayfanın içinde açılamaz. Adresi doğrudan tarayıcıya yazın.", "hata");
    return;
  }
  adiGoster();
  const wasmYok = "Bu tarayıcıda WebAssembly çalışmıyor. iPhone'da Kilitlenme Modu açıksa Tulpar çalışmaz.";
  if (typeof WebAssembly !== "object") {
    durumYaz(wasmYok, "hata");
    return;
  }
  durumYaz("Şifreleme hazırlanıyor…");
  try {
    await init({ module_or_path: pkgAdresi("tulpar_cekirdek_bg.wasm") });
  } catch (e) {
    hataGoster(wasmYok, e);
    return;
  }
  durumYaz("Aktarma sunucusuna bağlanılıyor…");
  try {
    dugum = await zamanAsimi(Dugum.baslat(sekmeAnahtari()), BASLAMA_SURESI);
  } catch (e) {
    hataGoster("Aktarma sunucusuna ulaşılamadı. Sayfayı yenileyip tekrar deneyin.", e);
    return;
  }
  // Her sayfa gelen bağlantıları dinler; böylece bağlantı kopunca iki taraf da yeniden bağlanabilir.
  gelenleriBekle(dugum);
  qrGoster();
  // QR'daki tek kullanımlık değer kullanılmasa da belli aralıklarla yenilenir; ekranda uzun süre
  // açık kalan bir QR'ı sonradan okutan biri onay sorusu çıkaramaz. Süreler canlı gösterilir.
  setInterval(surelerGuncelle, 1000);

  let gelen = null;
  let okunamadi = false;
  try {
    gelen = biletiAl();
  } catch (e) {
    console.error(e);
    okunamadi = true;
  }
  if (gelen) {
    const tamam = await bilettenBaglan(gelen.bilet, "Bağlanılamadı. Diğer cihazdaki sayfa açık mı? Kapandıysa yeni QR kodu okutun.", gelen.sir);
    if (tamam) return;
    if (gelen.kaynak === "adres") {
      // QR ile açılış başarısız: "Yeniden bağlan" kalır, kodla bağlanma da seçilebilsin.
      $("baglan").hidden = false;
      return;
    }
    // Yenilemeden sonra eski bağlantı artık geçerli değilse normal başlangıç ekranına dön.
    hafizaSil(BILET_HAFIZASI);
    $("yeniden").hidden = true;
  }
  $("baglan").hidden = false;
  if (okunamadi) {
    durumYaz("QR koddaki bağlantı bilgisi okunamadı. QR kodu yeniden okutun ya da 8 karakterlik kodla bağlanın.", "hata");
  } else {
    durumYaz("Diğer cihazın bağlanması bekleniyor…");
  }
}

// --- Arayüz olayları ---

$("ad-degistir").onclick = () => {
  const yeni = prompt("Bu cihazın adı (boş bırakırsanız rastgele bir ad verilir):", cihazAdi());
  if (yeni === null) return;
  oturumAdi = yeni.trim() ? adDuzelt(yeni) : rastgeleAd();
  adKaydet(oturumAdi);
  adiGoster();
  // Bağlıysa karşı taraf yeni adı hemen görsün.
  if (mevcut) tanitimGonder(mevcut.baglanti).catch(e => console.error(e));
};

$("kod-goster").onclick = () => kodGoster();
$("kod-formu").onsubmit = e => {
  e.preventDefault();
  kodlaBaglan($("kod-girdi").value);
};

// Android'de Firefox ve Chrome (ve Chromium tabanlı tarayıcılar), dosya kutusunda tür
// belirtilmemişse seçim ekranına "fotoğraf çek" ve "ses kaydet" seçeneklerini koymak için kamera
// ve mikrofon izni ister. Tür olarak bilinmeyen tek bir uzantı verilirse ikisi de izin istemez:
// Firefox uzantıyı olduğu gibi iletir, Chrome onu genel dosya (application/octet-stream) sayar;
// medya türü olmadığı için kamera ve mikrofon gerekmez, seçim ekranı yine bütün dosyaları gösterir.
// Seçimi kısıtlamaz: tarayıcı türü yalnız öneri sayar. Masaüstünde ve iPhone'da tür verilmez;
// orada izin sorulmuyor, verilen tür ise pencerenin süzgecini daraltırdı.
if (/Android/.test(navigator.userAgent)) {
  $("dosyalar").accept = ".tulpar";
}
$("sec").onclick = () => $("dosyalar").click();
$("dosyalar").onchange = e => {
  dosyalariSirala([...e.target.files]);
  e.target.value = "";
};

const birakma = $("birakma");
document.addEventListener("dragover", e => {
  if (!mevcut) return;
  e.preventDefault();
  birakma.classList.add("uzerinde");
});
document.addEventListener("dragleave", e => {
  if (e.relatedTarget === null) birakma.classList.remove("uzerinde");
});
document.addEventListener("drop", e => {
  e.preventDefault();
  birakma.classList.remove("uzerinde");
  if (mevcut) dosyalariSirala([...e.dataTransfer.files]);
});

// Bilerek kesince karşı taraf kendiliğinden yeniden bağlanmaz; iki taraftan biri yeniden
// bağlanmak isterse diğerinde onay sorulur (bu bilgi sayfa yenilense de kalır). Kimlik sekme
// boyunca aynı kalır; QR'daki tek kullanımlık değer yenilenir.
$("kes").onclick = () => {
  bilerekKesildi = true;
  onayGerekliYap(true);
  hafizaSil(BILET_HAFIZASI);
  qrYenile();
  mevcut?.baglanti.kapat(KESILDI);
  koduBirak();
};

// Biten bir aktarımı listeden siler ve alınan dosyanın bellekteki kopyasını bırakır.
function satiriSil(li) {
  const a = li.querySelector(".ek a");
  if (a) {
    URL.revokeObjectURL(a.href);
    kaydedilmemis.delete(a);
  }
  li.remove();
  $("temizle").hidden = !$("aktarimlar").children.length;
}

// Süren aktarımlar listede kalır.
$("temizle").onclick = () => {
  for (const li of $("aktarimlar").querySelectorAll("li.tamam, li.hata")) satiriSil(li);
};

$("aktarimlar").addEventListener("click", e => {
  const li = e.target.closest(".sil")?.closest("li");
  if (li && (li.classList.contains("tamam") || li.classList.contains("hata"))) satiriSil(li);
});

// Ekran kilidi sayfa arka plana geçince bırakılır; geri gelince yeniden alınır.
document.addEventListener("visibilitychange", ekranKilidiAl);

// Bağlıyken ya da kaydedilmemiş gelen dosya varken sayfadan çıkmadan önce sorulur.
addEventListener("beforeunload", e => {
  if (mevcut || kaydedilmemis.size) e.preventDefault();
});

// Sayfa kapanırken karşı taraf kopmayı beklemeden öğrensin. "kesildi" değil, çünkü
// yenileme olabilir; karşı taraf yeniden bağlanmayı denesin.
addEventListener("pagehide", () => mevcut?.baglanti.kapat(KAPANDI));

// --- Adım göstergesi ve alt bilgi ---

// Adım, görünen bölümlerden çıkarılır: onay sorusu açıksa 2, bağlıysa 3, değilse 1.
function adimGuncelle() {
  const adim = !$("paylasim").hidden ? 3 : !$("onay").hidden ? 2 : 1;
  $("adimlar").querySelectorAll("li").forEach((li, i) => {
    li.classList.toggle("etkin", i + 1 === adim);
    li.classList.toggle("bitti", i + 1 < adim);
    if (i + 1 === adim) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
  });
}
const adimGozcusu = new MutationObserver(adimGuncelle);
for (const id of ["paylasim", "onay"]) adimGozcusu.observe($(id), { attributes: true, attributeFilter: ["hidden"] });
adimGuncelle();

// Sürüm numarası yayında package.json'dan yazılır (ör. 1.0.0); yerelde "geliştirme" yazar.
const surumAdi = $("surum").dataset.surum;
$("surum").textContent = `Tulpar · HB4sri · ${/^\d+\.\d+\.\d+$/.test(surumAdi) ? "v" + surumAdi : "geliştirme"}`;

basla();
