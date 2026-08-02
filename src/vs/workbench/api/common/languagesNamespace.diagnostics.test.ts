import type * as vscode from "vscode";

import { describe, expect, it } from "vitest";

import { DocumentRegistry } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { Diagnostic, DiagnosticSeverity, Range, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function makeLanguages(stub: IStubRpc = makeStubRpc()) {
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry: new DocumentRegistry(),
        configStore: new WorkspaceConfigStore(),
    };
    return { stub, languages: createLanguagesNamespace(ctx).languages };
}

function published(stub: IStubRpc): { owner: string; resource: string; markers: unknown[] }[] {
    return stub.notifies
        .filter((n) => n.method === "diagnostics.publish")
        .map((n) => n.params as { owner: string; resource: string; markers: unknown[] });
}

const FILE = Uri.file("/proj/main.ts");

describe("LanguagesNamespace — createDiagnosticCollection", () => {
    it("set(uri, diags) публикует wire-маркеры с owner коллекции", () => {
        const { stub, languages } = makeLanguages();
        const collection = languages.createDiagnosticCollection("ts");
        const diag = new Diagnostic(new Range(1, 2, 1, 9), "Type error", DiagnosticSeverity.Warning);
        diag.source = "ts";
        diag.code = 2322;

        collection.set(FILE as unknown as vscode.Uri, [diag as unknown as vscode.Diagnostic]);

        expect(published(stub)).toEqual([
            {
                owner: "ext:ts",
                resource: FILE.toString(),
                markers: [
                    {
                        severity: DiagnosticSeverity.Warning,
                        startLine: 1,
                        startCharacter: 2,
                        endLine: 1,
                        endCharacter: 9,
                        message: "Type error",
                        code: "2322",
                        source: "ts",
                    },
                ],
            },
        ]);
    });

    it("кривые поля диагностики уходят к дефолтам (severity 0, пустой range, строковый message)", () => {
        const { stub, languages } = makeLanguages();
        const collection = languages.createDiagnosticCollection();
        collection.set(FILE as unknown as vscode.Uri, [{} as unknown as vscode.Diagnostic]);

        expect(published(stub)[0]).toMatchObject({
            owner: "ext:diagnostics",
            markers: [{ severity: 0, startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0, message: "" }],
        });
    });

    it("set(entries[]) — перегрузка массива пар; string-uri нормализуется", () => {
        const { stub, languages } = makeLanguages();
        const collection = languages.createDiagnosticCollection("multi");
        const other = Uri.file("/proj/other.ts");
        const diag = new Diagnostic(new Range(0, 0, 0, 1), "x") as unknown as vscode.Diagnostic;

        collection.set([
            [FILE as unknown as vscode.Uri, [diag]],
            [other as unknown as vscode.Uri, undefined],
        ]);
        (collection as unknown as { set(uri: unknown, d: unknown[]): void }).set(FILE.toString(), []);

        const events = published(stub);
        expect(events.map((e) => e.resource)).toEqual([FILE.toString(), other.toString(), FILE.toString()]);
        expect(events[0].markers).toHaveLength(1);
        expect(events[1].markers).toEqual([]);
        expect(events[2].markers).toEqual([]);
    });

    it("get/has/forEach/итератор отдают ОРИГИНАЛЬНЫЕ диагностики, delete/clear публикуют пусто", () => {
        const { stub, languages } = makeLanguages();
        const collection = languages.createDiagnosticCollection("ts");
        const diag = new Diagnostic(new Range(0, 0, 0, 1), "x") as unknown as vscode.Diagnostic;
        collection.set(FILE as unknown as vscode.Uri, [diag]);

        expect(collection.has(FILE as unknown as vscode.Uri)).toBe(true);
        expect(collection.get(FILE as unknown as vscode.Uri)?.[0]).toBe(diag);

        const seen: { uri: string; count: number; self: unknown }[] = [];
        collection.forEach((uri, diags, c) => seen.push({ uri: uri.toString(), count: diags.length, self: c }));
        expect(seen).toEqual([{ uri: FILE.toString(), count: 1, self: collection }]);
        expect([...collection].map(([uri, diags]) => [uri.toString(), diags.length])).toEqual([[FILE.toString(), 1]]);

        collection.delete(FILE as unknown as vscode.Uri);
        expect(collection.has(FILE as unknown as vscode.Uri)).toBe(false);
        expect(published(stub).at(-1)).toMatchObject({ resource: FILE.toString(), markers: [] });

        collection.set(FILE as unknown as vscode.Uri, [diag]);
        collection.dispose(); // dispose → clear → пустая публикация по каждому ресурсу
        expect(published(stub).at(-1)).toMatchObject({ resource: FILE.toString(), markers: [] });
        expect(collection.get(FILE as unknown as vscode.Uri)).toBeUndefined();
    });

    it("set(uri, undefined) эквивалентен пустому набору", () => {
        const { stub, languages } = makeLanguages();
        const collection = languages.createDiagnosticCollection("ts");
        collection.set(FILE as unknown as vscode.Uri, undefined);
        expect(published(stub)).toEqual([{ owner: "ext:ts", resource: FILE.toString(), markers: [] }]);
        expect(collection.get(FILE as unknown as vscode.Uri)).toEqual([]);
    });
});

describe("LanguagesNamespace — no-op поверхность для vscode-languageclient", () => {
    it("register*Provider возвращают валидные Disposable, match даёт положительный score", () => {
        const { languages } = makeLanguages();
        const ns = languages as unknown as Record<string, (...args: unknown[]) => { dispose(): void }>;
        for (const name of [
            "registerDeclarationProvider",
            "registerImplementationProvider",
            "registerTypeDefinitionProvider",
            "registerHoverProvider",
            "registerReferenceProvider",
            "registerDocumentHighlightProvider",
            "registerDocumentSymbolProvider",
            "registerWorkspaceSymbolProvider",
            "registerCodeActionsProvider",
            "registerCodeLensProvider",
            "registerDocumentLinkProvider",
            "registerColorProvider",
            "registerDocumentFormattingEditProvider",
            "registerDocumentRangeFormattingEditProvider",
            "registerOnTypeFormattingEditProvider",
            "registerRenameProvider",
            "registerSelectionRangeProvider",
            "registerSignatureHelpProvider",
            "registerDocumentSemanticTokensProvider",
            "registerDocumentRangeSemanticTokensProvider",
            "registerInlayHintsProvider",
            "registerInlineValuesProvider",
            "registerInlineCompletionItemProvider",
            "registerLinkedEditingRangeProvider",
            "registerCallHierarchyProvider",
            "registerTypeHierarchyProvider",
        ]) {
            const disposable = ns[name]({}, {});
            expect(disposable, name).toBeDefined();
            expect(() => disposable.dispose(), name).not.toThrow();
        }
        expect(languages.match({ language: "typescript" }, {} as vscode.TextDocument)).toBeGreaterThan(0);
    });
});
