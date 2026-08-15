import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { packBundle } from "../../common/assets/assetBundleFormat.ts";

import { extractBundleToCache, READY_MARKER } from "./extractBundleToCache.ts";

// Распаковка бандла в кэш: идемпотентность, атомарная публикация (rename),
// мьютекс mkdir-lock — схема self-extract-стаба, перенесённая в TS.

describe("extractBundleToCache", () => {
    let root: string;

    const bundle = () =>
        packBundle([
            { virtualPath: "server/lib/cli.mjs", data: Buffer.from("console.log('cli')") },
            { virtualPath: "node_modules/typescript/lib/tsserver.js", data: Buffer.from("// tsserver") },
        ]);

    beforeEach(() => {
        root = mkdtempSync(path.join(tmpdir(), "diode-extract-"));
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it("распаковывает дерево, ставит .diode-ready, лок не остаётся", async () => {
        const target = path.join(root, "v1-abc");
        await extractBundleToCache(bundle(), target);

        expect(readFileSync(path.join(target, "server/lib/cli.mjs"), "utf8")).toBe("console.log('cli')");
        expect(readFileSync(path.join(target, "node_modules/typescript/lib/tsserver.js"), "utf8")).toBe("// tsserver");
        expect(existsSync(path.join(target, READY_MARKER))).toBe(true);
        expect(existsSync(`${target}.lock`)).toBe(false);
    });

    it("повторный вызов — мгновенный no-op (mtime не меняется)", async () => {
        const target = path.join(root, "v1-abc");
        await extractBundleToCache(bundle(), target);
        const before = statSync(path.join(target, "server/lib/cli.mjs")).mtimeMs;

        await extractBundleToCache(bundle(), target);
        expect(statSync(path.join(target, "server/lib/cli.mjs")).mtimeMs).toBe(before);
    });

    it("незавершённый мусор прошлого падения затирается под локом", async () => {
        const target = path.join(root, "v1-abc");
        // Полураспакованный каталог БЕЗ .diode-ready — как после падения между
        // писанием файлов и публикацией (в норме ненаблюдаемо: пишем во tmp).
        mkdirSync(target, { recursive: true });
        writeFileSync(path.join(target, "garbage"), "stale");

        await extractBundleToCache(bundle(), target);
        expect(existsSync(path.join(target, "garbage"))).toBe(false);
        expect(existsSync(path.join(target, READY_MARKER))).toBe(true);
    });

    it("конкурент с локом: ждём его .diode-ready", async () => {
        const target = path.join(root, "v1-abc");
        mkdirSync(`${target}.lock`); // «чужой» владелец распаковывает
        const done = extractBundleToCache(bundle(), target, { waitTimeoutMs: 3_000, pollIntervalMs: 10 });

        // «Владелец» публикует каталог через 50 мс.
        setTimeout(() => {
            mkdirSync(target, { recursive: true });
            writeFileSync(path.join(target, READY_MARKER), "");
            rmSync(`${target}.lock`, { recursive: true, force: true });
        }, 50);

        await expect(done).resolves.toBeUndefined();
    });

    it("stale lock: таймаут с внятной подсказкой", async () => {
        const target = path.join(root, "v1-abc");
        mkdirSync(`${target}.lock`);

        await expect(
            extractBundleToCache(bundle(), target, { waitTimeoutMs: 120, pollIntervalMs: 20 }),
        ).rejects.toThrow(/stale lock/);
    });

    it.skipIf(process.platform === "win32")("не-EEXIST ошибка лока пробрасывается (readonly cacheRoot)", async () => {
        const readonlyRoot = path.join(root, "ro");
        mkdirSync(readonlyRoot);
        chmodSync(readonlyRoot, 0o500);
        try {
            await expect(extractBundleToCache(bundle(), path.join(readonlyRoot, "v1-abc"))).rejects.toThrow(/EACCES/);
        } finally {
            chmodSync(readonlyRoot, 0o700);
        }
    });

    it("битый бандл с traversal-путём отвергается, лок снимается", async () => {
        const target = path.join(root, "v1-abc");
        // Собираем заголовок руками: packBundle такой путь не пропустит.
        const evil = packBundle([{ virtualPath: "ok.txt", data: Buffer.from("x") }]);
        const patched = Buffer.from(evil);
        const json = patched.toString("utf8", 12, 12 + new DataView(patched.buffer, patched.byteOffset + 8, 4).getUint32(0, true));
        const evilJson = json.replace("ok.txt", "../evi");
        expect(evilJson.length).toBe(json.length); // длина заголовка не меняется
        patched.write(evilJson, 12, "utf8");

        await expect(extractBundleToCache(patched, target)).rejects.toThrow(/Invalid segment/);
        expect(existsSync(`${target}.lock`)).toBe(false);
    });
});
