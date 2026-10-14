// Запуск: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { buildLazyChunks, LAZY_CHUNKS, lazyChunkAssetName, verifyLazyChunks } from "./build-lazy-chunks.mjs";

const repoRoot = resolve(import.meta.dirname, "..");

/** metafile main.js: входы и импорты единственного выхода. */
const main = (inputs, imports = []) => ({
    inputs: {},
    outputs: {
        "dist/main.js": { inputs: Object.fromEntries(inputs.map((i) => [i, { bytesInOutput: 1 }])), imports },
        "dist/main.js.map": { inputs: {}, imports: [] },
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

test("verifyLazyChunks: модуль куска в main.js — нарушение, обёртка <stdin> не считается", () => {
    const errors = verifyLazyChunks({
        mainMetafile: main(["<stdin>", "node_modules/pend/index.js"]),
        chunks: [chunk("yauzl", ["<stdin>", "node_modules/yauzl/index.js", "node_modules/pend/index.js"])],
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^yauzl: модуль node_modules\/pend\/index\.js лежит и в куске, и в main\.js/);
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
        "yauzl: main.js импортирует кусок статически (import-statement) — только через loadLazyModule / importLazyModule",
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

test("lazyChunkAssetName: lazy/<id>.cjs — путь рядом с main.js и ключ SEA-ассета", () => {
    assert.equal(lazyChunkAssetName("yauzl"), "lazy/yauzl.cjs");
    assert.equal(lazyChunkAssetName("@xterm/headless"), "lazy/@xterm/headless.cjs");
});

test("buildLazyChunks: каждый кусок из списка собирается самодостаточным CJS", async () => {
    const distDir = mkdtempSync(join(tmpdir(), "diode-lazy-test-"));
    try {
        const chunks = await buildLazyChunks({ repoRoot, distDir, write: false });
        assert.deepEqual(
            chunks.map((c) => c.id),
            LAZY_CHUNKS.map((c) => c.id),
        );
        for (const c of chunks) {
            assert.equal(c.path, join(distDir, lazyChunkAssetName(c.id)));
            // Пустой main.js: проверяется только самодостаточность куска.
            assert.deepEqual(verifyLazyChunks({ mainMetafile: main([]), chunks: [c] }), []);
        }
    } finally {
        rmSync(distDir, { recursive: true, force: true });
    }
});
