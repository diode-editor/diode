import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { ExtensionPaths } from "./extensionPaths.ts";

// Paths are built via path.resolve so the test doesn't depend on the platform separator.
const p = (...segments: string[]): string => path.resolve("/", ...segments);

describe("ExtensionPaths", () => {
    it("a file inside the root belongs to the extension, and so does the root itself", () => {
        const paths = new ExtensionPaths();
        paths.add(p("ext", "foo"), "pub.foo");
        expect(paths.findByPath(p("ext", "foo", "dist", "main.js"))).toBe("pub.foo");
        expect(paths.findByPath(p("ext", "foo"))).toBe("pub.foo");
    });

    it("prefix is matched by segments: /ext/foo does not match /ext/foobar", () => {
        const paths = new ExtensionPaths();
        paths.add(p("ext", "foo"), "pub.foo");
        expect(paths.findByPath(p("ext", "foobar", "main.js"))).toBeUndefined();
    });

    it("outside all roots — undefined", () => {
        const paths = new ExtensionPaths();
        paths.add(p("ext", "foo"), "pub.foo");
        expect(paths.findByPath(p("other", "main.js"))).toBeUndefined();
        expect(paths.findByPath(p("ext"))).toBeUndefined();
    });

    it("a nested root wins over the outer one (longest prefix)", () => {
        const paths = new ExtensionPaths();
        paths.add(p("ext", "outer"), "pub.outer");
        paths.add(p("ext", "outer", "node_modules", "inner"), "pub.inner");
        expect(paths.findByPath(p("ext", "outer", "node_modules", "inner", "x.js"))).toBe("pub.inner");
        expect(paths.findByPath(p("ext", "outer", "node_modules", "other", "x.js"))).toBe("pub.outer");
    });

    it("root and path are normalized: a trailing separator and `..` do not interfere", () => {
        const paths = new ExtensionPaths();
        paths.add(p("ext", "foo") + path.sep, "pub.foo");
        expect(paths.findByPath(p("ext", "foo", "lib", "..", "main.js"))).toBe("pub.foo");
    });

    it("a repeated add of the same root overwrites the id", () => {
        const paths = new ExtensionPaths();
        paths.add(p("ext", "foo"), "pub.old");
        paths.add(p("ext", "foo"), "pub.new");
        expect(paths.findByPath(p("ext", "foo", "main.js"))).toBe("pub.new");
    });

    it("a root behind a symlink is recognized by both the real path and the link", () => {
        const paths = new ExtensionPaths({
            realpath: (link) => (link === p("link", "foo") ? p("real", "foo") : link),
        });
        paths.add(p("link", "foo"), "pub.foo");
        expect(paths.findByPath(p("real", "foo", "main.js"))).toBe("pub.foo");
        expect(paths.findByPath(p("link", "foo", "main.js"))).toBe("pub.foo");
    });

    it("realpath threw (root is not on disk) — the root is indexed as is", () => {
        const paths = new ExtensionPaths({
            realpath: () => {
                throw new Error("ENOENT");
            },
        });
        paths.add(p("extensions", "git", "dist"), "vscode.git");
        expect(paths.findByPath(p("extensions", "git", "dist", "main.js"))).toBe("vscode.git");
    });
});
