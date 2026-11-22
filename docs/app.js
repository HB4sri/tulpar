// QR'dan gelen bilgi (#…) her şeyden önce belleğe alınır ve adres çubuğundan silinir; sayfanın
// geri kalanı yüklenemese de adres çubuğunda kalmaz. Bu kısım hiçbir sunucuya gitmez.
const ILK_ADRES_BILGISI = location.hash.slice(1);
if (ILK_ADRES_BILGISI) history.replaceState(null, "", location.pathname + location.search);

// Tulpar Android uygulamasının içinde mi: uygulama sitenin kendi içindeki kopyasını bu adresten
// sunar. Bu adres internetten erişilemez; Android'in tarayıcı bileşeni yalnız uygulamanın kendi
// dosyalarını buradan verir. Uygulamada sitenin logosu ve alt bilgisi gizlenir (stil.css).
const UYGULAMA = location.hostname === "appassets.androidplatform.net";
if (UYGULAMA) document.documentElement.classList.add("uygulama");
// QR kod ve kopyalanan bağlantı her zaman sitenin adresini taşır: karşı cihaz uygulamanın iç
// adresini açamaz.
const SAYFA_ADRESI = UYGULAMA ? "https://tulpar.page/" : `${location.origin}${location.pathname}`;

// Yayında dosya adresleri sürümle (?v=) istenir; önbellekte eski çekirdek ile yeni sayfa karışmasın.
const SURUM = new URL(import.meta.url).searchParams.get("v") ?? "";
const pkgAdresi = ad => new URL(`./pkg/${ad}?v=${SURUM}`, import.meta.url).href;
const { default: init, Dugum } = await import(pkgAdresi("tulpar_cekirdek.js"));

// Her akış bir çerçeveyle başlar: [4 bayt başlık uzunluğu][JSON başlık], ardından varsa içerik.
// Dosya başlığı: { ad, boyut }. Tanışma başlığı: { tip: "tanitim", ad, sir?, adres?, taahhut? }.
// Doğrulama değeri: { tip: "dogrulama", deger } (bk. "Doğrulama kodu"). Bu ikisinde içerik yok.
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
const ESKI = "eski";             // karşıdaki sayfa doğrulama değerlerini değiştirmeyen eski bir sürüm
const DURDURAN_NEDENLER = [KESILDI, DEGISTI, REDDEDILDI];

const $ = id => document.getElementById(id);
const durum = $("durum");
// Uygulamada ayrıca "Geçmiş" ekranı var; bu düğme yalnız ekrandaki listeyi boşaltır.
if (UYGULAMA) $("temizle").textContent = "Listeyi temizle";

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
// El sıkışma beklerken durum değişebilir. `nesil`, kullanıcının verdiği her karar (kes, kabul et),
// etkin cihazın ya da kimliğin değişmesiyle artar; el sıkışma, başladığı nesil geçerli değilse
// etkin bağlantı olamaz. `aramaNo`, kullanıcının başlattığı her bağlanmayla artar: eskisi geçersizdir.
let nesil = 0;
let aramaNo = 0;
const elSikismalar = new Set(); // tamamlanmamış bağlantılar; "Bağlantıyı kes" hepsini kapatır
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

// Sekme çoğaltılırsa ("Sekmeyi çoğalt") sekme hafızası da kopyalanır ve iki sekme aynı kimlikle
// çalışıp birbirinin bağlantısını bozar. Açılışta aynı sekme numarasını taşıyan başka bir açık sekme
// olup olmadığı sorulur; varsa bu sekme hafızayı temizleyip yeni bir kimlik alır. Sayfa
// yenilendiğinde eski sayfa kapanmış olduğu için yanıt gelmez ve kimlik korunur.
const SEKME_HAFIZASI = "tulpar-sekme";
const sekmeKanali = typeof BroadcastChannel === "function" ? new BroadcastChannel("tulpar-sekme") : null;
let sekmeNo = hafizaOku(SEKME_HAFIZASI);

function baskaSekmedeMi(no) {
  if (!sekmeKanali || !no) return Promise.resolve(false);
  return new Promise(coz => {
    const bitir = sonuc => {
      clearTimeout(zaman);
      sekmeKanali.removeEventListener("message", dinle);
      coz(sonuc);
    };
    const dinle = e => { if (e.data?.var === no) bitir(true); };
    const zaman = setTimeout(() => bitir(false), 300);
    sekmeKanali.addEventListener("message", dinle);
    sekmeKanali.postMessage({ soru: no });
  });
}

