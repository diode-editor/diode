import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";

import { copyInto, isInside, moveInto, resolveNonConflictingDest } from "./fileClipboardFs.ts";

let ws: ITempWorkspace;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-fileclip-" });
});

afterEach(() => {
    ws.dispose();
});

function write(rel: string, content = "x"): string {
    return ws.writeFile(rel, content);
}

describe("resolveNonConflictingDest", () => {
    it("returns the direct path when no conflict", () => {
        expect(resolveNonConflictingDest(ws.dir, "a.txt")).toBe(path.join(ws.dir, "a.txt"));
    });

    it("appends ' copy' preserving the extension", () => {
        write("a.txt");
        expect(resolveNonConflictingDest(ws.dir, "a.txt")).toBe(path.join(ws.dir, "a copy.txt"));
    });

    it("increments the copy counter on repeated conflicts", () => {
        write("a.txt");
        write("a copy.txt");
        expect(resolveNonConflictingDest(ws.dir, "a.txt")).toBe(path.join(ws.dir, "a copy 2.txt"));
    });

    it("handles directories (no extension)", () => {
        fs.mkdirSync(path.join(ws.dir, "dir"));
        expect(resolveNonConflictingDest(ws.dir, "dir")).toBe(path.join(ws.dir, "dir copy"));
    });
});

describe("isInside", () => {
    it("treats a directory as inside itself", () => {
        expect(isInside("/a/b", "/a/b")).toBe(true);
    });

    it("detects nested paths", () => {
        expect(isInside("/a/b", "/a/b/c")).toBe(true);
    });

    it("rejects siblings and parents", () => {
        expect(isInside("/a/b", "/a/c")).toBe(false);
        expect(isInside("/a/b", "/a")).toBe(false);
    });
});

describe("copyInto", () => {
    it("copies a file into the target and keeps the source", () => {
        const src = write("src/a.txt", "hello");
        const target = path.join(ws.dir, "dst");
        fs.mkdirSync(target);

        const dest = copyInto(src, target);

        expect(dest).toBe(path.join(target, "a.txt"));
        expect(fs.readFileSync(dest, "utf8")).toBe("hello");
        expect(fs.existsSync(src)).toBe(true);
    });

    it("auto-renames on collision", () => {
        const src = write("a.txt", "v1");
        const target = path.join(ws.dir, "dst");
        fs.mkdirSync(target);
        fs.writeFileSync(path.join(target, "a.txt"), "existing");

        const dest = copyInto(src, target);

        expect(dest).toBe(path.join(target, "a copy.txt"));
        expect(fs.readFileSync(dest, "utf8")).toBe("v1");
    });

    it("copies directories recursively", () => {
        write("tree/inner/file.txt", "deep");
        const target = path.join(ws.dir, "dst");
        fs.mkdirSync(target);

        const dest = copyInto(path.join(ws.dir, "tree"), target);

        expect(fs.readFileSync(path.join(dest, "inner/file.txt"), "utf8")).toBe("deep");
    });

    it("throws when copying a directory into itself", () => {
        fs.mkdirSync(path.join(ws.dir, "d/sub"), { recursive: true });
        expect(() => copyInto(path.join(ws.dir, "d"), path.join(ws.dir, "d/sub"))).toThrow();
    });
});

describe("moveInto", () => {
    it("moves a file and removes the source", () => {
        const src = write("src/a.txt", "hello");
        const target = path.join(ws.dir, "dst");
        fs.mkdirSync(target);

        const dest = moveInto(src, target);

        expect(dest).toBe(path.join(target, "a.txt"));
        expect(fs.readFileSync(dest, "utf8")).toBe("hello");
        expect(fs.existsSync(src)).toBe(false);
    });

    it("is a no-op when the source already lives in the target dir", () => {
        const src = write("a.txt", "v1");
        const dest = moveInto(src, ws.dir);
        expect(dest).toBe(src);
        expect(fs.existsSync(src)).toBe(true);
    });

    it("auto-renames on collision", () => {
        const src = write("src/a.txt", "v1");
        const target = path.join(ws.dir, "dst");
        fs.mkdirSync(target);
        fs.writeFileSync(path.join(target, "a.txt"), "existing");

        const dest = moveInto(src, target);

        expect(dest).toBe(path.join(target, "a copy.txt"));
        expect(fs.readFileSync(dest, "utf8")).toBe("v1");
        expect(fs.existsSync(src)).toBe(false);
    });

    it("throws when moving a directory into itself", () => {
        fs.mkdirSync(path.join(ws.dir, "d/sub"), { recursive: true });
        expect(() => moveInto(path.join(ws.dir, "d"), path.join(ws.dir, "d/sub"))).toThrow();
    });
});
