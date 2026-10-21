import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { packBundle } from "../../common/assets/assetBundleFormat.ts";

import { extractBundleToCache, extractBundleToCacheSync, READY_MARKER } from "./extractBundleToCache.ts";

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

    it("extracts the tree, writes .diode-ready, leaves no lock", async () => {
        const target = path.join(root, "v1-abc");
        await extractBundleToCache(bundle(), target);

        expect(readFileSync(path.join(target, "server/lib/cli.mjs"), "utf8")).toBe("console.log('cli')");
        expect(readFileSync(path.join(target, "node_modules/typescript/lib/tsserver.js"), "utf8")).toBe("// tsserver");
        expect(existsSync(path.join(target, READY_MARKER))).toBe(true);
        expect(existsSync(`${target}.lock`)).toBe(false);
    });

    it("a repeated call is an instant no-op: extracted files are not overwritten", async () => {
        const target = path.join(root, "v1-abc");
        await extractBundleToCache(bundle(), target);
        writeFileSync(path.join(target, "server/lib/cli.mjs"), "edited after unpack");

        await extractBundleToCache(bundle(), target);
        expect(readFileSync(path.join(target, "server/lib/cli.mjs"), "utf8")).toBe("edited after unpack");
    });

    it("unfinished leftovers of a previous crash are wiped under the lock", async () => {
        const target = path.join(root, "v1-abc");
        // A half-extracted directory WITHOUT .diode-ready, as after a crash between
        // writing files and publishing (normally unobservable: we write to tmp).
        mkdirSync(target, { recursive: true });
        writeFileSync(path.join(target, "garbage"), "stale");

        await extractBundleToCache(bundle(), target);
        expect(existsSync(path.join(target, "garbage"))).toBe(false);
        expect(existsSync(path.join(target, READY_MARKER))).toBe(true);
    });

    it("a competitor holds the lock: wait for its .diode-ready", async () => {
        const target = path.join(root, "v1-abc");
        mkdirSync(`${target}.lock`); // "another" owner is extracting
        const done = extractBundleToCache(bundle(), target, { waitTimeoutMs: 3_000, pollIntervalMs: 10 });

        setTimeout(() => {
            mkdirSync(target, { recursive: true });
            writeFileSync(path.join(target, READY_MARKER), "");
            rmSync(`${target}.lock`, { recursive: true, force: true });
        }, 50);

        await expect(done).resolves.toBeUndefined();
        // The "owner" extracted, not us: the bundle's files aren't in the directory.
        expect(existsSync(path.join(target, "server/lib/cli.mjs"))).toBe(false);
    });

    it("stale lock: timeout with a clear hint", async () => {
        const target = path.join(root, "v1-abc");
        mkdirSync(`${target}.lock`);

        await expect(
            extractBundleToCache(bundle(), target, { waitTimeoutMs: 120, pollIntervalMs: 20 }),
        ).rejects.toThrow(
            `diode: timed out waiting for cache unpack at ${target}. ` +
                `If no other diode is starting, remove the stale lock: rm -rf '${target}.lock'`,
        );
    });

    it.skipIf(process.platform === "win32")("a non-EEXIST lock error is rethrown (readonly cacheRoot)", async () => {
        const readonlyRoot = path.join(root, "ro");
        mkdirSync(readonlyRoot);
        chmodSync(readonlyRoot, 0o500);
        try {
            await expect(extractBundleToCache(bundle(), path.join(readonlyRoot, "v1-abc"))).rejects.toThrow(/EACCES/);
        } finally {
            chmodSync(readonlyRoot, 0o700);
        }
    });

    it("a broken bundle with a traversal path is rejected and the lock is released", async () => {
        const target = path.join(root, "v1-abc");
        // The header is built by hand: packBundle won't let such a path through.
        const evil = packBundle([{ virtualPath: "ok.txt", data: Buffer.from("x") }]);
        const patched = Buffer.from(evil);
        const json = patched.toString(
            "utf8",
            12,
            12 + new DataView(patched.buffer, patched.byteOffset + 8, 4).getUint32(0, true),
        );
        const evilJson = json.replace("ok.txt", "../evi");
        expect(evilJson.length).toBe(json.length); // header length stays the same
        patched.write(evilJson, 12, "utf8");

        await expect(extractBundleToCache(patched, target)).rejects.toThrow(/Invalid segment/);
        expect(existsSync(`${target}.lock`)).toBe(false);
    });

    it.skipIf(process.platform === "win32")("executable: marked files are executable, the rest are not", async () => {
        const target = path.join(root, "v1-abc");
        await extractBundleToCache(bundle(), target, { executable: (p) => p.endsWith("cli.mjs") });

        expect(statSync(path.join(target, "server/lib/cli.mjs")).mode & 0o111).not.toBe(0);
        expect(statSync(path.join(target, "node_modules/typescript/lib/tsserver.js")).mode & 0o111).toBe(0);
    });
});

describe("extractBundleToCacheSync", () => {
    let root: string;

    const bundle = () => packBundle([{ virtualPath: "bin/rg", data: Buffer.from("#!/bin/sh\necho rg") }]);

    beforeEach(() => {
        root = mkdtempSync(path.join(tmpdir(), "diode-extract-sync-"));
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it("extracts synchronously; the second call is a no-op", () => {
        const target = path.join(root, "v1-abc");
        extractBundleToCacheSync(bundle(), target, { executable: () => true });

        expect(readFileSync(path.join(target, "bin/rg"), "utf8")).toBe("#!/bin/sh\necho rg");
        expect(existsSync(`${target}.lock`)).toBe(false);
        writeFileSync(path.join(target, "bin/rg"), "edited after unpack");
        extractBundleToCacheSync(bundle(), target);
        expect(readFileSync(path.join(target, "bin/rg"), "utf8")).toBe("edited after unpack");
    });

    it("a foreign lock without publication: timeout with a stale lock hint", () => {
        const target = path.join(root, "v1-abc");
        mkdirSync(`${target}.lock`, { recursive: true });

        expect(() => {
            extractBundleToCacheSync(bundle(), target, { waitTimeoutMs: 60, pollIntervalMs: 10 });
        }).toThrow(/stale lock/);
    });

    it("a foreign lock: wait until the other process publishes the directory", () => {
        const target = path.join(root, "v1-abc");
        mkdirSync(`${target}.lock`, { recursive: true });
        // The synchronous wait blocks the thread, so a separate process plays the "owner".
        const script = `setTimeout(() => {
            const fs = require("node:fs");
            fs.mkdirSync(${JSON.stringify(target)}, { recursive: true });
            fs.writeFileSync(${JSON.stringify(path.join(target, READY_MARKER))}, "");
        }, 100);`;
        const peer = spawn(process.execPath, ["-e", script], { stdio: "ignore" });
        try {
            extractBundleToCacheSync(bundle(), target); // defaults: 30 s timeout, 100 ms polling
            expect(existsSync(path.join(target, READY_MARKER))).toBe(true);
            expect(existsSync(path.join(target, "bin/rg"))).toBe(false);
        } finally {
            peer.kill();
        }
    });

    it("a foreign lock, but the directory is already published: ready at once", () => {
        const target = path.join(root, "v1-abc");
        mkdirSync(target, { recursive: true });
        writeFileSync(path.join(target, READY_MARKER), "");
        mkdirSync(`${target}.lock`);

        expect(() => {
            extractBundleToCacheSync(bundle(), target, { waitTimeoutMs: 60 });
        }).not.toThrow();
    });
});
