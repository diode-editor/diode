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

describe("fileDialogPaths — separators and comparison", () => {
    it("equalsIgnoreCase compares case-insensitively", () => {
        expect(equalsIgnoreCase("/WS/Src", "/ws/src")).toBe(true);
        expect(equalsIgnoreCase("/ws/a", "/ws/b")).toBe(false);
    });

    it("a trailing separator is either of the two", () => {
        expect(endsWithSeparator("/ws/")).toBe(true);
        expect(endsWithSeparator("C:\\ws\\")).toBe(true);
        expect(endsWithSeparator("/ws")).toBe(false);
        expect(endsWithSeparator("/w/s")).toBe(false);
    });

    it("withSeparator appends the separator once", () => {
        expect(withSeparator("/ws")).toBe(`/ws${path.sep}`);
        expect(withSeparator("/ws/")).toBe("/ws/");
    });

    it("stripTrailingSeparator removes the separator but keeps the root", () => {
        expect(stripTrailingSeparator("/ws/")).toBe("/ws");
        expect(stripTrailingSeparator("/ws")).toBe("/ws");
        expect(stripTrailingSeparator("/")).toBe("/");
        expect(stripTrailingSeparator("a/")).toBe("a");
    });

    it("pathsEqual ignores case, a trailing separator and redundant segments", () => {
        expect(pathsEqual("/WS/src/", "/ws/src")).toBe(true);
        expect(pathsEqual("/ws/./src", "/ws/src/")).toBe(true);
        expect(pathsEqual("/ws/src", "/ws/srcs")).toBe(false);
    });

    it("expandTilde expands from the home folder", () => {
        expect(expandTilde("~", "/home/u")).toBe(path.join("/home/u"));
        expect(expandTilde("~/src", "/home/u")).toBe(path.join("/home/u", "src"));
    });
});

describe("fileDialogPaths — joining", () => {
    it("pathAppend keeps typed . and .. as is", () => {
        expect(pathAppend("/ws", "..")).toBe(`/ws${path.sep}..`);
        expect(pathAppend("/ws/", ".")).toBe("/ws/.");
        expect(pathAppend("/ws/", "src")).toBe(path.join("/ws", "src"));
        expect(pathAppend("/ws/src", "../x")).toBe(path.join("/ws", "x"));
    });

    it("startsWithIgnoreCase matches a prefix case-insensitively", () => {
        expect(startsWithIgnoreCase("README.md", "read")).toBe(true);
        expect(startsWithIgnoreCase("readme.md", "READ")).toBe(true);
        expect(startsWithIgnoreCase("readme.md", "me")).toBe(false);
    });
});

describe("fileDialogPaths — names and filters", () => {
    it("isValidBasename rejects empty names, dots, separators and too long names", () => {
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

    it("isValidBasename: Windows-forbidden characters only on Windows", () => {
        expect(isValidBasename("a:b", "linux")).toBe(true);
        expect(isValidBasename("a:b", "win32")).toBe(false);
        expect(isValidBasename("a?", "win32")).toBe(false);
        expect(isValidBasename("ab", "win32")).toBe(true);
    });

    it("isValidBasename defaults to the process platform", () => {
        expect(isValidBasename("a:b")).toBe(process.platform !== "win32");
    });

    it("matchesFilters: no filters match anything, `*` matches anything, otherwise by extension", () => {
        const md = [{ name: "Markdown", extensions: ["md"] }];
        expect(matchesFilters("/ws/a.ts", undefined)).toBe(true);
        expect(matchesFilters("/ws/a.md", md)).toBe(true);
        expect(matchesFilters("/ws/a.ts", md)).toBe(false);
        expect(matchesFilters("/ws/amd", md)).toBe(false);
        expect(matchesFilters("/ws/a.ts", [...md, { name: "All", extensions: ["*"] }])).toBe(true);
        expect(matchesFilters("/ws/a.ts", [{ name: "Code", extensions: ["go", "ts"] }])).toBe(true);
    });

    it("withFilterExtension appends the first extension of the first filter if none matches", () => {
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

    it("withFilterExtension leaves a folder, a path without filters and empty filters alone", () => {
        const text = [{ name: "Text", extensions: ["txt"] }];
        expect(withFilterExtension("/ws/dir/", text)).toBe("/ws/dir/");
        expect(withFilterExtension("/ws/notes", undefined)).toBe("/ws/notes");
        expect(withFilterExtension("/ws/notes", [])).toBe("/ws/notes");
        expect(withFilterExtension("/ws/notes", [{ name: "Empty", extensions: [] }])).toBe("/ws/notes");
    });
});
