#!/usr/bin/env node
/**
 * Упаковка рантайм-раскладки нативного `node-pty` в ассет `node-pty.bundle`.
 *
 * Нативный аддон (`pty.node`) нельзя вшить в JS-blob SEA — `process.dlopen`
 * требует файл на диске. Поэтому пакуем `package.json` + рантайм-JS (`lib/**`) +
 * нативы в тот же bundle-формат, что и `diode.bundle` (см. pack-assets.mjs), а на
 * первом запуске `loadNodePty.ts` распаковывает ассет в `os.tmpdir()` и грузит
 * через `createRequire`.
 *
 * Виртуальные пути внутри бандла обязаны совпадать с ожиданиями
 * `src/Workbench/Services/Terminal/loadNodePty.ts`: он распаковывает ассет в
 * `tmpdir()/diode-embedded-pty-<size>/` и делает `require` из
 * `<targetDir>/node-pty` — значит каждая запись пакуется с префиксом
 * `node-pty/` (`node-pty/package.json`, `node-pty/lib/…`, `node-pty/build/Release/…`).
 *
 * Откуда берутся нативы — решает сам node-pty: его `lib/utils.js` ищет их в
 * `build/Release` → `build/Release` → `prebuilds/<platform>-<arch>`. На Linux
 * install компилирует аддон (`build/Release`), на macOS/Windows приезжают готовые
 * `prebuilds/<platform>-<arch>` (в npm-пакете). Поэтому пакуем оба каталога, какие
 * есть: относительная раскладка сохраняется, и тот же резолв срабатывает после
 * распаковки. SEA пер-платформенный по природе — бандл собирается на своей ОС.
 *
 * Верифицированы **linux-x64 и linux-arm64** (linux собирается нативно на CI-раннере
 * своей архитектуры, поэтому натив всегда хостовой архи); на macOS/Windows раскладка
 * пакуется, но не проверена end-to-end (spawn-helper+codesign на Mac, ConPTY и выбор
 * шелла по COMSPEC на Windows) — это доведёт отдельная задача, см. docs/TODO/IntegratedTerminal.md.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, posix, relative, resolve, sep } from "node:path";

import { packBundle } from "./pack-assets.mjs";

/** Рекурсивный обход каталога с фильтром; возвращает абсолютные пути к файлам. */
function walkFiles(rootDir, filter) {
    /** @type {string[]} */
    const out = [];
    /** @param {string} dir */
    function walk(dir) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && filter(full)) out.push(full);
        }
    }
    walk(rootDir);
    return out;
}

/**
 * Собирает `node-pty.bundle` из рантайм-файлов node-pty.
 *
 * @param {{ repoRoot: string }} params
 * @returns {{ bundle: Buffer, inputs: { virtualPath: string, data: Buffer }[], nodePtyRoot: string }}
 */
export function buildNodePtyBundle({ repoRoot }) {
    // Резолвим относительно repoRoot, чтобы бандл собирался из node_modules сборки,
    // а не из места, где лежит этот скрипт.
    const requireFromRoot = createRequire(join(repoRoot, "package.json"));
    const nodePtyRoot = requireFromRoot.resolve("node-pty/package.json").replace(/package\.json$/, "");

    /** @type {{ virtualPath: string, data: Buffer }[]} */
    const inputs = [];
    const addFile = (absPath) => {
        const rel = relative(nodePtyRoot, absPath).split(sep).join(posix.sep);
        inputs.push({ virtualPath: `node-pty/${rel}`, data: readFileSync(absPath) });
    };

    // package.json — точка входа require (main/exports).
    addFile(join(nodePtyRoot, "package.json"));

    // lib/**: только рантайм-JS (без .map и *.test.js).
    const libFiles = walkFiles(
        join(nodePtyRoot, "lib"),
        (p) => p.endsWith(".js") && !p.endsWith(".test.js") && !p.endsWith(".js.map"),
    ).sort();
    for (const filePath of libFiles) addFile(filePath);

    // Нативы: те же каталоги, в которых их ищет сам node-pty (lib/utils.js), и в том
    // же порядке. Linux — скомпилированный на install `build/Release`; macOS/Windows —
    // готовые `prebuilds/<platform>-<arch>` из npm-пакета (там же spawn-helper для Mac
    // и ConPTY-набор для Windows). Берём каждый каталог, который есть: раскладка
    // относительно node-pty сохраняется, поэтому после распаковки резолв тот же.
    // .pdb — виндовые debug-символы (десятки МБ), в рантайме не нужны.
    const nativeDirs = [
        join(nodePtyRoot, "build", "Release"),
        join(nodePtyRoot, "prebuilds", `${process.platform}-${process.arch}`),
    ];
    let nativeCount = 0;
    for (const dir of nativeDirs) {
        if (!existsSync(dir)) continue;
        for (const filePath of walkFiles(dir, (p) => !p.endsWith(".pdb")).sort()) {
            addFile(filePath);
            nativeCount++;
        }
    }
    if (nativeCount === 0) {
        throw new Error(
            `[pack-node-pty] нативы node-pty не найдены (искали ${nativeDirs.join(", ")}) — ` +
                `соберите node-pty под текущую платформу`,
        );
    }

    const bundle = packBundle(inputs);
    return { bundle, inputs, nodePtyRoot };
}

// Прямой запуск: `node scripts/pack-node-pty.mjs` → dist/node-pty.bundle.
if (import.meta.url === `file://${process.argv[1]}`) {
    const repoRoot = resolve(import.meta.dirname, "..");
    const dist = resolve(repoRoot, "dist");
    const { bundle, inputs, nodePtyRoot } = buildNodePtyBundle({ repoRoot });
    const outPath = join(dist, "node-pty.bundle");
    writeFileSync(outPath, bundle);
    console.error(
        `[pack-node-pty] ${outPath} (${(bundle.length / 1024).toFixed(1)} KB, ${inputs.length} entries; from ${nodePtyRoot})`,
    );
}
