import { describe, expect, it } from "vitest";

import { Uri } from "./vscodeTypes.ts";

describe("VscodeTypes — Uri (file scheme)", () => {
    it("file() sets scheme=file, path=fsPath", () => {
        const u = Uri.file("/a/b.txt");
        expect(u.scheme).toBe("file");
        expect(u.path).toBe("/a/b.txt");
        expect(u.fsPath).toBe("/a/b.txt");
    });

    it("file() adds a leading slash to relative paths", () => {
        expect(Uri.file("a/b.txt").path).toBe("/a/b.txt");
    });

    it("parse() parses a file:// URI", () => {
        const u = Uri.parse("file:///a/b");
        expect(u.scheme).toBe("file");
        expect(u.path).toBe("/a/b");
    });

    it("parse() without a path gives path='/'", () => {
        const u = Uri.parse("file://host");
        expect(u.scheme).toBe("file");
        expect(u.path).toBe("/");
    });

    it("parse() without a scheme treats the string as a file path", () => {
        const u = Uri.parse("/plain/path");
        expect(u.scheme).toBe("file");
        expect(u.path).toBe("/plain/path");
    });

    it("joinPath() joins only the path", () => {
        const u = Uri.joinPath(Uri.file("/a"), "b", "c");
        expect(u.scheme).toBe("file");
        expect(u.path).toBe("/a/b/c");
    });

    it("joinPath() normalizes .. and .", () => {
        expect(Uri.joinPath(Uri.file("/a/b"), "../c").path).toBe("/a/c");
    });

    it("toString() returns file:///...", () => {
        expect(Uri.file("/a/b.txt").toString()).toBe("file:///a/b.txt");
    });
});
