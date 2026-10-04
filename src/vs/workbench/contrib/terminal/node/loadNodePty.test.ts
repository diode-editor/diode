import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { packBundle } from "../../../../base/common/assets/assetBundleFormat.ts";

import { loadNodePty, resolveNodePty } from "./loadNodePty.ts";

describe("resolveNodePty", () => {
    let cacheRoot: string;

    beforeEach(() => {
        cacheRoot = mkdtempSync(path.join(tmpdir(), "diode-pty-cache-"));
    });
    afterEach(() => {
        rmSync(cacheRoot, { recursive: true, force: true });
    });

    it("dev: без упакованного ассета — node-pty из node_modules", () => {
        expect(typeof resolveNodePty(null).spawn).toBe("function");
    });

    it("упакованная сборка: модуль грузится из распакованного кэша, нативные файлы исполняемы", () => {
        // Вместо настоящего аддона — JS-модуль той же формы: проверяем распаковку и загрузку, не PTY.
        const bundle = packBundle([
            { virtualPath: "node-pty/package.json", data: Buffer.from(JSON.stringify({ main: "index.js" })) },
            {
                virtualPath: "node-pty/index.js",
                data: Buffer.from("module.exports = { spawn: () => 'fake-pty', from: __dirname };"),
            },
            { virtualPath: "node-pty/build/Release/pty.node", data: Buffer.from("native") },
            { virtualPath: "node-pty/build/Release/spawn-helper", data: Buffer.from("helper") },
            { virtualPath: "node-pty/lib/plain.js", data: Buffer.from("// not executable") },
        ]);

        const pty = resolveNodePty(bundle, cacheRoot) as unknown as { spawn(): string; from: string };

        expect(pty.spawn()).toBe("fake-pty");
        expect(pty.from.startsWith(path.join(cacheRoot, "node-pty"))).toBe(true);
        if (process.platform !== "win32") {
            const release = path.join(pty.from, "build", "Release");
            expect(statSync(path.join(release, "pty.node")).mode & 0o111).not.toBe(0);
            expect(statSync(path.join(release, "spawn-helper")).mode & 0o111).not.toBe(0);
            expect(statSync(path.join(pty.from, "lib", "plain.js")).mode & 0o111).toBe(0);
        }
    });

    it("loadNodePty кэширует модуль на процесс", () => {
        const first = loadNodePty();
        expect(loadNodePty()).toBe(first);
        expect(typeof first.spawn).toBe("function");
    });
});
