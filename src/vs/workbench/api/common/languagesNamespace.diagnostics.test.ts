import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Diagnostic, DiagnosticRelatedInformation, DiagnosticSeverity, Location, Range, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function makeLanguages(stub: IStubRpc = makeStubRpc()) {
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    return { stub, owner: ctx.owner, languages: createLanguagesNamespace(ctx).languages };
}

function published(stub: IStubRpc): { owner: string; resource: string; markers: unknown[] }[] {
    return stub.notifies
        .filter((n) => n.method === "diagnostics.publish")
        .map((n) => n.params as { owner: string; resource: string; markers: unknown[] });
}

const FILE = Uri.file("/proj/main.ts");

describe("LanguagesNamespace — createDiagnosticCollection", () => {
    it("set(uri, diags) publishes wire markers with the collection owner", () => {
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
                        range: { start: { line: 1, character: 2 }, end: { line: 1, character: 9 } },
                        message: "Type error",
                        code: "2322",
                        source: "ts",
                    },
                ],
            },
        ]);
    });

    it("rich code { value, target } is sent as its value; a garbage object gets no code", () => {
        const { stub, languages } = makeLanguages();
        const collection = languages.createDiagnosticCollection("eslint");
        const rich = new Diagnostic(new Range(0, 17, 0, 18), "Unnecessary semicolon.");
        // This is how eslint sends it: the rule code plus a link to its docs.
        rich.code = {
            value: "no-extra-semi",
            target: Uri.parse("https://eslint.org/docs/rules/no-extra-semi"),
        } as never;
        const garbage = new Diagnostic(new Range(1, 0, 1, 1), "x");
        garbage.code = { targetOnly: true } as never;
        // null is also typeof "object": the rich-form branch must survive it.
        const nullCode = new Diagnostic(new Range(2, 0, 2, 1), "y");
        nullCode.code = null as never;

        collection.set(FILE as unknown as vscode.Uri, [rich, garbage, nullCode] as unknown as vscode.Diagnostic[]);

        const markers = published(stub)[0]?.markers ?? [];
        expect(markers[0]).toMatchObject({ code: "no-extra-semi" });
        expect(markers[1]).not.toHaveProperty("code");
        expect(markers[2]).not.toHaveProperty("code");
    });

    it("diagnostic with related information is published; the field itself is not sent on the wire", () => {
        const { stub, languages } = makeLanguages();
        const collection = languages.createDiagnosticCollection("ts");
        // This is how TS2741 arrives: the message plus the declaration location.
        const diag = new Diagnostic(new Range(5, 4, 5, 10), "Property 'retries' is missing");
        diag.relatedInformation = [
            new DiagnosticRelatedInformation(
                new Location(Uri.file("/proj/config.ts"), new Range(2, 4, 2, 11)),
                "'retries' is declared here",
            ),
        ];

        collection.set(FILE as unknown as vscode.Uri, [diag as unknown as vscode.Diagnostic]);

        const markers = published(stub)[0]?.markers ?? [];
        expect(markers).toHaveLength(1);
        expect(markers[0]).toMatchObject({
            range: { start: { line: 5, character: 4 }, end: { line: 5, character: 10 } },
            message: "Property 'retries' is missing",
        });
        // The wire form is naive (docs/public/API-COVERAGE.md): related information doesn't reach
        // the markers — but doesn't break publishing either.
        expect(markers[0]).not.toHaveProperty("relatedInformation");
        // The extension's original object in the collection is intact — code actions read it.
        expect(collection.get(FILE as unknown as vscode.Uri)?.[0].relatedInformation).toHaveLength(1);
    });

    it("malformed diagnostic fields fall back to defaults (severity 0, empty range, string message)", () => {
        const { stub, languages } = makeLanguages();
        const collection = languages.createDiagnosticCollection();
        collection.set(FILE as unknown as vscode.Uri, [{} as unknown as vscode.Diagnostic]);

        expect(published(stub)[0]).toMatchObject({
            owner: "ext:diagnostics",
            markers: [
                {
                    severity: 0,
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                    message: "",
                },
            ],
        });
    });

    it("broken range: set does not throw, the marker is dropped, neighbors are published; a reversed one is flipped", () => {
        const { stub, languages } = makeLanguages();
        const collection = languages.createDiagnosticCollection("lint");
        const diags = [
            { range: { line: 0 }, message: "no start/end" },
            { range: new Range(NaN, 0, 0, 1), message: "NaN" },
            { range: { start: { line: 2, character: 5 }, end: { line: 1, character: 0 } }, message: "ok" },
        ] as unknown as vscode.Diagnostic[];

        expect(() => {
            collection.set(FILE as unknown as vscode.Uri, diags);
        }).not.toThrow();

        expect(published(stub)[0].markers).toEqual([
            {
                severity: 0,
                range: { start: { line: 1, character: 0 }, end: { line: 2, character: 5 } },
                message: "ok",
            },
        ]);
        expect(collection.get(FILE as unknown as vscode.Uri)).toHaveLength(3);
    });

    it("non-string message: rich form yields its value, anything else is not '[object Object]'", () => {
        const { stub, languages } = makeLanguages();
        const collection = languages.createDiagnosticCollection("rich");
        collection.set(FILE as unknown as vscode.Uri, [
            { message: { value: "**bold** rule" } } as unknown as vscode.Diagnostic,
            // An object without `value` is not text: an empty string, not "[object Object]".
            { message: { nope: 1 } } as unknown as vscode.Diagnostic,
            { message: 42 } as unknown as vscode.Diagnostic,
        ]);

        const messages = published(stub)[0].markers.map((m) => (m as { message: string }).message);
        expect(messages).toEqual(["**bold** rule", "", "42"]);
    });

    it("set(entries[]) — array-of-pairs overload; string uri is normalized", () => {
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

    it("get/has/forEach/iterator return the ORIGINAL diagnostics, delete/clear publish empty", () => {
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
        collection.dispose(); // dispose → clear → an empty publish for every resource
        expect(published(stub).at(-1)).toMatchObject({ resource: FILE.toString(), markers: [] });
        expect(collection.get(FILE as unknown as vscode.Uri)).toBeUndefined();
    });

    it("owner is unique per collection: extension id + name, a repeated base gets a counter", () => {
        const { stub, owner, languages } = makeLanguages();
        const create = (extensionId: string | undefined, name?: string): vscode.DiagnosticCollection =>
            extensionId === undefined
                ? languages.createDiagnosticCollection(name)
                : owner.runAs(extensionId, () => languages.createDiagnosticCollection(name));
        const collections = [
            create("pub.a", "ts"),
            create("pub.a", "ts"),
            create("pub.b", "ts"),
            create("pub.a"),
            create("pub.a"),
            create(undefined, "ts"),
            create(undefined),
            create(undefined),
            create("pub.a", "ts"),
        ];
        for (const collection of collections) collection.set(FILE as unknown as vscode.Uri, []);

        // Same-named and unnamed collections of different extensions don't share a MarkerService key.
        expect(published(stub).map((p) => p.owner)).toEqual([
            "ext:pub.a:ts",
            "ext:pub.a:ts#1",
            "ext:pub.b:ts",
            "ext:pub.a:diagnostics",
            "ext:pub.a:diagnostics#1",
            "ext:ts",
            "ext:diagnostics",
            "ext:diagnostics#1",
            "ext:pub.a:ts#2",
        ]);
        expect(collections.map((c) => c.name)).toEqual([
            "ts",
            "ts",
            "ts",
            "diagnostics",
            "diagnostics",
            "ts",
            "diagnostics",
            "diagnostics",
            "ts",
        ]);
    });

    it("set(uri, undefined) equals an empty set", () => {
        const { stub, languages } = makeLanguages();
        const collection = languages.createDiagnosticCollection("ts");
        collection.set(FILE as unknown as vscode.Uri, undefined);
        expect(published(stub)).toEqual([{ owner: "ext:ts", resource: FILE.toString(), markers: [] }]);
        expect(collection.get(FILE as unknown as vscode.Uri)).toEqual([]);
    });
});

