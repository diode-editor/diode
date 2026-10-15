// Запуск: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import * as vm from "node:vm";

import {
    buildLazyChunkCodeCaches,
    buildLazyChunks,
    describeEntryChunks,
    importMetaUrlShim,
    LAZY_CHUNKS,
    lazyChunkAssetName,
    lazyChunkCacheAssetName,
    lazyEntryChunksPlugin,
    verifyLazyChunks,
} from "./build-lazy-chunks.mjs";

const repoRoot = resolve(import.meta.dirname, "..");

/** metafile main.cjs: входы и импорты единственного выхода. */
const main = (inputs, imports = []) => ({
    inputs: {},
    outputs: {
        "dist/main.cjs": { inputs: Object.fromEntries(inputs.map((i) => [i, { bytesInOutput: 1 }])), imports },
        "dist/main.cjs.map": { inputs: {}, imports: [] },
    },
});
/** metafile куска: входы и импорты его выхода. */
const chunk = (id, inputs, imports = []) => ({
    id,
    metafile: {
        inputs: Object.fromEntries(inputs.map((i) => [i, {}])),
        outputs: { [`dist/lazy/${id}.cjs`]: { inputs: {}, imports } },
    },
});

test("verifyLazyChunks: кусок вне ядра, ядро зовёт его через import(), кусок тянет только builtin'ы — чисто", () => {
    const errors = verifyLazyChunks({
        mainMetafile: main(["src/vs/diode/main.ts"], [{ path: "yauzl", kind: "dynamic-import", external: true }]),
        chunks: [
            chunk(
                "yauzl",
                ["<stdin>", "node_modules/yauzl/index.js"],
                [
                    { path: "fs", kind: "require-call", external: true },
                    { path: "node:zlib", kind: "require-call", external: true },
                ],
            ),
        ],
    });
    assert.deepEqual(errors, []);
});

