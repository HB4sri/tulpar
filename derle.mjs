// Rust çekirdeğini WebAssembly'ye derler ve docs/pkg altına JavaScript bağlantılarını üretir.
// Kullanım: node derle.mjs   (npm run derle)
//
// Derlenen dosyaya kişisel klasör yolları (kullanıcı adı) girmesin diye yollar nötr adlarla
// değiştirilir (--remap-path-prefix). Bu yüzden derleme ayarları burada, ortam değişkenleriyle verilir.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const kok = dirname(fileURLToPath(import.meta.url));
const ev = homedir();
const windows = process.platform === "win32";
const env = { ...process.env };

// ring, WebAssembly için C kodu derliyor. CC_wasm32_unknown_unknown verilmemişse
// ~/.araclar altındaki wasi-sdk'nın clang'i (yönetici izni gerektirmez) kullanılır.
const araclar = join(ev, ".araclar");
const wasiSdk = existsSync(araclar) && readdirSync(araclar).find(a => a.startsWith("wasi-sdk-"));
if (wasiSdk && !env.CC_wasm32_unknown_unknown) {
  const bin = join(araclar, wasiSdk, "bin");
  env.CC_wasm32_unknown_unknown = join(bin, windows ? "clang.exe" : "clang");
  env.AR_wasm32_unknown_unknown = join(bin, windows ? "llvm-ar.exe" : "llvm-ar");
}

// CARGO_ENCODED_RUSTFLAGS, .cargo/config.toml'daki rustflags'in yerine geçer; bayraklar 0x1F ile ayrılır
// (klasör adlarında boşluk olabildiği için).
env.CARGO_ENCODED_RUSTFLAGS = [
  '--cfg=getrandom_backend="wasm_js"',
  `--remap-path-prefix=${env.CARGO_HOME || join(ev, ".cargo")}=/cargo`,
  `--remap-path-prefix=${env.RUSTUP_HOME || join(ev, ".rustup")}=/rustup`,
  `--remap-path-prefix=${kok}=/tulpar`,
].join("\x1f");

const calistir = (komut, argumanlar, cwd) => execFileSync(komut, argumanlar, { cwd, env, stdio: "inherit" });

calistir("cargo", ["build", "--release", "--locked"], join(kok, "wasm"));
calistir("wasm-bindgen", [
  join(kok, "wasm", "target", "wasm32-unknown-unknown", "release", "tulpar_cekirdek.wasm"),
  "--out-dir", join(kok, "docs", "pkg"),
  "--target", "web",
  "--no-typescript",
], kok);