describe("LanguagesNamespace — no-op surface for vscode-languageclient", () => {
    it("register*Provider return valid Disposables, match gives a positive score", () => {
        const { languages } = makeLanguages();
        const ns = languages as unknown as Record<string, (...args: unknown[]) => { dispose(): void }>;
        for (const name of [
            "registerDeclarationProvider",
            "registerImplementationProvider",
            "registerTypeDefinitionProvider",
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
            "registerInlayHintsProvider",
            "registerInlineValuesProvider",
            "registerLinkedEditingRangeProvider",
            "registerCallHierarchyProvider",
            "registerTypeHierarchyProvider",
        ]) {
            const disposable = ns[name]({}, {});
            expect(disposable, name).toBeDefined();
            expect(() => {
                disposable.dispose();
            }, name).not.toThrow();
        }
        const match = (languages as unknown as { match(selector: unknown, doc: unknown): number }).match;
        // Real scoring: a markdown document does NOT match a ts selector —
        // vscode-languageclient uses this to filter documents for sync.
        const tsDoc = { languageId: "typescript", uri: Uri.file("/a.ts") };
        const mdDoc = { languageId: "markdown", uri: Uri.file("/a.md") };
        expect(match({ language: "typescript" }, tsDoc)).toBeGreaterThan(0);
        expect(match([{ scheme: "file", language: "typescript" }], tsDoc)).toBeGreaterThan(0);
        expect(match({ language: "typescript" }, mdDoc)).toBe(0);
        expect(match([{ scheme: "file", language: "typescript" }], mdDoc)).toBe(0);
    });
});
