// Где лежит и откуда берётся бинарь для текущей платформы.
//
// Пакет тонкий: в npm уезжают только эти файлы, а сам редактор (50–160 МБ, внутри
// свой Node) скачивается из GitHub Releases того же тега, что и версия пакета,
// в `vendor/` рядом с пакетом. sha256 сверяется с сайдкаром `<asset>.sha256`
// из релиза.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "diode-editor/diode";
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function packageVersion() {
    return JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")).version;
}

export function assetName(platform = process.platform, arch = process.arch) {
    const os = { linux: "linux", darwin: "macos", win32: "windows" }[platform];
    const cpu = { x64: "x64", arm64: "arm64" }[arch];
    if (!os || !cpu) throw new Error(`diode: no prebuilt binary for ${platform}-${arch}`);
    if (os === "windows" && cpu !== "x64") throw new Error("diode: Windows builds exist for x64 only");
    return `diode-${os}-${cpu}${os === "windows" ? ".exe" : ""}`;
}

export function binaryPath() {
    return join(pkgRoot, "vendor", process.platform === "win32" ? "diode.exe" : "diode");
}

export function isInstalled() {
    return existsSync(binaryPath());
}

async function fetchBytes(url) {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`diode: ${response.status} ${response.statusText} for ${url}`);
    return Buffer.from(await response.arrayBuffer());
}

/**
 * Скачивает бинарь релиза `v<version>` в `vendor/`. Бросает при сетевой ошибке или
 * несовпадении sha256; отсутствие сайдкара (старые релизы) — предупреждение.
 */
export async function download({ version = packageVersion(), log = console.error } = {}) {
    const asset = assetName();
    const base = `https://github.com/${REPO}/releases/download/v${version}/${asset}`;
    log(`diode: downloading ${base}`);
    const bytes = await fetchBytes(base);

    let expected = null;
    try {
        expected = (await fetchBytes(`${base}.sha256`)).toString("utf8").trim().split(/\s+/)[0];
    } catch {
        log("diode: no checksum published for this release, skipping verification");
    }
    if (expected) {
        const actual = createHash("sha256").update(bytes).digest("hex");
        if (actual !== expected)
            throw new Error(`diode: sha256 mismatch for ${asset}: expected ${expected}, got ${actual}`);
    }

    const target = binaryPath();
    mkdirSync(dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, bytes);
    chmodSync(tmp, 0o755);
    renameSync(tmp, target);
    log(`diode: installed ${target}`);
    return target;
}
