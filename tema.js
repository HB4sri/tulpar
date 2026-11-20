// Tema seçimi (Sistem / Açık / Koyu). Sayfa çizilmeden önce uygulanır ki yanlış renkte bir an
// bile görünmesin; bu yüzden <head> içinde, modül olmadan yüklenir. Seçim bu cihazda saklanır.
(() => {
  const AD = "tulpar-tema";
  const RENK = { acik: "#112d4e", koyu: "#090d14" };
  const kok = document.documentElement;

  function oku() {
    try { return localStorage.getItem(AD) || "sistem"; } catch { return "sistem"; }
  }

  function uygula(tema) {
    if (tema === "acik" || tema === "koyu") kok.dataset.tema = tema;
    else delete kok.dataset.tema;
    // Tarayıcı çubuğunun rengi de seçime uysun.
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      const sistemKoyu = meta.media.includes("dark");
      meta.content = tema === "sistem" ? (sistemKoyu ? RENK.koyu : RENK.acik) : RENK[tema];
    }
    for (const d of document.querySelectorAll("[data-tema-sec]")) {
      d.setAttribute("aria-checked", String(d.dataset.temaSec === tema));
    }
  }

  uygula(oku());
  document.addEventListener("DOMContentLoaded", () => {
    uygula(oku());
    for (const d of document.querySelectorAll("[data-tema-sec]")) {
      d.addEventListener("click", () => {
        const tema = d.dataset.temaSec;
        try { localStorage.setItem(AD, tema); } catch {}
        uygula(tema);
      });
    }
  });
})();
