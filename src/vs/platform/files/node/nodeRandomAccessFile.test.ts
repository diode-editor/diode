import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";

import { NodeRandomAccessFile, nodeRandomAccessFileOpener } from "./nodeRandomAccessFile.ts";

describe("NodeRandomAccessFile", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-random-access-" });
    });
    afterEach(() => {
        ws.dispose();
    });

    it("positional reads, sync and async, share one descriptor and do not move each other", async () => {
        const file = nodeRandomAccessFileOpener.open(ws.writeFile("a.txt", "0123456789"));
        expect(file.size).toBe(10);
        const sync = Buffer.alloc(3);
        const async = Buffer.alloc(4);
        const pending = file.read(async, 6);
        expect(file.readSync(sync, 2)).toBe(3);
        expect(sync.toString()).toBe("234");
        expect(await pending).toBe(4);
        expect(async.toString()).toBe("6789");
        // Past the end: 0 bytes, no error.
        expect(file.readSync(sync, 10)).toBe(0);
        expect(await file.read(async, 12)).toBe(0);
        file.dispose();
    });

    it("after dispose every read refuses; a second dispose is a no-op", async () => {
        const file = new NodeRandomAccessFile(ws.writeFile("b.txt", "abc"));
        file.dispose();
        file.dispose();
        expect(() => file.readSync(Buffer.alloc(1), 0)).toThrow("closed");
        await expect(file.read(Buffer.alloc(1), 0)).rejects.toThrow("closed");
    });

    // The descriptor table is readable on Linux (CI); elsewhere the leak check has nothing to look at. Other
    // test files share the process, so the check is for our path's descriptor, not the count.
    it.skipIf(!fs.existsSync("/proc/self/fd"))("dispose closes the descriptor", () => {
        const path = fs.realpathSync(ws.writeFile("c.txt", "abc"));
        const descriptorsOfPath = () =>
            fs.readdirSync("/proc/self/fd").filter((fd) => {
                try {
                    return fs.readlinkSync(`/proc/self/fd/${fd}`) === path;
                } catch {
                    return false;
                }
            }).length;
        const file = new NodeRandomAccessFile(path);
        expect(descriptorsOfPath()).toBe(1);
        file.dispose();
        expect(descriptorsOfPath()).toBe(0);
    });

    it("a missing file throws from open, as fs.openSync does", () => {
        expect(() => nodeRandomAccessFileOpener.open(ws.path("missing.txt"))).toThrow(/ENOENT/);
    });
});
