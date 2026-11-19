// Tanılama: tarayıcının Tulpar'ı çalıştırıp çalıştıramadığını ve n0'ın aktarma sunucularına
// ulaşılıp ulaşılamadığını kontrol eder. Yalnızca Tulpar'ın zaten kullandığı sunuculara bağlanır;
// hiçbir bilgi gönderilmez ya da kaydedilmez.

const $ = id => document.getElementById(id);
const SURE = 8000;

// Uygulamanın kullandığı sunucularla aynı (wasm/src/lib.rs, RELAYLER).
const SUNUCULAR = [
  ["Avrupa", "euc1-1.relay.n0.iroh.link"],
  ["ABD (doğu)", "use1-1.relay.n0.iroh.link"],
  ["ABD (batı)", "usw1-1.relay.n0.iroh.link"],
  ["Asya", "aps1-1.relay.n0.iroh.link"],
];

// En küçük geçerli WebAssembly modülü (yalnızca başlık).
const BOS_MODUL = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const WASM_YOK = "WebAssembly çalışmıyor. iPhone'da Kilitlenme Modu açıksa Tulpar çalışmaz.";

async function tarayici() {
  try {
    if (typeof WebAssembly !== "object") return { durum: "kapali", detay: WASM_YOK };
    await WebAssembly.compile(BOS_MODUL);
    return { durum: "acik", detay: "Uygun" };
  } catch {
    return { durum: "kapali", detay: WASM_YOK };
  }
}

// Sunucuya WebSocket (WSS, 443) ile bağlanmayı dener; açılırsa süreyi döndürür.
function wsAcilir(url, protokoller) {
  return new Promise(coz => {
    const t0 = performance.now();
    let ws;
    try { ws = new WebSocket(url, protokoller); } catch { return coz({ ms: 0, zaman: false }); }
    const zaman = setTimeout(() => { ws.close(); coz({ ms: 0, zaman: true }); }, SURE);
    ws.onopen = () => {
      clearTimeout(zaman);
      ws.close();
      coz({ ms: Math.max(1, Math.round(performance.now() - t0)), zaman: false });
    };
    ws.onerror = () => { clearTimeout(zaman); coz({ ms: 0, zaman: false }); };
  });
}

async function sunucu(adres) {
  let zamanAsimi = false;
  for (const protokoller of [["iroh-relay-v1"], []]) {
    const { ms, zaman } = await wsAcilir(`wss://${adres}/relay`, protokoller);
    if (ms) return { durum: "acik", detay: `Ulaşıldı (${ms} ms)` };
    zamanAsimi ||= zaman;
  }
  return { durum: "kapali", detay: zamanAsimi ? "Yanıt gelmedi" : "Ulaşılamadı" };
}

const KONTROLLER = [
  { ad: "Tarayıcı", tur: "tarayici", calis: tarayici },
  ...SUNUCULAR.map(([bolge, adres]) => ({ ad: `Aktarma sunucusu: ${bolge}`, tur: "sunucu", calis: () => sunucu(adres) })),
];

let sonuclar = [];

function ciz() {
  const liste = $("kontroller");
  liste.replaceChildren(...KONTROLLER.map((k, i) => {
    const li = document.createElement("li");
    const s = sonuclar[i];
    if (s) li.dataset.durum = s.durum;
    const ad = document.createElement("span");
    ad.className = "tani-ad";
    ad.textContent = k.ad;
    const sonuc = document.createElement("span");
    sonuc.className = "tani-sonuc";
    sonuc.textContent = s ? s.detay : "";
    li.append(ad, sonuc);
    return li;
  }));
}

function ozetYaz() {
  const tarayiciTamam = sonuclar[0]?.durum === "acik";
  const sunucuSonuclari = sonuclar.filter((_, i) => KONTROLLER[i].tur === "sunucu");
  const acik = sunucuSonuclari.filter(s => s.durum === "acik").length;
  let metin;
  if (!tarayiciTamam) metin = "Bu tarayıcı Tulpar'ı çalıştıramıyor. Başka bir tarayıcı deneyin.";
  else if (acik === sunucuSonuclari.length) metin = "Her şey yolunda. Tulpar bu cihazda ve bu ağda çalışır.";
  else if (acik > 0) metin = "Bazı aktarma sunucularına ulaşılamadı. Tulpar ulaşılabilen sunucuları kullanır.";
  else metin = "Hiçbir aktarma sunucusuna ulaşılamadı. Bu ağ Tulpar'ın bağlantısını engelliyor olabilir. Başka bir ağ deneyin ya da ağ yöneticisine sorun.";
  const ozet = $("ozet");
  ozet.textContent = metin;
  ozet.classList.toggle("hata", !tarayiciTamam || acik === 0);
  ozet.hidden = false;
}

async function kontrolEt() {
  const dugme = $("basla");
  dugme.disabled = true;
  dugme.textContent = "Kontrol ediliyor…";
  $("ozet").hidden = true;
  $("kopyala").hidden = true;
  sonuclar = [];
  ciz();
  for (let i = 0; i < KONTROLLER.length; i++) {
    try {
      sonuclar[i] = await KONTROLLER[i].calis();
    } catch {
      sonuclar[i] = { durum: "kapali", detay: "Ulaşılamadı" };
    }
    ciz();
  }
  ozetYaz();
  dugme.disabled = false;
  dugme.textContent = "Yeniden kontrol et";
  $("kopyala").hidden = false;
}

function surumAdi() {
  const s = $("surum").dataset.surum;
  return /^\d+\.\d+\.\d+$/.test(s) ? "v" + s : "geliştirme";
}

async function kopyala() {
  const dugme = $("kopyala");
  const satirlar = [
    "Tulpar tanılama",
    `Sürüm: ${surumAdi()}`,
    `Tarih: ${new Date().toLocaleString("tr-TR")}`,
    `Tarayıcı bilgisi: ${navigator.userAgent}`,
    ...KONTROLLER.map((k, i) => `${k.ad}: ${sonuclar[i]?.detay ?? "-"}`),
    `Özet: ${$("ozet").textContent}`,
  ];
  try {
    await navigator.clipboard.writeText(satirlar.join("\n"));
    dugme.textContent = "Kopyalandı";
  } catch {
    dugme.textContent = "Kopyalanamadı";
  }
  setTimeout(() => { dugme.textContent = "Sonuçları kopyala"; }, 2000);
}

$("surum").textContent = `Tulpar · HB4sri · ${surumAdi()}`;
$("basla").onclick = kontrolEt;
$("kopyala").onclick = kopyala;
ciz();