async function sekmeyiHazirla() {
  if (await baskaSekmedeMi(sekmeNo)) {
    hafizaSil(ANAHTAR_HAFIZASI, SIR_HAFIZASI, BILET_HAFIZASI, KARSI_HAFIZASI, ONAY_HAFIZASI);
    sekmeNo = null;
  }
  if (!sekmeNo) {
    sekmeNo = onaltilik(crypto.getRandomValues(new Uint8Array(8)));
    hafizaYaz(SEKME_HAFIZASI, sekmeNo);
  }
  sekmeKanali?.addEventListener("message", e => {
    if (e.data?.soru === sekmeNo) sekmeKanali.postMessage({ var: sekmeNo });
  });
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

// Sekmenin kimliği (anahtarı) boştayken QR ile birlikte yenilenir: eski bir QR'ı gören ya da daha
// önce eşleşmiş biri bu sekmeye istek yağdırıp yeni eşleşmeleri engelleyemesin. Bağlı bir cihaz,
// ekranda soru, bu sekmeden süren bir bağlanma, açık bir kod ya da yeniden bağlanabilecek bir cihaz
// varken (bağlantı bittikten sonra YENIDEN_TOPLAM_SURE boyunca) kimlik korunur. Yarım kalmış gelen
// istekler yenilemeyi durdurmaz: engelleme denemesi tam olarak böyle isteklerle yapılır.
let sonBaglantiBitisi = 0;
let disariBaglanan = 0;
let kimlikYenileniyor = false;

function kimlikYenilenebilir() {
  return !mevcut && !bekleyenOnay && !disariBaglanan && !kodDugumu &&
    !hafizaOku(BILET_HAFIZASI) && Date.now() - sonBaglantiBitisi > YENIDEN_TOPLAM_SURE;
}

async function kimlikYenile() {
  kimlikYenileniyor = true;
  qrBitis = 0;
  let gecKaldi = false;
  try {
    const anahtar = crypto.getRandomValues(new Uint8Array(32));
    const soz = Dugum.baslat(anahtar);
    soz.then(d => { if (gecKaldi) d.kapat(); }, () => {});
    const yeni = await zamanAsimi(soz, BASLAMA_SURESI).catch(e => {
      gecKaldi = true;
      throw e;
    });
    if (!kimlikYenilenebilir()) {
      yeni.kapat();
    } else {
      const eski = dugum;
      dugum = yeni;
      nesil++;
      hafizaYaz(ANAHTAR_HAFIZASI, onaltilik(anahtar));
      hafizaSil(KARSI_HAFIZASI, ONAY_HAFIZASI);
      gelenleriBekle(yeni);
      eski.kapat();
    }
  } catch (e) {
    console.error(e);
  } finally {
    kimlikYenileniyor = false;
    qrYenile();
  }
}

function qrSuresiDoldu() {
  if (kimlikYenileniyor) return;
  if (kimlikYenilenebilir()) kimlikYenile();
  else qrYenile();
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

// Karşıdan gelen adlardan atılan karakterler: denetim karakterleri (C0, C1), yazı yönünü değiştiren
// işaretler (ör. uzantıyı gizleyen U+202E, U+061C), sıfır genişlikli ve boş görünen karakterler
// (ör. U+200B, U+2800, U+3164) ve Unicode etiket karakterleri. Görünmez karakterlerle bir dosya
// adının sonundaki uzantı gözden kaçırılamasın.
const GORUNMEZ = /[\u0000-\u001f\u007f-\u009f­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯⠀ㅤ﻿ﾠ￰-￸\u{1d173}-\u{1d17a}\u{e0000}-\u{e007f}]/gu;

// Karşıdan gelen ad güvenilmez veridir: yalnız textContent ile gösterilir, görünmez karakterler
// atılır, boşluklar teke indirilir, kısaltılır.
function adDuzelt(ad) {
  return (typeof ad === "string" ? ad : "")
    .replace(GORUNMEZ, "")
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
    qrSuresiDoldu();
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

// Karşıdan gelen dosya adı: görünmez karakterler (GORUNMEZ) atılır, boşluklar teke indirilir,
// yol ve sistem için sorunlu karakterler "_" olur, uzunluk AD_SINIRI bayta (UTF-8) indirilir.
// Kısaltma dosyanın türünü değiştiremez: gerçek son uzantı korunur; korunamayacak kadar uzunsa
// kalan noktalar "_" olur, kesik bir parça uzantı sayılamaz. Android uygulaması aynı kuralı uygular
// (Ayristir.dosyaAdi).
const AD_SINIRI = 200;
const UZANTI_SINIRI = 40;

function dosyaAdiDuzelt(ad) {
  const temiz = (typeof ad === "string" ? ad : "")
    .replace(GORUNMEZ, "")
    .replace(/\p{Surrogate}/gu, "_")
    .replace(/\s+/g, " ")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  const bayt = metin => new TextEncoder().encode(metin).length;
  if (bayt(temiz) <= AD_SINIRI) return temiz || "dosya";
  const nokta = temiz.lastIndexOf(".");
  let uzanti = nokta > 0 ? temiz.slice(nokta) : "";
  if (bayt(uzanti) > UZANTI_SINIRI) uzanti = "";
  let kalan = AD_SINIRI - bayt(uzanti);
  let govde = "";
  for (const harf of uzanti ? temiz.slice(0, nokta) : temiz) {
    kalan -= bayt(harf);
    if (kalan < 0) break;
    govde += harf;
  }
  govde = govde.replace(/[\s.]+$/, "");
  return (uzanti ? govde + uzanti : govde.replace(/\./g, "_")) || "dosya";
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

// Android uygulamasına aktarımın başladığını ve bittiğini bildirir (bildirim ve telefondaki geçmiş
// için). Yalnız uygulamanın içinde ve köprü varken; dosyanın içeriği gitmez, yalnız adı, boyutu,
// yönü ve karşı cihazın adı.
let satirSayaci = 0;
function uygulamayaBildir(olay) {
  if (!UYGULAMA || typeof TulparAndroid !== "object") return;
  try { TulparAndroid.postMessage(JSON.stringify({ tip: "olay", ...olay })); } catch {}
}

// Satır karşı cihazın kimliğiyle işaretlenir; o cihaz adını değiştirince satırdaki ad da güncellenir.
// `baslar` false: hiç başlamadan reddedilen satır; uygulamada aktarım hizmetini başlatmaz.
function satirEkle(yon, ad, boyut, oturum, baslar = true) {
  const kimlik = ++satirSayaci;
  const olay = durum => uygulamayaBildir({ olay: durum, kimlik, yon, ad, boyut, cihaz: oturum.ad });
  if (baslar) olay("basladi");
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
    kimlik,
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
      olay("bitti");
      li.className = "tamam";
      duyur(`${m}. Dosya: ${ad}`);
      cubuk.style.transform = "scaleX(1)";
      metin.textContent = m;
      ek.replaceChildren(...(ekOge ? [ekOge] : []));
    },
    hata(m) {
      olay("hata");
      li.className = "hata";
      duyur(`${m}. Dosya: ${ad}`);
      metin.textContent = m;
      ek.textContent = "";
    },
    not(m) {
      const p = document.createElement("p");
      p.className = "not kucuk";
      p.textContent = m;
      li.append(p);
    },
  };
}

// Açılınca program çalıştıran ya da tarayıcıda açılınca kod çalıştırabilen dosya türleri. Alınan
// böyle bir dosyanın satırında not gösterilir; dosya engellenmez.
const PROGRAM_UZANTILARI = new Set([
  "exe", "com", "pif", "msi", "msix", "appx", "bat", "cmd", "ps1", "vbs", "vbe", "js", "jse", "wsf",
  "scr", "lnk", "url", "hta", "jar", "reg", "app", "dmg", "pkg", "command", "apk", "html", "htm",
  "xhtml", "mht", "mhtml", "svg", "cpl", "msc", "msp", "chm", "scf", "wsh", "psm1", "xll", "jnlp",
  "library-ms", "settingcontent-ms", "iso", "img", "vhd", "vhdx", "docm", "dotm", "xlsm", "xltm",
  "xlam", "pptm", "potm", "ppam", "sh", "py", "desktop", "appimage", "deb", "rpm", "ipa", "webloc",
  "inetloc", "msixbundle", "appinstaller", "appref-ms", "application", "msu", "xht", "shtml", "svgz",
  "pyw", "pyz", "rdp", "xlsb", "vb", "one", "xapk", "apks", "inf", "diagcab",
]);
const programMi = ad => PROGRAM_UZANTILARI.has(ad.split(".").pop().toLowerCase()) && ad.includes(".");

// --- Gönderme ---

// Dosya, sıraya eklendiği andaki cihaza gider. Bağlantı koptuktan sonra aynı cihaza yeniden
// bağlanıldıysa yeni bağlantı kullanılır; bu arada başka bir cihaz bağlandıysa gönderilmez.
async function dosyaGonder(dosya, hedef) {
  const oturum = mevcut;
  if (!oturum) {
    satirEkle("giden", dosya.name, dosya.size, hedef, false).hata("Gönderilemedi: Bağlantı yok");
    return;
  }
  if (oturum.karsiKimlik !== hedef.karsiKimlik) {
    satirEkle("giden", dosya.name, dosya.size, hedef, false).hata("Bağlı cihaz değiştiği için gönderilmedi");
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

const simdikiHedef = () => mevcut && { karsiKimlik: mevcut.karsiKimlik, ad: mevcut.ad };

function dosyalariSirala(dosyalar, hedef) {
  if (!hedef) return;
  for (const dosya of dosyalar) {
    gonderimKuyrugu = gonderimKuyrugu.then(() => dosyaGonder(dosya, hedef));
  }
}

// Yalnız başlıktan oluşan akış. Karşı taraf akış açtırmayarak ya da okumayarak bekletemesin.
function baslikGonder(baglanti, baslik) {
  return zamanAsimi((async () => {
    const gonderici = await baglanti.akis_ac();
    await gonderici.yaz(cerceve(baslik));
    gonderici.bitir().catch(() => {});
  })(), TANITIM_SURESI);
}

async function tanitimGonder(baglanti, ek = {}) {
  await baslikGonder(baglanti, { tip: "tanitim", ad: cihazAdi(), dogrudan: DOGRUDAN_DESTEK ? 1 : 0, ...ek });
}

// --- Alma ---

// Alınan dosyalar kaydedilene ya da listeden kaldırılana kadar bellekte durur. Toplamları ve aynı
// anda alınan dosya sayısı sınırlıdır; bağlı cihaz sekmeyi belleği doldurarak çökertemesin.
const TOPLAM_SINIR = IOS ? 600 * 1024 ** 2 : 2 * 1024 ** 3;
const EN_COK_ALINAN = 2; // dosyalar sırayla gönderildiği için normal kullanımda aşılmaz
let alinanSayisi = 0;
let bellektekiBayt = 0;  // alınmakta olan ve bellekte tutulan dosyaların toplamı
const bellekPayi = new Map(); // Kaydet bağlantısı -> bellekte tuttuğu bayt

// Gelen dosya için yer ayırır ve satırını açar. Sınırı aşıyorsa nedeni yazar ve null döner.
function alimaBasla(ad, boyut, oturum) {
  if (!Number.isSafeInteger(boyut) || boyut < 0 || boyut > EN_BUYUK_DOSYA) {
    satirEkle("gelen", ad, 0, oturum, false).hata(`Alınmadı: Dosya ${boyutYaz(EN_BUYUK_DOSYA)} sınırını aşıyor`);
    return null;
  }
  if (alinanSayisi >= EN_COK_ALINAN) return null;
  if (bellektekiBayt + boyut > TOPLAM_SINIR) {
    satirEkle("gelen", ad, boyut, oturum, false)
      .hata(`Alınmadı: Alınan dosyalar ${boyutYaz(TOPLAM_SINIR)} sınırını aşıyor. Listeden dosya kaldırarak yer açın.`);
    return null;
  }
  alinanSayisi++;
  bellektekiBayt += boyut;
  aktarimBasladi();
  return satirEkle("gelen", ad, boyut, oturum);
}

// Alım bitti; dosya oluşmadıysa ayrılan yer geri verilir (oluştuysa Kaydet bağlantısı tutar).
function alimBitti(boyut, oldu) {
  alinanSayisi--;
  if (!oldu) bellektekiBayt -= boyut;
  aktarimBitti();
}

// Alınan dosyanın bellekteki kopyasını bırakır.
function bellegiBirak(a) {
  if (a.href) URL.revokeObjectURL(a.href); // uygulamadaki Kaydet düğmesinin adresi yoktur
  kaydedilmemis.delete(a);
  if (bellekPayi.has(a)) {
    bellektekiBayt -= bellekPayi.get(a);
    bellekPayi.delete(a);
  }
}

async function dosyaAl(alici, baslik, ilk, oturum) {
  const ad = dosyaAdiDuzelt(baslik.ad);
  const boyut = baslik.boyut;
  const satir = alimaBasla(ad, boyut, oturum);
  if (!satir) {
    alici.iptal();
    return;
  }
  let oldu = false;
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
    dosyaHazir(parcalar, ad, satir, boyut);
    oldu = true;
  } catch (e) {
    console.error(e);
    satir.hata("Aktarım yarıda kesildi");
  } finally {
    alimBitti(boyut, oldu);
  }
}

// Android uygulamasında dosya, uygulamanın verdiği köprüyle (TulparAndroid; yalnız bu sayfanın
// adresine açılır) parça parça uygulamaya geçer ve uygulama telefonun depolamasına yazar. Her
// parçadan sonra uygulamanın yanıtı beklenir: bellekte parça birikmez. Kayıtlar sırayla yapılır.
const UYGULAMA_PARCASI = 1024 * 1024;
let kayitSirasi = Promise.resolve();

function uygulamaYaniti() {
  return new Promise(coz => {
    TulparAndroid.onmessage = e => {
      try { coz(JSON.parse(e.data)); } catch { coz({ tip: "hata" }); }
    };
  });
}

async function uygulamayaKaydet(blob, ad, kimlik) {
  let yanit = uygulamaYaniti();
  TulparAndroid.postMessage(JSON.stringify({ tip: "basla", ad, boyut: blob.size, kimlik }));
  if ((await yanit).tip !== "hazir") return false;
  for (let i = 0; i < blob.size; i += UYGULAMA_PARCASI) {
    const parca = await blob.slice(i, i + UYGULAMA_PARCASI).arrayBuffer();
    yanit = uygulamaYaniti();
    TulparAndroid.postMessage(parca);
    if ((await yanit).tip !== "devam") return false;
  }
  yanit = uygulamaYaniti();
  TulparAndroid.postMessage(JSON.stringify({ tip: "bitti" }));
  return (await yanit).tip === "kaydedildi";
}

function uygulamaKaydetDugmesi(blob, ad, satir, boyut) {
  const dugme = document.createElement("button");
  dugme.textContent = "Kaydet";
  dugme.className = "kaydet";
  kaydedilmemis.add(dugme);
  bellekPayi.set(dugme, boyut);
  dugme.onclick = () => {
    dugme.disabled = true;
    const is_ = kayitSirasi.then(() => uygulamayaKaydet(blob, ad, satir.kimlik)).catch(e => { console.error(e); return false; });
    kayitSirasi = is_;
    is_.then(oldu => {
      if (!oldu) {
        dugme.disabled = false;
        return;
      }
      bellegiBirak(dugme);
      dugme.replaceWith("Kaydedildi");
    });
  };
  satir.tamam("Alındı", dugme);
}

// Alınan parçalardan dosyayı oluşturur ve satıra Kaydet bağlantısını koyar.
function dosyaHazir(parcalar, ad, satir, boyut) {
  // Tür her zaman ikili dosya: karşının verdiği tür (ör. text/html) sayfada açılıp çalışmasın.
  const blob = new Blob(parcalar, { type: "application/octet-stream" });
  if (UYGULAMA && typeof TulparAndroid === "object") {
    uygulamaKaydetDugmesi(blob, ad, satir, boyut);
    if (programMi(ad)) satir.not("Program dosyası: Yalnızca güvendiğiniz bir kaynaktan geldiyse açın.");
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = ad;
  a.textContent = "Kaydet";
  a.className = "kaydet";
  // Dosya kendiliğinden inmez; kullanıcı Kaydet'e basar. Kaydedildikten bir dakika sonra
  // bellekteki kopya bırakılır.
  kaydedilmemis.add(a);
  bellekPayi.set(a, boyut);
  a.addEventListener("click", () => {
    kaydedilmemis.delete(a);
    setTimeout(() => {
      if (!bellekPayi.has(a)) return; // bu arada listeden kaldırıldı
      bellegiBirak(a);
      a.replaceWith("Kaydedildi");
    }, 60000);
  }, { once: true });
  satir.tamam("Alındı", a);
  if (programMi(ad)) satir.not("Program dosyası: Yalnızca güvendiğiniz bir kaynaktan geldiyse açın.");
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
// iki cihaz aynı ağdaysa, yani karşı taraf o adresi zaten biliyorsa verilir. Adreslerin aynı olup
// olmadığı CPace ile, adresler gösterilmeden anlaşılır (Baglanti.karsilastir); karşı taraf
// bağlantı başına yalnız tek bir tahminin doğru olup olmadığını öğrenebilir:
//  1. Teklif: SDP (dış adres olmadan) ve CPace iletisi.
//  2. Yanıt: SDP, CPace iletisi ve yanıtlayanın etiketleri.
//  3. Teklif eden taraf etiketleri denetler; tutan yuvalar için kendi dış adresini kendi
//     etiketleriyle birlikte gönderir ("aday").
//  4. Yanıtlayan taraf etiketleri denetler; tutan yuvalar için kendi dış adresini gönderir.
// Her iki taraf da karşıdan yalnız tutan yuvadaki kendi anahtarıyla birebir aynı adresleri alır.
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

// "candidate:VAKIF BİLEŞEN udp ÖNCELİK ADRES KAPI typ TÜR ..." satırı. Satır süzülmez, yeniden
// yazılır: yalnız doğrulanan alanlar alınır, gerisi atılır. Tarayıcıların çözümleyicileri boşluk ve
// sekmede farklı davrandığından, gelen metnin kendisi hiçbir zaman tarayıcıya verilmez.
const ADAY = /^(?:a=)?candidate:([a-z0-9+/]{1,32}) ([12]) udp (\d{1,10}) ([0-9a-z.:-]{1,64}) (\d{1,5}) typ (host|srflx)(?: [\x20-\x7e]*)?$/i;
const YEREL_AD = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local$/i;
const EN_COK_ADAY = 8;

function ipv4Mu(adres) {
  const p = adres.split(".");
  return p.length === 4 && p.every(x => /^(0|[1-9]\d{0,2})$/.test(x) && Number(x) <= 255);
}

// IPv6'nın sekiz grubu (sayı); geçerli değilse null. Noktalı (IPv4 eşlemli) yazım kabul edilmez.
function ipv6Gruplari(adres) {
  const iki = adres.split("::");
  if (iki.length > 2) return null;
  const [a, b] = [iki[0], iki[1] ?? ""].map(x => (x ? x.split(":") : []));
  const eksik = 8 - a.length - b.length;
  if (iki.length === 1 ? eksik !== 0 : eksik < 1) return null;
  if (![...a, ...b].every(x => /^[0-9a-f]{1,4}$/i.test(x))) return null;
  return [...a, ...Array(eksik).fill("0"), ...b].map(x => parseInt(x, 16));
}

// Geçerli adayın adresi, türü ve yeniden yazılmış hâli; geçersizse null.
function adayCoz(satir) {
  const p = satir.match(ADAY);
  if (!p) return null;
  const [, vakif, bilesen, oncelik, adres, kapi, turAdi] = p;
  const tur = turAdi.toLowerCase();
  if (Number(oncelik) > 0xffffffff || !Number(kapi) || Number(kapi) > 65535) return null;
  const v6 = adres.includes(":");
  const ip = v6 ? ipv6Gruplari(adres) : ipv4Mu(adres);
  if (!ip && !(tur === "host" && YEREL_AD.test(adres))) return null;
  // srflx'te tarayıcının eklediği yerel adres (raddr) taşınmaz.
  const ilgili = tur === "srflx" ? ` raddr ${v6 ? "::" : "0.0.0.0"} rport 0` : "";
  return { adres, tur, aday: `candidate:${vakif} ${bilesen} udp ${Number(oncelik)} ${adres} ${Number(kapi)} typ ${tur}${ilgili}` };
}

// Aynı ağın anahtarı: IPv4'te dış adresin kendisi, IPv6'da adresin ilk 64 biti (ağ öneki).
function agAnahtari(adres) {
  return ipv6Gruplari(adres)?.slice(0, 4).map(x => x.toString(16)).join(":") ?? adres;
}

// Karşılaştırmanın iki yuvası: ilk bulunan IPv4 dış adresi ve IPv6 ağ öneki; yoksa boş.
function yuvaAnahtarlari(pc) {
  const hepsi = pc.dis.map(a => agAnahtari(adayCoz(a.candidate).adres));
  return [hepsi.find(a => !a.includes(":")) ?? "", hepsi.find(a => a.includes(":")) ?? ""];
}

// Tutan yuvaların (bit maskesi) anahtarları.
const tutanAnahtarlar = (pc, maske) => yuvaAnahtarlari(pc).filter((a, i) => a && maske & (1 << i));

// Bu cihazın, tutan yuvalardaki dış adresleri.
const paylasilacaklar = (pc, maske) => {
  const izinli = tutanAnahtarlar(pc, maske);
  return pc.dis.filter(a => izinli.includes(agAnahtari(adayCoz(a.candidate).adres))).map(adayPaketi);
};

// Yerel ağ adresi: tarayıcının ".local" takma adı (UUID) ya da özel aralıktaki adres (10/8,
// 172.16/12, 192.168/16, IPv6'da fc00::/7 ve fe80::/10).
function yerelAdresMi(adres) {
  if (YEREL_AD.test(adres)) return true;
  if (ipv4Mu(adres)) {
    const [a, b] = adres.split(".").map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const g = ipv6Gruplari(adres);
  return !!g && ((g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80);
}

// Veri kanalı için gereken SDP öznitelikleri; başkası geçmez.
const SDP_OZNITELIGI = /^a=(group|ice-ufrag|ice-pwd|ice-options|fingerprint|setup|mid|sctp-port|max-message-size):[\x20-\x7e]+$/;

// İki yönde de SDP baştan yazılır: yalnız izin verilen satırlar ve en çok EN_COK_ADAY tane yerel ağ
// adresli "host" adayı kalır. Dış adres (srflx) ayrıca ve yalnız aynı ağda paylaşılır (adaylarSec).
// Karşının yazdığı başka her adres (genel, relay, prflx, TCP, alan adı) atılır: tarayıcı oraya paket
// göndermez, IP adresi de karşıya gitmez. Giden SDP'den de genel adresler çıkar. Satırlar her tür
// satır sonuyla bölünür. "o=", "c=" satırları ve "m=" kapısı adres taşımayan değerlerle yazılır.
// Veri kanalından başka medya bölümü olan SDP bütünüyle reddedilir (boş döner).
function yalnizYerel(sdp) {
  const cikti = [];
  let aday = 0;
  let medya = false;
  for (const l of sdp.split(/\r\n|\r|\n/)) {
    if (l.startsWith("a=candidate:")) {
      const a = adayCoz(l);
      if (a?.tur === "host" && yerelAdresMi(a.adres) && aday++ < EN_COK_ADAY) cikti.push(`a=${a.aday}`);
    } else if (/candidate/i.test(l)) {
      continue;
    } else if (l.startsWith("m=")) {
      if (medya || !/^m=application \d{1,5} UDP\/DTLS\/SCTP webrtc-datachannel$/.test(l)) return "";
      medya = true;
      cikti.push("m=application 9 UDP/DTLS/SCTP webrtc-datachannel");
    } else if (l.startsWith("c=")) {
      cikti.push("c=IN IP4 0.0.0.0");
    } else if (l.startsWith("o=")) {
      const o = l.match(/^o=[!-~]+ (\d{1,20}) (\d{1,20}) IN /);
      cikti.push(`o=- ${o ? o[1] : 0} ${o ? o[2] : 0} IN IP4 127.0.0.1`);
    } else if (l === "v=0" || l === "t=0 0") {
      cikti.push(l);
    } else if (l.startsWith("s=")) {
      cikti.push("s=-");
    } else if (SDP_OZNITELIGI.test(l)) {
      cikti.push(l);
    }
  }
  return cikti.map(l => `${l}\r\n`).join("");
}

const adayPaketi = a => ({ candidate: adayCoz(a.candidate).aday, sdpMid: a.sdpMid, sdpMLineIndex: a.sdpMLineIndex });

// Karşıdan gelen dış adreslerden yalnız anahtarı, tutan yuvadaki anahtarla birebir aynı olanlar
// alınır; aday yeniden yazılır, karşının verdiği bölüm bilgisi kullanılmaz (tek bölüm var).
function adaylarSec(liste, benim) {
  if (!Array.isArray(liste) || !benim.length) return [];
  return liste.slice(0, EN_COK_ADAY)
    .map(a => (typeof a?.candidate === "string" && a.candidate.length < 512 && a.candidate.startsWith("candidate:") ? adayCoz(a.candidate) : null))
    .filter(a => a?.tur === "srflx" && benim.includes(agAnahtari(a.adres)))
    .map(a => ({ candidate: a.aday, sdpMid: null, sdpMLineIndex: 0 }));
}

async function rtcGonder(oturum, mesaj) {
  await baslikGonder(oturum.baglanti, { tip: "rtc", ...mesaj });
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
    if (e.candidate && adayCoz(e.candidate.candidate)?.tur === "srflx") pc.dis.push(e.candidate);
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
  // Aynı anda açık gelen dosya kanalı sayısı sınırlıdır (alma sınırıyla aynı).
  let gelenKanal = 0;
  pc.ondatachannel = e => {
    const kanal = e.channel;
    if (kanal.label !== "dosya" || gelenKanal >= EN_COK_ALINAN) {
      kanal.close();
      return;
    }
    gelenKanal++;
    kanal.addEventListener("close", () => { gelenKanal--; }, { once: true });
    dogrudanAl(kanal, oturum);
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
    pc.karsilastirma = oturum.baglanti.karsilastir(true, ...yuvaAnahtarlari(pc));
    await rtcGonder(oturum, { tur: "teklif", sdp: yalnizYerel(pc.localDescription.sdp), cpace: pc.karsilastirma.ileti() });
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
      await pc.setRemoteDescription({ type: "offer", sdp: yalnizYerel(baslik.sdp) });
      await pc.setLocalDescription(await pc.createAnswer());
      await adaylarHazir(pc);
      const k = oturum.baglanti.karsilastir(false, ...yuvaAnahtarlari(pc));
      pc.karsilastirma = k;
      let etiket = null;
      try {
        etiket = k.etiketler(baslik.cpace);
      } catch (e) {
        console.error(e); // karşılaştırma olmaz; doğrudan bağlantı yalnız yerel adreslerle denenir
      }
      await rtcGonder(oturum, { tur: "yanit", sdp: yalnizYerel(pc.localDescription.sdp), cpace: k.ileti(), etiket });
    } else if (baslik.tur === "yanit" && typeof baslik.sdp === "string" && oturum.rol === "teklif" && pc?.signalingState === "have-local-offer") {
      await pc.setRemoteDescription({ type: "answer", sdp: yalnizYerel(baslik.sdp) });
      const k = pc.karsilastirma;
      pc.karsilastirma = null;
      try {
        const etiket = k.etiketler(baslik.cpace);
        pc.tutan = k.eslesenler(baslik.etiket);
        await rtcGonder(oturum, { tur: "aday", etiket, adaylar: paylasilacaklar(pc, pc.tutan) });
      } finally {
        k.free();
      }
    } else if (baslik.tur === "aday" && oturum.rol === "teklif" && pc?.tutan) {
      for (const a of adaylarSec(baslik.adaylar, tutanAnahtarlar(pc, pc.tutan))) await pc.addIceCandidate(a);
    } else if (baslik.tur === "aday" && oturum.rol === "yanit" && pc?.karsilastirma && pc.signalingState === "stable") {
      const k = pc.karsilastirma;
      pc.karsilastirma = null;
      let tutan;
      try {
        tutan = k.eslesenler(baslik.etiket);
      } finally {
        k.free();
      }
      if (!tutan) return;
      for (const a of adaylarSec(baslik.adaylar, tutanAnahtarlar(pc, tutan))) await pc.addIceCandidate(a);
      await rtcGonder(oturum, { tur: "aday", adaylar: paylasilacaklar(pc, tutan) });
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
      alimBitti(boyut, false);
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
        const istenen = baslik.boyut;
        satir = alimaBasla(ad, istenen, oturum);
        if (!satir) {
          bitti = true;
          kanal.send("buyuk");
          return;
        }
        boyut = istenen;
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
        dosyaHazir(parcalar, ad, satir, boyut);
        alimBitti(boyut, true);
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
// Bir kodla en çok bu kadar doğrulama denemesi yapılabilir; sonra kod kendiliğinden yenilenir.
const KOD_EN_COK_DENEME = 3;
let kodDenemesi = 0;

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
// yanılmayı yavaşlatır: kodu, açık anahtarından geriye doğru bulmak çok pahalı olur. Tuza kodun
// gösterildiği 5 dakikalık dilim katılır; bütün kodlar için önceden hazırlanmış bir tablo yalnız
// o dilimde işe yarar. Kodu yazan taraf dilimi bilmez, olası üç dilimi birden dener (kodlaBaglan).
const KOD_DILIMI = 5 * 60000;
const kodDilimi = () => Math.floor(Date.now() / KOD_DILIMI);

async function kodTohumu(kod, dilim) {
  const malzeme = await crypto.subtle.importKey("raw", new TextEncoder().encode(kod), "PBKDF2", false, ["deriveBits"]);
  const bitler = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(`tulpar/kod/3/${dilim}`), iterations: 200000 },
    malzeme, 256);
  return new Uint8Array(bitler);
}

// --- Doğrulama kodu ---

// Kod, bağlantının TLS oturumundan ve iki tarafın 32 baytlık rastgele değerlerinden türetilir
// (Baglanti.dogrulama). Bağlanan taraf değerinin özetini tanışma mesajında gönderir (taahhüt),
// kabul eden taraf kendi değerini gönderir, bağlanan taraf ancak bundan sonra kendi değerini açar.
// Araya giren biri kodları deneme yanılmayla eşitleyemez; iki ekrandaki kodun tutma olasılığı
// milyonda birdir. Özeti ya da değeri göndermeyen (eski sürüm ya da sahte) taraf kabul edilmez.
const rastgeleDeger = () => crypto.getRandomValues(new Uint8Array(32));
const onaltili = b => [...b].map(x => x.toString(16).padStart(2, "0")).join("");

async function taahhut(deger) {
  const veri = birlestir(new TextEncoder().encode("tulpar taahhut 1 "), deger);
  return onaltili(new Uint8Array(await crypto.subtle.digest("SHA-256", veri)));
}

function degerCoz(metin) {
  if (typeof metin !== "string" || !/^[0-9a-f]{64}$/.test(metin)) return null;
  return new Uint8Array(metin.match(/../g).map(h => parseInt(h, 16)));
}

async function degerGonder(baglanti, deger) {
  await baslikGonder(baglanti, { tip: "dogrulama", deger: onaltili(deger) });
}

// Karşının açtığı bir sonraki akışın başlığı; bağlantı kapandıysa { neden }.
async function sonrakiBaslik(baglanti) {
  const alici = await baglanti.akis_bekle();
  if (!alici) return { neden: await baglanti.kapanis() };
  return (await basligiOku(alici)).baslik;
}

const dogrulamaKodu = (baglanti, bagliDeger, kabulDegeri) => gruplara(baglanti.dogrulama(bagliDeger, kabulDegeri), 3);

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
  // Etkin cihaz değişiyorsa başka cihazlar için süren el sıkışmalar ve açık soru geçersizdir.
  if (hafizaOku(KARSI_HAFIZASI) !== oturum.karsiKimlik) nesil++;
  // Eski bağlantı kapanır. Aynı cihazın yeni bağlantısıysa karşı taraf bunu kopma saymaz;
  // başka bir cihaz kabul edildiyse eski cihaz geri bağlanmaya çalışmaz.
  if (mevcut) mevcut.baglanti.kapat(mevcut.karsiKimlik === oturum.karsiKimlik ? YENILENDI : DEGISTI);
  mevcut = oturum;
  bilerekKesildi = false;
  hafizaYaz(KARSI_HAFIZASI, oturum.karsiKimlik);
  // QR'daki tek kullanımlık değer, bağlantı nasıl kurulursa kurulsun yenilenir: bağlıyken ekranda
  // görülen QR sonradan kullanılamasın.
  qrYenile();
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
  $("dogrulama-kodu").textContent = oturum.kod;
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
    sonBaglantiBitisi = Date.now();
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
    // Ad, bağlanan cihazın kendine verdiği addır; tırnak içinde gösterilir.
    $("onay-metin").textContent = `“${ad}” adlı cihaz bağlanmak istiyor.`;
    $("onay-kod").textContent = kod;
    $("onay-uyari").textContent = mevcut ? `Kabul ederseniz ${mevcut.ad} ile bağlantı kesilir.` : "";
    $("onay-uyari").hidden = !mevcut;
    // Soru birden belirip sayfayı kaydırır; o an başka bir yere dokunmak üzere olan kullanıcı
    // yanlışlıkla kabul etmesin diye "Kabul et" kısa bir süre basılamaz.
    const kabulDugmesi = $("onay-kabul");
    kabulDugmesi.disabled = true;
    setTimeout(() => { if (bekleyenOnay === bitir) kabulDugmesi.disabled = false; }, 1000);
    kabulDugmesi.onclick = () => bitir(true);
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
// - Beklerken kesildiyse, başka bir cihaz kabul edildiyse ya da kimlik değiştiyse (nesil): reddedilir.
async function gelenBaglanti(gelen, d) {
  if (bekleyenBaglanti >= EN_COK_BEKLEYEN) {
    gelen.free();
    return;
  }
  bekleyenBaglanti++;
  let baglanti = null;
  try {
    try {
      baglanti = await zamanAsimi(gelen.tamamla(), BAGLANMA_SURESI);
    } catch (e) {
      console.error(e);
      return;
    }
    elSikismalar.add(baglanti);
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
    let iz = nesil;
    const tanidik = !kodla && karsiKimlik === hafizaOku(KARSI_HAFIZASI);
    // QR'daki değer eşleştiği anda, araya bir bekleme girmeden tüketilir: aynı değerle gelen
    // ikinci bir istek onu kullanamaz.
    const qrIle = !kodla && typeof baslik.sir === "string" && baslik.sir === qrSirri();
    if (qrIle) qrYenile();
    if (!kodla && !qrIle && !tanidik) {
      baglanti.kapat(REDDEDILDI);
      return;
    }
    // Doğrulama değerleri: bağlananın özeti tanışma mesajındaydı; bu taraf kendi değerini gönderir,
    // karşı taraf kendi değerini açar ve özetle karşılaştırılır.
    // Kodla gelen her deneme, bu taraf değerini göndermeden önce sayılır: kodu bilen biri tutmayan
    // denemeyi açmadan bırakıp doğrulama kodunu tekrar tekrar deneyemesin. Sınır dolunca ya da kod
    // yenilenince eski koda gelen istekler reddedilir.
    const kodTukendiyse = () => {
      if (kodla && d === kodDugumu && kodDenemesi >= KOD_EN_COK_DENEME) kodGoster();
    };
    let kod;
    try {
      const karsiTaahhut = baslik.taahhut;
      if (typeof karsiTaahhut !== "string" || !/^[0-9a-f]{64}$/.test(karsiTaahhut)) {
        baglanti.kapat(ESKI);
        return;
      }
      if (kodla && (d !== kodDugumu || ++kodDenemesi > KOD_EN_COK_DENEME)) {
        baglanti.kapat(REDDEDILDI);
        return;
      }
      const benimDeger = rastgeleDeger();
      await degerGonder(baglanti, benimDeger);
      const acilan = await zamanAsimi(sonrakiBaslik(baglanti), TANITIM_SURESI);
      const karsiDeger = acilan.tip === "dogrulama" ? degerCoz(acilan.deger) : null;
      if (!karsiDeger || (await taahhut(karsiDeger)) !== karsiTaahhut) throw new Error("Doğrulama değeri özetle uyuşmuyor");
      kod = dogrulamaKodu(baglanti, karsiDeger, benimDeger);
    } catch (e) {
      console.error(e);
      baglanti.kapat(KAPANDI);
      kodTukendiyse();
      return;
    }
    // Tanıdık cihaz, bu arada tanıdık olmaktan çıkmış olabilir.
    if (!kodla && !qrIle && iz !== nesil) {
      baglanti.kapat(REDDEDILDI);
      return;
    }
    const sor = kodla || qrIle || onayGerekliMi() || (mevcut && mevcut.karsiKimlik !== karsiKimlik);
    if (sor) {
      const soruNesli = nesil;
      const kabul = await onaySor(ad, kod, baglanti);
      if (kabul !== true) {
        // "Bağlantıyı kes" ile kapanan soru, kullanıcının bu cihazı reddetmesi değildir.
        if (kabul !== MESGUL && nesil === soruNesli) engellenenler.set(karsiKimlik, Date.now() + ENGEL_SURESI);
        baglanti.kapat(kabul === MESGUL ? MESGUL : REDDEDILDI);
        kodTukendiyse();
        return;
      }
      // Soru ekrandayken kod başka bir istekle kullanılmış ya da sorulan durum değişmiş olabilir.
      if ((kodla && kodKullanildi) || nesil !== soruNesli) {
        baglanti.kapat(REDDEDILDI);
        return;
      }
      // Onay yeni bir nesil başlatır: ondan önce başlamış el sıkışmalar bu cihazın yerine geçemez.
      iz = ++nesil;
    }
    const gecerli = () => nesil === iz &&
      (sor || (!onayGerekliMi() && (!mevcut || mevcut.karsiKimlik === karsiKimlik)));
    if (kodla) {
      kodKullanildi = true;
      koduGizle();
    }
    // Kodla eşleşmede karşı taraf bu bağlantıyı kapatıp bu sekmenin rastgele anahtarlı asıl
    // adresine yeniden bağlanır; koddan türetilen adres bir daha kullanılmaz.
    try {
      await tanitimGonder(baglanti, { adres: dugum.bilet() });
    } catch (e) {
      console.error(e);
      baglanti.kapat(KAPANDI);
      return;
    }
    if (!gecerli()) {
      baglanti.kapat(REDDEDILDI);
      return;
    }
    // "Onay gerekli" bağlantı gerçekten kurulunca kalkar; yarım kalan bir kabul kapıyı açık bırakmaz.
    onayGerekliYap(false);
    baglandi({ baglanti, ad, karsiKimlik, kod, yeniden: null, dugum: d, rol: "yanit", karsiDogrudan: baslik.dogrudan === 1 });
  } catch (e) {
    console.error(e);
    baglanti?.kapat(KAPANDI);
  } finally {
    elSikismalar.delete(baglanti);
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

// `bilet` birden çok olası bilet de olabilir (kodla bağlanma); ilk kurulan bağlantı kullanılır.
function baglanZamanli(bilet, ms) {
  let gecKaldi = false;
  let kazanan = null;
  const sozler = (Array.isArray(bilet) ? bilet : [bilet]).map(b => dugum.baglan(tumRelaylerle(b)));
  // Süre dolduktan sonra ya da ikinci olarak kurulan bağlantıyı bekleyen yok; açık kalmasın.
  for (const soz of sozler) {
    soz.then(b => {
      if (gecKaldi || kazanan) b.kapat(KAPANDI);
      else kazanan = b;
    }, () => {});
  }
  return zamanAsimi(Promise.any(sozler), ms).catch(e => {
    gecKaldi = true;
    throw e;
  });
}

// Bağlanan taraf: adını (QR'dan geliyorsa tek kullanımlık değerle) gönderir, karşının tanışma
// mesajını (kabul) bekler. Sonuç: "tamam", "reddedildi", "mesgul", "eski", "gecersiz" (beklerken
// durum değişti) ya da "basarisiz".
async function kur(bilet, ms, sir, gecis = false, iz = { nesil, arama: aramaNo }) {
  disariBaglanan++;
  try {
    return await kurIc(bilet, ms, sir, gecis, iz);
  } finally {
    disariBaglanan--;
  }
}

async function kurIc(bilet, ms, sir, gecis, iz) {
  const baglanti = await baglanZamanli(bilet, ms);
  const gecersiz = () => iz.nesil !== nesil || iz.arama !== aramaNo;
  elSikismalar.add(baglanti);
  try {
    if (gecersiz()) {
      baglanti.kapat(KAPANDI);
      return "gecersiz";
    }
    const benimDeger = rastgeleDeger();
    await tanitimGonder(baglanti, { ...(sir ? { sir } : {}), taahhut: await taahhut(benimDeger) });
    if (!gecersiz()) durumYaz("Diğer cihazın onayı bekleniyor…");
    let kod;
    const sonuc = await zamanAsimi((async () => {
      // Önce karşının doğrulama değeri gelir; bu taraf kendi değerini ancak ondan sonra açar.
      const deger = await sonrakiBaslik(baglanti);
      if (deger.tip === "tanitim") return { neden: ESKI };
      const karsiDeger = deger.tip === "dogrulama" ? degerCoz(deger.deger) : null;
      if (!karsiDeger) return deger.neden ? deger : { neden: "beklenmeyen" };
      await degerGonder(baglanti, benimDeger);
      if (gecersiz()) return { neden: "gecersiz" };
      kod = dogrulamaKodu(baglanti, benimDeger, karsiDeger);
      // Karşıda onay sorulursa iki ekrandaki kod karşılaştırılabilsin.
      $("dogrulama-kodu").textContent = kod;
      $("dogrulama").hidden = false;
      const baslik = await sonrakiBaslik(baglanti);
      return baslik.tip === "tanitim" || baslik.neden ? baslik : { neden: "beklenmeyen" };
    })(), ONAY_SURESI);
    if (gecersiz()) {
      baglanti.kapat(KAPANDI);
      if (!mevcut) $("dogrulama").hidden = true;
      return "gecersiz";
    }
    if (sonuc.tip !== "tanitim") {
      baglanti.kapat(KAPANDI);
      if (!mevcut) $("dogrulama").hidden = true;
      return sonuc.neden === REDDEDILDI ? "reddedildi" : sonuc.neden === MESGUL ? "mesgul"
        : sonuc.neden === ESKI ? "eski" : "basarisiz";
    }
    // Karşı taraf asıl adresini bildirir; yeniden bağlanmalarda o kullanılır. Kodla bağlanmada
    // (birden çok olası bilet) asıl adres zorunludur.
    const yeniden = adresGecerli(sonuc.adres) ? sonuc.adres : Array.isArray(bilet) ? null : bilet;
    if (!yeniden) throw new Error("Asıl adres gelmedi");
    hafizaYaz(BILET_HAFIZASI, yeniden);
    if (yeniden.split("~")[0] !== baglanti.karsi_kimlik()) {
      // Kodla eşleşme kabul edildi: koddan türetilen adresten karşının asıl adresine geçilir.
      // Koddan türetilen kimlik hiçbir yerde "tanıdık" olarak saklanmaz.
      if (gecis) throw new Error("Asıl adrese geçilemedi");
      baglanti.kapat(GECIS);
      durumYaz("Bağlanılıyor…");
      return kur(yeniden, ms, undefined, true, iz);
    }
    baglandi({ baglanti, ad: adDuzelt(sonuc.ad), karsiKimlik: baglanti.karsi_kimlik(), kod, yeniden, dugum: null, rol: "teklif", karsiDogrudan: sonuc.dogrudan === 1 });
    return "tamam";
  } catch (e) {
    baglanti.kapat(KAPANDI);
    if (!mevcut) $("dogrulama").hidden = true;
    throw e;
  } finally {
    elSikismalar.delete(baglanti);
  }
}

const MESGUL_METNI = "Diğer cihaz başka bir isteği yanıtlıyor. Biraz sonra tekrar deneyin.";
const ESKI_METNI = "Diğer cihazdaki Tulpar sayfası eski bir sürüm. O sayfayı yenileyin.";

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
  let eski = false;
  const arama = aramaNo;
  const birak = () => mevcut || bilerekKesildi || arama !== aramaNo;
  for (let deneme = 1; Date.now() - baslangic < YENIDEN_TOPLAM_SURE; deneme++) {
    while (document.hidden) await bekle(1000);
    if (birak()) return;
    if (!eski) durumYaz(`Bağlantı koptu. Yeniden bağlanılıyor… (${deneme}. deneme)`, "hata");
    try {
      const sonuc = await kur(bilet, YENIDEN_SURESI);
      // Diğer sayfa yenilenince aynı kimlikle açılır; denemeye devam edilir.
      eski = sonuc === "eski";
      if (sonuc === "tamam" || birak()) return;
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
      if (birak()) return;
      durumYaz(eski ? ESKI_METNI : `Bağlantı koptu. Yeniden bağlanmaya kalan süre: ${sureYaz(sonraki - Date.now())}`, "hata");
      await bekle(Math.min(1000, sonraki - Date.now()));
    }
    ara = Math.min(ara * 2, YENIDEN_EN_UZUN_ARA);
  }
  if (birak()) return;
  durumYaz(hataMetni, "hata");
  bagliDegilGoster(bilet);
}

// Sonuç: bağlantı kurulduysa (ya da yerini başka bir bağlantı aldıysa) true.
async function bilettenBaglan(bilet, hataMetni, sir) {
  const arama = ++aramaNo;
  // Beklerken başka bir cihaz bağlandıysa ya da yeni bir bağlanma başladıysa ekran artık onundur.
  const devralindi = () => mevcut || arama !== aramaNo;
  durumYaz("Bağlanılıyor…");
  $("yeniden").hidden = true;
  $("yeniden-dugme").onclick = () => bilettenBaglan(bilet, hataMetni, sir);
  try {
    const sonuc = await kur(bilet, BAGLANMA_SURESI, sir);
    if (sonuc === "tamam" || devralindi()) return true;
    if (sonuc === "reddedildi") {
      reddedildiYaz(bilet, hataMetni);
      return false;
    }
    if (sonuc === "eski") {
      durumYaz(ESKI_METNI, "hata");
      $("yeniden").hidden = false;
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
  if (devralindi()) return true;
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
    const soz = kodTohumu(kod, kodDilimi()).then(t => Dugum.baslat(t));
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
  kodDenemesi = 0;
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
  // Kod, gösterildiği dilime göre türetildi: 5 dakika geçerli olduğu için o dilim bu dilim ya da
  // bir önceki olabilir; saat farkı için bir sonraki de denenir.
  const simdi = kodDilimi();
  const oncekiNesil = nesil;
  const tohumlar = await Promise.all([simdi, simdi - 1, simdi + 1].map(d => kodTohumu(kod, d)));
  if (mevcut || nesil !== oncekiNesil) return; // kod hazırlanırken başka bir cihaz kabul edildi
  const bilet = tohumlar.map(t => Dugum.koddan_bilet(t));
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

// QR'dan gelen bilgiyi (sayfa açılırken adres çubuğundan silindi) okur. Sayfa yenilenirse aynı sekmede
// yeniden bağlanabilmek için adres sekme hafızasında tutulur.
function biletiAl() {
  const hash = ILK_ADRES_BILGISI;
  if (hash) {
    const { bilet, sir } = biletAc(hash);
    hafizaYaz(BILET_HAFIZASI, bilet);
    return { bilet, sir, kaynak: "adres" };
  }
  const bilet = hafizaOku(BILET_HAFIZASI);
  return bilet && adresGecerli(bilet.split("~").slice(0, 2).join("~")) ? { bilet, kaynak: "hafiza" } : null;
}

function qrGoster() {
  const adres = `${SAYFA_ADRESI}#${biletKisalt(dugum.bilet())}.${qrSirri()}`;
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
  // Cloudflare'in ikinci adresinde (tulpar-24u.pages.dev) ve eski sürümlerin adreslerinde çalışma:
  // tulpar.page kapatıldığında site başka bir adresten kullanılamasın. Yerel adresler test için.
  if (!["tulpar.page", "appassets.androidplatform.net", "localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
    durumYaz("Bu sayfa yalnızca tulpar.page adresinde çalışır.", "hata");
    return;
  }
  adiGoster();
  const sekmeHazir = sekmeyiHazirla();
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
  await sekmeHazir;
  // Yenilemeden sonra son bağlanan cihaz bu sekmeyi bir süre daha arayabilir; kimlik hemen yenilenmez.
  if (hafizaOku(KARSI_HAFIZASI)) sonBaglantiBitisi = Date.now();
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
// Dosyaların gideceği cihaz, seçim ekranı açılırken bağlı olan cihazdır: seçim sürerken başka bir
// cihaz bağlanırsa ona gönderilmez.
let secimHedefi = null;
$("sec").onclick = () => {
  secimHedefi = simdikiHedef();
  $("dosyalar").click();
};
$("dosyalar").onchange = e => {
  dosyalariSirala([...e.target.files], secimHedefi ?? simdikiHedef());
  secimHedefi = null;
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
  if (mevcut) dosyalariSirala([...e.dataTransfer.files], simdikiHedef());
});

// Bilerek kesince karşı taraf kendiliğinden yeniden bağlanmaz; iki taraftan biri yeniden
// bağlanmak isterse diğerinde onay sorulur (bu bilgi sayfa yenilense de kalır). Kimlik sekme
// boyunca aynı kalır; QR'daki tek kullanımlık değer yenilenir.
$("kes").onclick = () => {
  bilerekKesildi = true;
  nesil++;
  onayGerekliYap(true);
  hafizaSil(BILET_HAFIZASI);
  qrYenile();
  mevcut?.baglanti.kapat(KESILDI);
  for (const baglanti of elSikismalar) baglanti.kapat(REDDEDILDI);
  koduBirak();
};

// Biten bir aktarımı listeden siler ve alınan dosyanın bellekteki kopyasını bırakır.
function satiriSil(li) {
  const kaydet = li.querySelector(".ek .kaydet");
  if (kaydet?.disabled) return; // uygulama dosyayı yazıyor
  if (kaydet) bellegiBirak(kaydet);
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
