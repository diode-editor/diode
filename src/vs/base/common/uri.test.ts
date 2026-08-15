import { describe, expect, it } from "vitest";

import { Uri } from "./uri.ts";

describe("Uri — file-схема", () => {
    it("file() строит абсолютный путь и fsPath", () => {
        const u = Uri.file("/a/b.txt");
        expect(u.scheme).toBe("file");
        expect(u.path).toBe("/a/b.txt");
        expect(u.fsPath).toBe("/a/b.txt");
        expect(u.toString()).toBe("file:///a/b.txt");
    });

    it("file() НЕ резолвит относительный путь против cwd — только префиксует слэшем", () => {
        // Ловушка миграции: path.resolve() ушёл бы в cwd, Uri.file() — нет.
        // Резолвить надо ДО подъёма в Uri.
        expect(Uri.file("rel/x.ts").path).toBe("/rel/x.ts");
    });

    it("parse() сохраняет authority (UNC)", () => {
        const u = Uri.parse("file://host/p");
        expect(u.authority).toBe("host");
        expect(u.path).toBe("/p");
        expect(u.fsPath).toBe("//host/p");
    });

    it("toString() кодирует пробелы и спецсимволы, toString(true) — нет", () => {
        const u = Uri.file("/a b/c!.ts");
        expect(u.toString()).toBe("file:///a%20b/c%21.ts");
        expect(u.toString(true)).toBe("file:///a b/c!.ts");
    });
});

describe("Uri — не-file схемы", () => {
    it("parse() разбирает untitled: (схема без //)", () => {
        const u = Uri.parse("untitled:Untitled-1");
        expect(u.scheme).toBe("untitled");
        expect(u.path).toBe("Untitled-1");
        expect(u.toString()).toBe("untitled:Untitled-1");
    });

    it("parse() разбирает git: и достаёт состояние из query", () => {
        const u = Uri.parse("git:/foo.ts?%7B%22ref%22%3A%22HEAD%22%7D");
        expect(u.scheme).toBe("git");
        expect(u.path).toBe("/foo.ts");
        expect(u.query).toBe('{"ref":"HEAD"}');
    });

    it("parse() разбирает output:", () => {
        const u = Uri.parse("output:extension-output-diode");
        expect(u.scheme).toBe("output");
        expect(u.path).toBe("extension-output-diode");
    });

    it("parse() разбирает vscode-vfs:// с authority", () => {
        const u = Uri.parse("vscode-vfs://github/owner/repo/f.ts");
        expect(u.scheme).toBe("vscode-vfs");
        expect(u.authority).toBe("github");
        expect(u.path).toBe("/owner/repo/f.ts");
    });

    it("fsPath у не-file схемы возвращает путь как есть и НЕ бросает", () => {
        // Поэтому дисковые операции гейтим по scheme, а не по «путь непустой».
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
    ])("parse(toString(%s)) даёт исходный uri", (raw) => {
        expect(Uri.parse(raw).toString()).toBe(raw);
    });
});

describe("Uri — joinPath", () => {
    it("доступен как статик (расширения ждут vscode.Uri.joinPath)", () => {
        expect(typeof Uri.joinPath).toBe("function");
        expect(Uri.joinPath(Uri.file("/a"), "b", "c.ts").toString()).toBe("file:///a/b/c.ts");
    });

    it("нормализует .. и .", () => {
        expect(Uri.joinPath(Uri.file("/a/b"), "../c").path).toBe("/a/c");
    });

    it("сохраняет схему, а не подменяет её на file", () => {
        expect(Uri.joinPath(Uri.parse("untitled:Untitled-1"), "x").scheme).toBe("untitled");
    });

    it("сохраняет identity класса — instanceof работает внутри расширений", () => {
        expect(Uri.file("/a") instanceof Uri).toBe(true);
    });
});

describe("Uri — with", () => {
    it("меняет схему, оставляя остальное (untitled: → file: при Save As)", () => {
        const saved = Uri.parse("untitled:Untitled-1").with({ scheme: "file", path: "/a/note.txt" });
        expect(saved.toString()).toBe("file:///a/note.txt");
        expect(saved.fsPath).toBe("/a/note.txt");
    });

    it("from() строит uri из частей", () => {
        expect(Uri.from({ scheme: "untitled", path: "Untitled-7" }).toString()).toBe("untitled:Untitled-7");
    });
});
