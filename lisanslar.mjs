// WebAssembly çekirdeğine gömülen Rust paketlerinin ve docs/lib altındaki kütüphanelerin lisans
// metinlerini docs/THIRD_PARTY_LICENSES.txt dosyasında toplar. Aynı metinler bir kez yazılır.
// Kullanım: node lisanslar.mjs   (npm run lisanslar)
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const kok = dirname(fileURLToPath(import.meta.url));
const veri = JSON.parse(execFileSync("cargo", [
  "metadata", "--format-version", "1", "--locked", "--filter-platform", "wasm32-unknown-unknown",
], { cwd: join(kok, "wasm"), maxBuffer: 64 * 1024 * 1024 }).toString());

// Yalnız derlemeye giren (normal) bağımlılıklar; derleme araçları ve test bağımlılıkları dışarıda.
const dugumler = new Map(veri.resolve.nodes.map(n => [n.id, n]));
const paketler = new Map(veri.packages.map(p => [p.id, p]));
const gerekli = new Set();
const sira = [veri.resolve.root];
while (sira.length) {
  const id = sira.pop();
  if (gerekli.has(id)) continue;
  gerekli.add(id);
  for (const b of dugumler.get(id).deps) {
    if (b.dep_kinds.some(k => k.kind === null)) sira.push(b.pkg);
  }
}
gerekli.delete(veri.resolve.root);

const metinler = new Map(); // özet -> { metin, paketler[] }
const lisanssiz = [];
for (const id of gerekli) {
  const p = paketler.get(id);
  const klasor = dirname(p.manifest_path);
  const dosyalar = readdirSync(klasor).filter(a => /^(licen[cs]e|copying|notice)/i.test(a)).sort();
  const ad = `${p.name} ${p.version} (${p.license ?? "lisans belirtilmemiş"})`;
  if (!dosyalar.length) lisanssiz.push(ad);
  for (const dosya of dosyalar) {
    const metin = readFileSync(join(klasor, dosya), "utf8").replace(/\r\n/g, "\n").trim();
    const ozet = createHash("sha256").update(metin).digest("hex");
    if (!metinler.has(ozet)) metinler.set(ozet, { metin, paketler: [] });
    metinler.get(ozet).paketler.push(`${ad}: ${dosya}`);
  }
}

const cizgi = "=".repeat(78);
const parcalar = [
  "Tulpar, aşağıdaki açık kaynak yazılımları içerir. Her bölümde bir lisans metni ve o metni",
  "kullanan paketler listelenir.",
  "",
  cizgi,
  "qrcode-generator 1.4.4 (MIT), docs/lib/qrcode.js",
  "Copyright (c) 2009 Kazuhiko Arase. Licensed under the MIT license:",
  "http://www.opensource.org/licenses/mit-license.php",
];
for (const { metin, paketler: liste } of [...metinler.values()].sort((a, b) => a.paketler[0].localeCompare(b.paketler[0]))) {
  parcalar.push("", cizgi, ...liste.sort(), "", metin);
}
if (lisanssiz.length) {
  parcalar.push("", cizgi, "Lisans dosyası bulunmayan paketler (lisans türü Cargo.toml'dan):", ...lisanssiz.sort());
}
writeFileSync(join(kok, "docs", "THIRD_PARTY_LICENSES.txt"), parcalar.join("\n") + "\n");
console.log(`${gerekli.size} paket, ${metinler.size} farklı lisans metni yazıldı.`);
