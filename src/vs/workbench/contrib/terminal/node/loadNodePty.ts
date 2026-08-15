// Загрузчик нативного node-pty с двумя путями:
//   - dev (tsx/npm): обычный require из node_modules;
//   - SEA (single executable): нативные файлы node-pty вшиты в бинарь как ассет
//     `node-pty.bundle`; на первом запуске распаковываем их во временный каталог и
//     грузим оттуда через createRequire (нативный `.node` нельзя вшить в JS-blob —
//     `process.dlopen` требует файл на диске). См. docs/TODO/IntegratedTerminal.md.
//
// Формат `node-pty.bundle` совпадает с pack-assets.mjs / AssetBundleFormat.ts:
//   [magic 8B "DIODEBND"][headerLen uint32 LE][header JSON][data …]
// header = { version, files: { <virtualPath>: { offset, size } } }.

import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from "node-pty";

import { isSeaBinary } from "../../../../base/node/isSea.ts";

export type PtySpawn = (
    file: string,
    args: string[] | string,
    options: IPtyForkOptions | IWindowsPtyForkOptions,
) => IPty;

export interface NodePtyModule {
    spawn: PtySpawn;
}

const MAGIC = "DIODEBND";
const ASSET_NAME = "node-pty.bundle";

let cached: NodePtyModule | null = null;

/** Загрузить node-pty (dev — из node_modules; SEA — распаковав ассет в tmp). */
export function loadNodePty(): NodePtyModule {
    if (cached) return cached;
    cached = isSeaBinary() ? loadFromSeaAsset() : loadFromNodeModules();
    return cached;
}

function loadFromNodeModules(): NodePtyModule {
    const require = createRequire(import.meta.url);
    return require("node-pty") as NodePtyModule;
}

function loadFromSeaAsset(): NodePtyModule {
    // `node:sea` доступен только через require внутри SEA (статический ESM-импорт падает).
    const seaRequire = createRequire("file:///");
    const sea = seaRequire("node:sea") as { getAsset(key: string): ArrayBuffer };
    const bundle = Buffer.from(sea.getAsset(ASSET_NAME));

    // Каталог с суффиксом по размеру ассета — авто-инвалидация при пересборке.
    const targetDir = join(tmpdir(), `diode-embedded-pty-${String(bundle.length)}`);
    const nodePtyDir = join(targetDir, "node-pty");
    const readyMarker = join(nodePtyDir, ".diode-ready");

    if (!existsSync(readyMarker)) {
        extractBundle(bundle, targetDir);
        writeFileSync(readyMarker, "");
    }

    const require = createRequire(join(nodePtyDir, "package.json"));
    return require(nodePtyDir) as NodePtyModule;
}

function extractBundle(bundle: Buffer, targetDir: string): void {
    const magic = bundle.toString("latin1", 0, MAGIC.length);
    if (magic !== MAGIC) throw new Error("node-pty.bundle: bad magic");

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
        // Нативный аддон и spawn-helper (macOS) должны быть исполняемыми/загружаемыми.
        if (virtualPath.endsWith(".node") || virtualPath.endsWith("spawn-helper")) {
            chmodSync(dest, 0o755);
        }
    }
}
