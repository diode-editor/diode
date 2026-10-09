import { describe, expect, it } from "vitest";

import { parsePorcelainStatus, pathAtHead } from "./porcelain.ts";

/** Build a NUL-terminated buffer from record fields, mirroring `-z` output. */
function nul(...fields: string[]): Buffer {
    return Buffer.from(fields.map((f) => `${f}\0`).join(""), "utf8");
}

describe("parsePorcelainStatus", () => {
    it("returns an empty list for empty output", () => {
        expect(parsePorcelainStatus(Buffer.alloc(0))).toEqual([]);
    });

    it("parses a modified working-tree file (` M`)", () => {
        expect(parsePorcelainStatus(nul(" M src/app.ts"))).toEqual([{ path: "src/app.ts", xy: " M" }]);
    });

    it("parses a staged-and-modified file (`MM`)", () => {
        expect(parsePorcelainStatus(nul("MM lib/x.ts"))).toEqual([{ path: "lib/x.ts", xy: "MM" }]);
    });

    it("parses an untracked file (`??`)", () => {
        expect(parsePorcelainStatus(nul("?? new file.txt"))).toEqual([{ path: "new file.txt", xy: "??" }]);
    });

    it("parses an ignored file (`!!`)", () => {
        expect(parsePorcelainStatus(nul("!! build/out.js"))).toEqual([{ path: "build/out.js", xy: "!!" }]);
    });

    it("parses a rename, consuming the original path as a separate field", () => {
        // `R  new` followed by the original path `old`.
        const buf = nul("R  src/new.ts", "src/old.ts");
        expect(parsePorcelainStatus(buf)).toEqual([{ path: "src/new.ts", xy: "R ", originalPath: "src/old.ts" }]);
    });

    it("parses a copy, consuming the original path as a separate field", () => {
        const buf = nul("C  dst.ts", "orig.ts");
        expect(parsePorcelainStatus(buf)).toEqual([{ path: "dst.ts", xy: "C ", originalPath: "orig.ts" }]);
    });

    it("parses several mixed records including a rename in the middle", () => {
        const buf = nul("M  a.ts", "R  renamed.ts", "from.ts", "?? untracked.ts", " D deleted.ts");
        expect(parsePorcelainStatus(buf)).toEqual([
            { path: "a.ts", xy: "M " },
            { path: "renamed.ts", xy: "R ", originalPath: "from.ts" },
            { path: "untracked.ts", xy: "??" },
            { path: "deleted.ts", xy: " D" },
        ]);
    });

    it("parses a staged rename with further working-tree edits (`RM`)", () => {
        expect(parsePorcelainStatus(nul("RM new.txt", "old.txt"))).toEqual([
            { path: "new.txt", xy: "RM", originalPath: "old.txt" },
        ]);
    });

    it("parses an intent-to-add rename in the working tree (` R`)", () => {
        expect(parsePorcelainStatus(nul(" R new.txt", "old.txt", " M other.txt"))).toEqual([
            { path: "new.txt", xy: " R", originalPath: "old.txt" },
            { path: "other.txt", xy: " M" },
        ]);
    });

    it("keeps a truncated rename record without inventing an original path", () => {
        expect(parsePorcelainStatus(nul("R  new.txt"))).toEqual([{ path: "new.txt", xy: "R " }]);
    });

    it("handles a final record without a trailing NUL", () => {
        const buf = Buffer.from(" M a.ts\0 M b.ts", "utf8");
        expect(parsePorcelainStatus(buf)).toEqual([
            { path: "a.ts", xy: " M" },
            { path: "b.ts", xy: " M" },
        ]);
    });

    it("preserves multibyte UTF-8 paths", () => {
        expect(parsePorcelainStatus(nul(" M пример.txt"))).toEqual([{ path: "пример.txt", xy: " M" }]);
    });
});

describe("pathAtHead", () => {
    it("is the original path for a staged rename", () => {
        expect(pathAtHead({ path: "new.txt", xy: "R ", originalPath: "old.txt" })).toBe("old.txt");
    });

    it("is the original path for a staged rename edited afterwards", () => {
        expect(pathAtHead({ path: "new.txt", xy: "RM", originalPath: "old.txt" })).toBe("old.txt");
    });

    it("is the original path for an intent-to-add rename", () => {
        expect(pathAtHead({ path: "new.txt", xy: " R", originalPath: "old.txt" })).toBe("old.txt");
    });

    it("is the file's own path for a copy — the source still lives in HEAD on its own", () => {
        expect(pathAtHead({ path: "dst.ts", xy: "C ", originalPath: "orig.ts" })).toBe("dst.ts");
    });

    it("is the file's own path without a rename", () => {
        expect(pathAtHead({ path: "a.ts", xy: " M" })).toBe("a.ts");
    });

    it("is the file's own path for a rename record that lost its original field", () => {
        expect(pathAtHead({ path: "new.txt", xy: "R " })).toBe("new.txt");
    });
});
