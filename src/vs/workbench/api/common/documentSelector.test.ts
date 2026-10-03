import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { matchDocumentSelector, toWireLanguageFilters } from "./documentSelector.ts";
import { DocumentRegistry } from "./extHostDocuments.ts";
import { RelativePattern, Uri } from "./vscodeTypes.ts";

function doc(fileName: string, languageId: string) {
    const registry = new DocumentRegistry();
    return registry.upsertMeta({ uri: Uri.file(fileName).toString(), languageId });
}

describe("matchDocumentSelector", () => {
    const editorconfig = doc("/home/u/proj/.editorconfig", "editorconfig");

    it("строковый селектор — сахар для language", () => {
        expect(matchDocumentSelector("editorconfig", editorconfig)).toBe(true);
        expect(matchDocumentSelector("ini", editorconfig)).toBe(false);
    });

    it("'*' матчит любой язык", () => {
        expect(matchDocumentSelector("*", editorconfig)).toBe(true);
        expect(matchDocumentSelector({ language: "*" } as vscode.DocumentFilter, editorconfig)).toBe(true);
    });

    it("language-фильтр", () => {
        expect(matchDocumentSelector({ language: "editorconfig" } as vscode.DocumentFilter, editorconfig)).toBe(true);
        expect(matchDocumentSelector({ language: "ini" } as vscode.DocumentFilter, editorconfig)).toBe(false);
    });

    it("scheme по умолчанию file", () => {
        expect(matchDocumentSelector({ scheme: "file" } as vscode.DocumentFilter, editorconfig)).toBe(true);
        expect(matchDocumentSelector({ scheme: "untitled" } as vscode.DocumentFilter, editorconfig)).toBe(false);
    });

    it("pattern glob со globstar", () => {
        const sel = { language: "editorconfig", pattern: "**/.editorconfig" } as vscode.DocumentFilter;
        expect(matchDocumentSelector(sel, editorconfig)).toBe(true);
        expect(matchDocumentSelector(sel, doc("/home/u/proj/foo.txt", "editorconfig"))).toBe(false);
    });

    it("pattern '*' внутри одного сегмента не пересекает /", () => {
        const sel = { pattern: "/home/u/proj/*.ts" } as vscode.DocumentFilter;
        expect(matchDocumentSelector(sel, doc("/home/u/proj/a.ts", "typescript"))).toBe(true);
        expect(matchDocumentSelector(sel, doc("/home/u/proj/sub/a.ts", "typescript"))).toBe(false);
    });

    it("globstar не перед '/' раскрывается в '.*'", () => {
        const sel = { pattern: "**.ts" } as vscode.DocumentFilter;
        expect(matchDocumentSelector(sel, doc("/a/b/c.ts", "typescript"))).toBe(true);
        expect(matchDocumentSelector(sel, doc("/a/b/c.js", "typescript"))).toBe(false);
    });

    it("pattern '?' матчит ровно один символ (не '/')", () => {
        const sel = { pattern: "/p/foo?.ts" } as vscode.DocumentFilter;
        expect(matchDocumentSelector(sel, doc("/p/foo1.ts", "typescript"))).toBe(true);
        expect(matchDocumentSelector(sel, doc("/p/foo.ts", "typescript"))).toBe(false);
    });

    it("массив — any-match", () => {
        const sel = ["ini", { language: "editorconfig" }] as vscode.DocumentSelector;
        expect(matchDocumentSelector(sel, editorconfig)).toBe(true);
        expect(matchDocumentSelector(["ini", "xml"] as vscode.DocumentSelector, editorconfig)).toBe(false);
    });

    it("пустой фильтр не матчит", () => {
        expect(matchDocumentSelector({} as vscode.DocumentFilter, editorconfig)).toBe(false);
    });
});

describe("toWireLanguageFilters", () => {
    it("строка → { language }, одиночный фильтр → массив из одного", () => {
        expect(toWireLanguageFilters("typescript")).toEqual([{ language: "typescript" }]);
        expect(toWireLanguageFilters({ language: "ts", scheme: "file" })).toEqual([{ language: "ts", scheme: "file" }]);
    });

    it("массив разворачивается поэлементно, пустые поля не появляются", () => {
        expect(toWireLanguageFilters(["ini", { scheme: "untitled" }, { pattern: "**/*.json" }])).toEqual([
            { language: "ini" },
            { scheme: "untitled" },
            { pattern: "**/*.json" },
        ]);
    });

    it("RelativePattern → { base: fsPath, pattern }", () => {
        const pattern = new RelativePattern(Uri.file("/home/u/proj"), "*.json") as unknown as vscode.RelativePattern;
        expect(toWireLanguageFilters({ pattern })).toEqual([{ pattern: { base: "/home/u/proj", pattern: "*.json" } }]);
    });

    it("notebookType и exclusive вне активной поверхности читаются структурно", () => {
        const filter = { language: "python", notebookType: "jupyter", exclusive: true } as vscode.DocumentFilter;
        expect(toWireLanguageFilters(filter)).toEqual([
            { language: "python", notebookType: "jupyter", exclusive: true },
        ]);
        const junk = { language: "python", notebookType: 1, exclusive: "yes" } as unknown as vscode.DocumentFilter;
        expect(toWireLanguageFilters(junk)).toEqual([{ language: "python" }]);
    });
});
