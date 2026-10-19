import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
    endsWithSeparator,
    equalsIgnoreCase,
    expandTilde,
    isValidBasename,
    matchesFilters,
    pathAppend,
    pathsEqual,
    startsWithIgnoreCase,
    stripTrailingSeparator,
    withFilterExtension,
    withSeparator,
} from "./fileDialogPaths.ts";

describe("fileDialogPaths — разделители и сравнение", () => {
    it("equalsIgnoreCase сравнивает без регистра", () => {
        expect(equalsIgnoreCase("/WS/Src", "/ws/src")).toBe(true);
        expect(equalsIgnoreCase("/ws/a", "/ws/b")).toBe(false);
    });

    it("разделитель на конце — любой из двух", () => {
        expect(endsWithSeparator("/ws/")).toBe(true);
        expect(endsWithSeparator("C:\\ws\\")).toBe(true);
        expect(endsWithSeparator("/ws")).toBe(false);
        expect(endsWithSeparator("/w/s")).toBe(false);
    });

    it("withSeparator дописывает разделитель один раз", () => {
        expect(withSeparator("/ws")).toBe(`/ws${path.sep}`);
        expect(withSeparator("/ws/")).toBe("/ws/");
    });

    it("stripTrailingSeparator снимает разделитель, но корень оставляет", () => {
        expect(stripTrailingSeparator("/ws/")).toBe("/ws");
        expect(stripTrailingSeparator("/ws")).toBe("/ws");
        expect(stripTrailingSeparator("/")).toBe("/");
        expect(stripTrailingSeparator("a/")).toBe("a");
    });

    it("pathsEqual — без регистра, разделителя на конце и лишних сегментов", () => {
        expect(pathsEqual("/WS/src/", "/ws/src")).toBe(true);
        expect(pathsEqual("/ws/./src", "/ws/src/")).toBe(true);
        expect(pathsEqual("/ws/src", "/ws/srcs")).toBe(false);
    });

    it("expandTilde — от домашнего каталога", () => {
        expect(expandTilde("~", "/home/u")).toBe(path.join("/home/u"));
        expect(expandTilde("~/src", "/home/u")).toBe(path.join("/home/u", "src"));
    });
});

describe("fileDialogPaths — склейка", () => {
    it("pathAppend оставляет набранные . и .. как есть", () => {
        expect(pathAppend("/ws", "..")).toBe(`/ws${path.sep}..`);
        expect(pathAppend("/ws/", ".")).toBe("/ws/.");
        expect(pathAppend("/ws/", "src")).toBe(path.join("/ws", "src"));
        expect(pathAppend("/ws/src", "../x")).toBe(path.join("/ws", "x"));
    });

    it("startsWithIgnoreCase — начало без учёта регистра", () => {
        expect(startsWithIgnoreCase("README.md", "read")).toBe(true);
        expect(startsWithIgnoreCase("readme.md", "READ")).toBe(true);
        expect(startsWithIgnoreCase("readme.md", "me")).toBe(false);
    });
});

describe("fileDialogPaths — имена и фильтры", () => {
    it("isValidBasename отвергает пустое, точки, разделители и слишком длинное", () => {
        expect(isValidBasename("a.txt", "linux")).toBe(true);
        expect(isValidBasename("", "linux")).toBe(false);
        expect(isValidBasename(".", "linux")).toBe(false);
        expect(isValidBasename("..", "linux")).toBe(false);
        expect(isValidBasename("...", "linux")).toBe(true);
        expect(isValidBasename("a/b", "linux")).toBe(false);
        expect(isValidBasename("a\\b", "linux")).toBe(false);
        expect(isValidBasename("x".repeat(255), "linux")).toBe(true);
        expect(isValidBasename("x".repeat(256), "linux")).toBe(false);
    });

    it("isValidBasename: запрещённые Windows символы — только на Windows", () => {
        expect(isValidBasename("a:b", "linux")).toBe(true);
        expect(isValidBasename("a:b", "win32")).toBe(false);
        expect(isValidBasename("a?", "win32")).toBe(false);
        expect(isValidBasename("ab", "win32")).toBe(true);
    });

    it("isValidBasename по умолчанию — платформа процесса", () => {
        expect(isValidBasename("a:b")).toBe(process.platform !== "win32");
    });

    it("matchesFilters: без фильтров — любой, `*` — любой, иначе по расширению", () => {
        const md = [{ name: "Markdown", extensions: ["md"] }];
        expect(matchesFilters("/ws/a.ts", undefined)).toBe(true);
        expect(matchesFilters("/ws/a.md", md)).toBe(true);
        expect(matchesFilters("/ws/a.ts", md)).toBe(false);
        expect(matchesFilters("/ws/amd", md)).toBe(false);
        expect(matchesFilters("/ws/a.ts", [...md, { name: "All", extensions: ["*"] }])).toBe(true);
        expect(matchesFilters("/ws/a.ts", [{ name: "Code", extensions: ["go", "ts"] }])).toBe(true);
    });

    it("withFilterExtension дописывает первое расширение первого фильтра, если подходящего нет", () => {
        const text = [
            { name: "Text", extensions: ["txt", "log"] },
            { name: "Data", extensions: ["csv"] },
        ];
        expect(withFilterExtension("/ws/notes", text)).toBe("/ws/notes.txt");
        expect(withFilterExtension("/ws/notes.md", text)).toBe("/ws/notes.md.txt");
        expect(withFilterExtension("/ws/notes.log", text)).toBe("/ws/notes.log");
        expect(withFilterExtension("/ws/notes.csv", text)).toBe("/ws/notes.csv");
        expect(withFilterExtension("/ws/notes", [{ name: "All", extensions: ["*"] }])).toBe("/ws/notes");
    });

    it("withFilterExtension не трогает каталог, путь без фильтров и пустые фильтры", () => {
        const text = [{ name: "Text", extensions: ["txt"] }];
        expect(withFilterExtension("/ws/dir/", text)).toBe("/ws/dir/");
        expect(withFilterExtension("/ws/notes", undefined)).toBe("/ws/notes");
        expect(withFilterExtension("/ws/notes", [])).toBe("/ws/notes");
        expect(withFilterExtension("/ws/notes", [{ name: "Empty", extensions: [] }])).toBe("/ws/notes");
    });
});
