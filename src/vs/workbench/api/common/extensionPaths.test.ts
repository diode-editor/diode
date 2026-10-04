import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { ExtensionPaths } from "./extensionPaths.ts";

// Пути строим через path.resolve — тест не зависит от разделителя платформы.
const p = (...segments: string[]): string => path.resolve("/", ...segments);

describe("ExtensionPaths", () => {
    it("файл внутри корня принадлежит расширению, сам корень — тоже", () => {
        const paths = new ExtensionPaths();
        paths.add(p("ext", "foo"), "pub.foo");
        expect(paths.findByPath(p("ext", "foo", "dist", "main.js"))).toBe("pub.foo");
        expect(paths.findByPath(p("ext", "foo"))).toBe("pub.foo");
    });

    it("префикс считается по сегментам: /ext/foo не матчит /ext/foobar", () => {
        const paths = new ExtensionPaths();
        paths.add(p("ext", "foo"), "pub.foo");
        expect(paths.findByPath(p("ext", "foobar", "main.js"))).toBeUndefined();
    });

    it("вне всех корней — undefined", () => {
        const paths = new ExtensionPaths();
        paths.add(p("ext", "foo"), "pub.foo");
        expect(paths.findByPath(p("other", "main.js"))).toBeUndefined();
        expect(paths.findByPath(p("ext"))).toBeUndefined();
    });

    it("вложенный корень выигрывает у внешнего (самый длинный префикс)", () => {
        const paths = new ExtensionPaths();
        paths.add(p("ext", "outer"), "pub.outer");
        paths.add(p("ext", "outer", "node_modules", "inner"), "pub.inner");
        expect(paths.findByPath(p("ext", "outer", "node_modules", "inner", "x.js"))).toBe("pub.inner");
        expect(paths.findByPath(p("ext", "outer", "node_modules", "other", "x.js"))).toBe("pub.outer");
    });

    it("корень и путь нормализуются: хвостовой разделитель и `..` не мешают", () => {
        const paths = new ExtensionPaths();
        paths.add(p("ext", "foo") + path.sep, "pub.foo");
        expect(paths.findByPath(p("ext", "foo", "lib", "..", "main.js"))).toBe("pub.foo");
    });

    it("повторный add того же корня перезаписывает id", () => {
        const paths = new ExtensionPaths();
        paths.add(p("ext", "foo"), "pub.old");
        paths.add(p("ext", "foo"), "pub.new");
        expect(paths.findByPath(p("ext", "foo", "main.js"))).toBe("pub.new");
    });

    it("корень за симлинком опознаётся и по реальному пути, и по ссылке", () => {
        const paths = new ExtensionPaths({
            realpath: (link) => (link === p("link", "foo") ? p("real", "foo") : link),
        });
        paths.add(p("link", "foo"), "pub.foo");
        expect(paths.findByPath(p("real", "foo", "main.js"))).toBe("pub.foo");
        expect(paths.findByPath(p("link", "foo", "main.js"))).toBe("pub.foo");
    });

    it("realpath бросил (корня нет на диске) — корень индексируется как есть", () => {
        const paths = new ExtensionPaths({
            realpath: () => {
                throw new Error("ENOENT");
            },
        });
        paths.add(p("extensions", "git", "dist"), "vscode.git");
        expect(paths.findByPath(p("extensions", "git", "dist", "main.js"))).toBe("vscode.git");
    });
});