test("verifyLazyChunks: модуль куска в main.cjs — нарушение, обёртка <stdin> не считается", () => {
    const errors = verifyLazyChunks({
        mainMetafile: main(["<stdin>", "node_modules/pend/index.js"]),
        chunks: [chunk("yauzl", ["<stdin>", "node_modules/yauzl/index.js", "node_modules/pend/index.js"])],
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^yauzl: модуль node_modules\/pend\/index\.js лежит и в куске, и в main\.cjs/);
});

test("verifyLazyChunks: статический импорт куска из ядра — нарушение, import() — нет", () => {
    const errors = verifyLazyChunks({
        mainMetafile: main(
            [],
            [
                { path: "yauzl", kind: "import-statement", external: true },
                { path: "yauzl", kind: "dynamic-import", external: true },
                { path: "other", kind: "import-statement", external: true },
            ],
        ),
        chunks: [chunk("yauzl", [])],
    });
    assert.deepEqual(errors, [
        "yauzl: main.cjs импортирует кусок статически (import-statement) — только через loadLazyModule / importLazyModule",
    ]);
});

test("verifyLazyChunks: кусок тянет внешний не-builtin — нарушение; собственные входы не в счёт", () => {
    const errors = verifyLazyChunks({
        mainMetafile: main([]),
        chunks: [
            chunk(
                "yauzl",
                [],
                [
                    { path: "pend", kind: "require-call", external: true },
                    { path: "./inner.js", kind: "require-call", external: false },
                ],
            ),
        ],
    });
    assert.deepEqual(errors, ["yauzl: кусок тянет внешний модуль pend — в SEA его не будет"]);
});

/** metafile куска из нашего кода: входы с размером в куске (байты), вход-модуль и бюджет копии. */
const entryChunk = (id, entry, sizes, sharedBudgetKb = 1) => ({
    id,
    entry,
    sharedBudgetKb,
    metafile: {
        inputs: Object.fromEntries(Object.keys(sizes).map((i) => [i, {}])),
        outputs: {
            [`dist/lazy/${id}.cjs`]: {
                bytes: Object.values(sizes).reduce((a, b) => a + b, 0),
                inputs: Object.fromEntries(Object.entries(sizes).map(([i, bytesInOutput]) => [i, { bytesInOutput }])),
                imports: [],
            },
        },
    },
});

test("verifyLazyChunks: кусок из нашего кода делит модули с ядром в пределах бюджета — чисто", () => {
    const errors = verifyLazyChunks({
        mainMetafile: main(["src/vs/diode/main.ts", "src/vs/base/common/event.ts"]),
        chunks: [
            entryChunk("roles/x", "src/roles/x.ts", {
                "<stdin>": 10,
                "src/roles/x.ts": 5000,
                // ровно бюджет: 1 КБ
                "src/vs/base/common/event.ts": 1024,
            }),
        ],
    });
    assert.deepEqual(errors, []);
});

test("verifyLazyChunks: копия общих модулей больше бюджета — нарушение с крупнейшими модулями", () => {
    const errors = verifyLazyChunks({
        mainMetafile: main(["src/vs/diode/main.ts", "src/a.ts", "src/b.ts"]),
        chunks: [entryChunk("roles/x", "src/roles/x.ts", { "src/roles/x.ts": 10, "src/a.ts": 1000, "src/b.ts": 2000 }, 2)],
    });
    assert.equal(errors.length, 1);
    assert.match(
        errors[0],
        /^roles\/x: общих с main\.cjs модулей 2\.9 КБ — больше бюджета 2 КБ \(крупнейшие: src\/b\.ts 2\.0 КБ, src\/a\.ts 1\.0 КБ\)/,
    );
});

test("verifyLazyChunks: вход куска из нашего кода в main.cjs — нарушение, бюджет не проверяется", () => {
    const errors = verifyLazyChunks({
        mainMetafile: main(["src/vs/diode/main.ts", "src/roles/x.ts"]),
        chunks: [entryChunk("roles/x", "src/roles/x.ts", { "src/roles/x.ts": 5000 })],
    });
    assert.deepEqual(errors, [
        "roles/x: вход src/roles/x.ts лежит в main.cjs — ядро импортирует роль статически, кусок бесполезен",
    ]);
});

test("verifyLazyChunks: кусок из нашего кода без бюджета — нарушение", () => {
    const c = entryChunk("roles/x", "src/roles/x.ts", { "src/roles/x.ts": 5000 });
    delete c.sharedBudgetKb;
    assert.deepEqual(verifyLazyChunks({ mainMetafile: main([]), chunks: [c] }), [
        "roles/x: у куска из нашего кода нет sharedBudgetKb — сколько общих с ядром модулей он вправе нести копией",
    ]);
});

test("verifyLazyChunks: другой кусок через import() — можно, статическим require — нет", () => {
    const c = entryChunk("roles/x", "src/roles/x.ts", { "src/roles/x.ts": 1 });
    c.metafile.outputs["dist/lazy/roles/x.cjs"].imports = [
        { path: "iconv-lite", kind: "dynamic-import", external: true },
        { path: "semver", kind: "require-call", external: true },
    ];
    assert.deepEqual(verifyLazyChunks({ mainMetafile: main([]), chunks: [c] }), [
        "roles/x: кусок тянет внешний модуль semver — в SEA его не будет",
    ]);
});

test("describeEntryChunks: размер куска и копия общих модулей против бюджета; пакеты не в сводке", () => {
    const lines = describeEntryChunks({
        mainMetafile: main(["src/a.ts"]),
        chunks: [chunk("yauzl", []), entryChunk("roles/x", "src/roles/x.ts", { "src/roles/x.ts": 1024, "src/a.ts": 512 }, 3)],
    });
    assert.deepEqual(lines, ["roles/x: кусок 1.5 КБ, из них общих с main.cjs 0.5 КБ (бюджет 3 КБ)"]);
});

test('lazyEntryChunksPlugin: import() входа куска — внешний import("<id>"), чужие пути не трогает', async () => {
    const esbuild = await import("esbuild");
    const role = LAZY_CHUNKS.find((c) => c.entry !== undefined);
    const result = await esbuild.build({
        stdin: {
            contents:
                `export const load = () => import(${JSON.stringify(`./${role.entry}`)});\n` +
                'export { lazyChunkAssetName } from "./scripts/build-lazy-chunks.mjs";',
            resolveDir: repoRoot,
            loader: "js",
        },
        bundle: true,
        platform: "node",
        format: "esm",
        write: false,
        outdir: "out",
        metafile: true,
        absWorkingDir: repoRoot,
        logLevel: "silent",
        packages: "external",
        plugins: [lazyEntryChunksPlugin(repoRoot)],
    });
    const [output] = Object.values(result.metafile.outputs);
    assert.deepEqual(
        output.imports.filter((i) => i.path === role.id),
        [{ path: role.id, kind: "dynamic-import", external: true }],
    );
    // Вход роли не вклеен, а соседний модуль — вклеен как обычно.
    assert.equal(Object.keys(output.inputs).includes(role.entry), false);
    assert.equal(Object.keys(output.inputs).includes("scripts/build-lazy-chunks.mjs"), true);
});

test("importMetaUrlShim: import.meta.url в CJS — URL главного скрипта и у ядра, и у куска, в момент вызова", async () => {
    const esbuild = await import("esbuild");
    const dir = mkdtempSync(join(tmpdir(), "diode-meta-url-"));
    try {
        const shim = importMetaUrlShim(repoRoot);
        const result = await esbuild.build({
            stdin: { contents: "module.exports = () => import.meta.url;", resolveDir: repoRoot, loader: "js" },
            bundle: true,
            platform: "node",
            format: "cjs",
            write: false,
            logLevel: "silent",
            define: shim.define,
            inject: shim.inject,
        });
        const code = result.outputFiles[0].text;
        assert.equal(code.includes("import.meta"), false);
        // Ядро: бандл — сам главный скрипт.
        const core = join(dir, "main.cjs");
        writeFileSync(core, `${code}\nconsole.log(module.exports());\n`);
        assert.equal(execFileSync(process.execPath, [core], { encoding: "utf8" }).trim(), pathToFileURL(core).href);
        // Кусок: исполняется загрузчиком в обёртке (filename `diode:lazy/…`), главный
        // скрипт — другой. Смена главного после загрузки видна: значение не запечено.
        const loader = join(dir, "loader.cjs");
        writeFileSync(
            loader,
            `const vm = require("node:vm"), { createRequire } = require("node:module");
const wrapper = new vm.Script(${JSON.stringify(`(function (exports, require, module) {${code}\n})`)}, { filename: "diode:lazy/x.cjs" }).runInThisContext();
const m = { exports: {} };
wrapper(m.exports, createRequire(process.execPath), m);
console.log(m.exports());
require.main.filename = "/elsewhere/main.cjs";
console.log(m.exports());
`,
        );
        assert.deepEqual(execFileSync(process.execPath, [loader], { encoding: "utf8" }).trim().split("\n"), [
            pathToFileURL(loader).href,
            "file:///elsewhere/main.cjs",
        ]);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("lazyChunkAssetName: lazy/<id>.cjs — путь рядом с main.cjs и ключ SEA-ассета", () => {
    assert.equal(lazyChunkAssetName("yauzl"), "lazy/yauzl.cjs");
    assert.equal(lazyChunkAssetName("@xterm/headless"), "lazy/@xterm/headless.cjs");
});

test("buildLazyChunks: каждый кусок из списка собирается самодостаточным CJS и исполняется без node_modules", async () => {
    const distDir = mkdtempSync(join(tmpdir(), "diode-lazy-test-"));
    try {
        const chunks = await buildLazyChunks({ repoRoot, distDir });
        assert.deepEqual(
            chunks.map((c) => c.id),
            LAZY_CHUNKS.map((c) => c.id),
        );
        for (const c of chunks) {
            assert.equal(c.path, join(distDir, lazyChunkAssetName(c.id)));
            // Пустой main.cjs: проверяется только самодостаточность куска.
            assert.deepEqual(verifyLazyChunks({ mainMetafile: main([]), chunks: [c] }), []);
        }
        // Исполнение — как у загрузчика: обёртка модуля и require только builtin'ов.
        // Метаданные этого не ловят: UMD-сборка пакета зовёт require внутри фабрики,
        // и бандл падает только в рантайме («Cannot find module './impl/format'»).
        for (const c of chunks) {
            const wrapper = new vm.Script(`(function (exports, require, module) {${readFileSync(c.path, "utf8")}\n})`, {
                filename: c.asset,
            }).runInThisContext();
            const module = { exports: {} };
            wrapper(module.exports, createRequire(process.execPath), module);
            assert.notDeepEqual(Object.keys(module.exports), [], `${c.id}: кусок ничего не экспортирует`);
        }
        // Кусок из нашего кода несёт свой вход и бюджет — их читает гейт.
        const role = chunks.find((c) => c.id === "roles/extension-host");
        assert.equal(role.entry, "src/vs/diode/roles/extensionHostRole.ts");
        assert.equal(Object.keys(role.metafile.inputs).includes(role.entry), true);
    } finally {
        rmSync(distDir, { recursive: true, force: true });
    }
});

test("buildLazyChunkCodeCaches: кэш кода каждого куска — дочерним node, принимается V8 этого же node", () => {
    const dir = mkdtempSync(join(tmpdir(), "diode-lazy-cache-"));
    try {
        const code = "exports.x = (function () { return 1; })();\n";
        const path = join(dir, "x.cjs");
        writeFileSync(path, code);
        const caches = buildLazyChunkCodeCaches({
            chunks: [{ id: "@scope/x", asset: "lazy/@scope/x.cjs", path }],
            outDir: join(dir, "out"),
            nodeBinary: process.execPath,
        });
        assert.deepEqual(caches, [{ asset: "lazy/@scope/x.v8cache", path: join(dir, "out", "lazy/@scope/x.v8cache") }]);
        assert.equal(lazyChunkCacheAssetName("@scope/x"), "lazy/@scope/x.v8cache");
        const script = new vm.Script(`(function (exports, require, module, __filename, __dirname) {${code}\n})`, {
            filename: "diode:lazy/@scope/x.cjs",
            cachedData: readFileSync(caches[0].path),
        });
        assert.equal(script.cachedDataRejected, false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
