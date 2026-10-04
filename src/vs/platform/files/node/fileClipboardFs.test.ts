import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";

import { resolveNonConflictingDest } from "./fileClipboardFs.ts";

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
