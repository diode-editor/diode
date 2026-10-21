import { describe, expect, it } from "vitest";

import { Uri } from "./uri.ts";

describe("Uri — file scheme", () => {
    it("file() builds an absolute path and fsPath", () => {
        const u = Uri.file("/a/b.txt");
        expect(u.scheme).toBe("file");
        expect(u.path).toBe("/a/b.txt");
        expect(u.fsPath).toBe("/a/b.txt");
        expect(u.toString()).toBe("file:///a/b.txt");
    });

    it("file() does NOT resolve a relative path against cwd — it only prefixes a slash", () => {
        // Migration trap: path.resolve() would go to cwd, Uri.file() doesn't.
        // Resolve BEFORE lifting into a Uri.
        expect(Uri.file("rel/x.ts").path).toBe("/rel/x.ts");
    });

    it("parse() keeps the authority (UNC)", () => {
        const u = Uri.parse("file://host/p");
        expect(u.authority).toBe("host");
        expect(u.path).toBe("/p");
        expect(u.fsPath).toBe("//host/p");
    });

    it("toString() encodes spaces and special characters, toString(true) does not", () => {
        const u = Uri.file("/a b/c!.ts");
        expect(u.toString()).toBe("file:///a%20b/c%21.ts");
        expect(u.toString(true)).toBe("file:///a b/c!.ts");
    });
});

describe("Uri — non-file schemes", () => {
    it("parse() handles untitled: (scheme without //)", () => {
        const u = Uri.parse("untitled:Untitled-1");
        expect(u.scheme).toBe("untitled");
        expect(u.path).toBe("Untitled-1");
        expect(u.toString()).toBe("untitled:Untitled-1");
    });

    it("parse() handles git: and extracts the state from the query", () => {
        const u = Uri.parse("git:/foo.ts?%7B%22ref%22%3A%22HEAD%22%7D");
        expect(u.scheme).toBe("git");
        expect(u.path).toBe("/foo.ts");
        expect(u.query).toBe('{"ref":"HEAD"}');
    });

    it("parse() handles output:", () => {
        const u = Uri.parse("output:extension-output-diode");
        expect(u.scheme).toBe("output");
        expect(u.path).toBe("extension-output-diode");
    });

    it("parse() handles vscode-vfs:// with an authority", () => {
        const u = Uri.parse("vscode-vfs://github/owner/repo/f.ts");
        expect(u.scheme).toBe("vscode-vfs");
        expect(u.authority).toBe("github");
        expect(u.path).toBe("/owner/repo/f.ts");
    });

    it("fsPath of a non-file scheme returns the path as is and does NOT throw", () => {
        // Hence disk operations are gated on scheme, not on "the path is non-empty".
        expect(Uri.parse("untitled:Untitled-1").fsPath).toBe("Untitled-1");
    });
});

describe("Uri — round-trip", () => {
    it.each([
        "file:///a/b.txt",
        "file:///a%20b/c.txt",
        "file://host/p",
        "untitled:Untitled-1",
        "output:extension-output-diode",
        "vscode-vfs://github/owner/repo/f.ts",
        "git:/foo.ts?%7B%22ref%22%3A%22HEAD%22%7D",
    ])("parse(toString(%s)) gives back the original uri", (raw) => {
        expect(Uri.parse(raw).toString()).toBe(raw);
    });
});

describe("Uri — joinPath", () => {
    it("is available as a static (extensions expect vscode.Uri.joinPath)", () => {
        expect(typeof Uri.joinPath).toBe("function");
        expect(Uri.joinPath(Uri.file("/a"), "b", "c.ts").toString()).toBe("file:///a/b/c.ts");
    });

    it("normalizes .. and .", () => {
        expect(Uri.joinPath(Uri.file("/a/b"), "../c").path).toBe("/a/c");
    });

    it("keeps the scheme instead of replacing it with file", () => {
        expect(Uri.joinPath(Uri.parse("untitled:Untitled-1"), "x").scheme).toBe("untitled");
    });

    it("keeps the class identity — instanceof works inside extensions", () => {
        expect(Uri.file("/a") instanceof Uri).toBe(true);
    });
});

describe("Uri — with", () => {
    it("changes the scheme, keeping the rest (untitled: → file: on Save As)", () => {
        const saved = Uri.parse("untitled:Untitled-1").with({ scheme: "file", path: "/a/note.txt" });
        expect(saved.toString()).toBe("file:///a/note.txt");
        expect(saved.fsPath).toBe("/a/note.txt");
    });

    it("from() builds a uri from components", () => {
        expect(Uri.from({ scheme: "untitled", path: "Untitled-7" }).toString()).toBe("untitled:Untitled-7");
    });
});
