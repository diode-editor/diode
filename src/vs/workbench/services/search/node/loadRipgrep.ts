// Загрузчик бинаря ripgrep (`rg`) с двумя путями, ровно как loadNodePty:
//   - dev (tsx/npm): путь из пакета @vscode/ripgrep (он же кладёт per-platform
//     бинарь в node_modules);
//   - SEA (single executable): бинарь вшит в exe как ассет `rg.bundle`; на первом
//     запуске распаковываем его во временный каталог и запускаем оттуда
//     (исполняемый файл нельзя запустить из JS-blob — нужен файл на диске).
//
// Формат `rg.bundle` совпадает с pack-assets.mjs / loadNodePty.ts:
//   [magic 8B "VEXXBND\0"][headerLen uint32 LE][header JSON][data …]
// header = { version, files: { <virtualPath>: { offset, size } } }.

import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { isSeaBinary } from "../../../../base/node/isSea.ts";

const MAGIC = "VEXXBND\0";
const ASSET_NAME = "rg.bundle";
/** Имя бинаря внутри бандла — платформозависимо (совпадает с pack-ripgrep.mjs). */
const RG_BINARY_NAME = process.platform === "win32" ? "rg.exe" : "rg";

let cached: string | null = null;

/**
 * Возвращает абсолютный путь к исполняемому `rg`.
 * dev — из пакета @vscode/ripgrep; SEA — распаковав ассет `rg.bundle` в tmp.
 * Результат кэшируется на процесс.
 */
export function loadRipgrepPath(): string {
    if (cached !== null) return cached;
    cached = isSeaBinary() ? loadFromSeaAsset() : loadFromNodeModules();
    return cached;
}

function loadFromNodeModules(): string {
    const require = createRequire(import.meta.url);
    const { rgPath } = require("@vscode/ripgrep") as { rgPath: string };
    return rgPath;
}

function loadFromSeaAsset(): string {
    // `node:sea` доступен только через require внутри SEA (статический ESM-импорт падает).
    const seaRequire = createRequire("file:///");
    const sea = seaRequire("node:sea") as { getAsset(key: string): ArrayBuffer };
    const bundle = Buffer.from(sea.getAsset(ASSET_NAME));

    // Каталог с суффиксом по размеру ассета — авто-инвалидация при пересборке.
    const targetDir = join(tmpdir(), `vexx-embedded-rg-${String(bundle.length)}`);
    const rgPath = join(targetDir, RG_BINARY_NAME);
    const readyMarker = join(targetDir, ".vexx-ready");

    if (!existsSync(readyMarker)) {
        extractBundle(bundle, targetDir);
        writeFileSync(readyMarker, "");
    }

    return rgPath;
}

function extractBundle(bundle: Buffer, targetDir: string): void {
    const magic = bundle.toString("latin1", 0, MAGIC.length);
    if (magic !== MAGIC) throw new Error("rg.bundle: bad magic");

    const headerLen = bundle.readUInt32LE(MAGIC.length);
    const headerStart = MAGIC.length + 4;
    const header = JSON.parse(bundle.toString("utf-8", headerStart, headerStart + headerLen)) as {
        version: number;
        files: Record<string, { offset: number; size: number }>;
    };
    const dataStart = headerStart + headerLen;

    for (const [virtualPath, { offset, size }] of Object.entries(header.files)) {
        const dest = join(targetDir, virtualPath);
        mkdirSync(dirname(dest), { recursive: true });
        const start = dataStart + offset;
        writeFileSync(dest, bundle.subarray(start, start + size));
        // Бинарь rg должен быть исполняемым после распаковки.
        chmodSync(dest, 0o755);
    }
}
