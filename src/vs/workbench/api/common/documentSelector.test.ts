import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { scoreDocumentSelector, toWireLanguageFilters } from "./documentSelector.ts";
import { DocumentRegistry } from "./extHostDocuments.ts";
import { RelativePattern, Uri } from "./vscodeTypes.ts";

function doc(fileName: string, languageId: string) {
    const registry = new DocumentRegistry();
    return registry.upsertMeta({ uri: Uri.file(fileName).toString(), languageId });
}

/** score > 0 is the threshold languageclient reads. */
function matchDocumentSelector(selector: vscode.DocumentSelector, document: ReturnType<typeof doc>): boolean {
    return scoreDocumentSelector(selector, document) > 0;
}

describe("scoreDocumentSelector — the real score, as in the core registry", () => {
    it("exact match is 10, `*` is 5, a miss is 0", () => {
        const md = doc("/home/u/proj/README.md", "markdown");
        expect(scoreDocumentSelector("markdown", md)).toBe(10);
        expect(scoreDocumentSelector("*", md)).toBe(5);
        expect(scoreDocumentSelector(["*", "markdown"], md)).toBe(10);
        expect(scoreDocumentSelector({ language: "markdown", scheme: "file" }, md)).toBe(10);
        expect(scoreDocumentSelector("typescript", md)).toBe(0);
    });

    it("RelativePattern matches the path relative to the base", () => {
        const md = doc("/home/u/proj/docs/a.md", "markdown");
        const inDocs = new RelativePattern(Uri.file("/home/u/proj/docs"), "*.md") as unknown as vscode.RelativePattern;
        const inSrc = new RelativePattern(Uri.file("/home/u/proj/src"), "*.md") as unknown as vscode.RelativePattern;
        expect(scoreDocumentSelector({ pattern: inDocs }, md)).toBe(10);
        expect(scoreDocumentSelector({ pattern: inSrc }, md)).toBe(0);
    });
});

describe("matchDocumentSelector", () => {
    const editorconfig = doc("/home/u/proj/.editorconfig", "editorconfig");

    it("a string selector is sugar for language", () => {
        expect(matchDocumentSelector("editorconfig", editorconfig)).toBe(true);
        expect(matchDocumentSelector("ini", editorconfig)).toBe(false);
    });

    it("'*' matches any language", () => {
        expect(matchDocumentSelector("*", editorconfig)).toBe(true);
        expect(matchDocumentSelector({ language: "*" } as vscode.DocumentFilter, editorconfig)).toBe(true);
    });

    it("language filter", () => {
        expect(matchDocumentSelector({ language: "editorconfig" } as vscode.DocumentFilter, editorconfig)).toBe(true);
        expect(matchDocumentSelector({ language: "ini" } as vscode.DocumentFilter, editorconfig)).toBe(false);
    });

    it("scheme defaults to file", () => {
        expect(matchDocumentSelector({ scheme: "file" } as vscode.DocumentFilter, editorconfig)).toBe(true);
        expect(matchDocumentSelector({ scheme: "untitled" } as vscode.DocumentFilter, editorconfig)).toBe(false);
    });

    it("pattern glob with globstar", () => {
        const sel = { language: "editorconfig", pattern: "**/.editorconfig" } as vscode.DocumentFilter;
        expect(matchDocumentSelector(sel, editorconfig)).toBe(true);
        expect(matchDocumentSelector(sel, doc("/home/u/proj/foo.txt", "editorconfig"))).toBe(false);
    });

    it("pattern '*' stays within one segment and does not cross /", () => {
        const sel = { pattern: "/home/u/proj/*.ts" } as vscode.DocumentFilter;
        expect(matchDocumentSelector(sel, doc("/home/u/proj/a.ts", "typescript"))).toBe(true);
        expect(matchDocumentSelector(sel, doc("/home/u/proj/sub/a.ts", "typescript"))).toBe(false);
    });

    it("globstar not followed by '/' expands to '.*'", () => {
        const sel = { pattern: "**.ts" } as vscode.DocumentFilter;
        expect(matchDocumentSelector(sel, doc("/a/b/c.ts", "typescript"))).toBe(true);
        expect(matchDocumentSelector(sel, doc("/a/b/c.js", "typescript"))).toBe(false);
    });

    it("pattern '?' matches exactly one character (not '/')", () => {
        const sel = { pattern: "/p/foo?.ts" } as vscode.DocumentFilter;
        expect(matchDocumentSelector(sel, doc("/p/foo1.ts", "typescript"))).toBe(true);
        expect(matchDocumentSelector(sel, doc("/p/foo.ts", "typescript"))).toBe(false);
    });

    it("an array is any-match", () => {
        const sel = ["ini", { language: "editorconfig" }] as vscode.DocumentSelector;
        expect(matchDocumentSelector(sel, editorconfig)).toBe(true);
        expect(matchDocumentSelector(["ini", "xml"] as vscode.DocumentSelector, editorconfig)).toBe(false);
    });

    it("an empty filter does not match", () => {
        expect(matchDocumentSelector({} as vscode.DocumentFilter, editorconfig)).toBe(false);
    });
});

describe("toWireLanguageFilters", () => {
    it("a string becomes { language }, a single filter becomes a one-element array", () => {
        expect(toWireLanguageFilters("typescript")).toEqual([{ language: "typescript" }]);
        expect(toWireLanguageFilters({ language: "ts", scheme: "file" })).toEqual([{ language: "ts", scheme: "file" }]);
    });

    it("an array is expanded per element, empty fields do not appear", () => {
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

    it("notebookType and exclusive outside the active surface are read structurally", () => {
        const filter = { language: "python", notebookType: "jupyter", exclusive: true } as vscode.DocumentFilter;
        expect(toWireLanguageFilters(filter)).toEqual([
            { language: "python", notebookType: "jupyter", exclusive: true },
        ]);
        const junk = { language: "python", notebookType: 1, exclusive: "yes" } as unknown as vscode.DocumentFilter;
        expect(toWireLanguageFilters(junk)).toEqual([{ language: "python" }]);
    });
});
