import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import type { ICoreCompletionResult } from "../../../editor/common/languages/iCompletionSource.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { CompletionItem, CompletionItemKind, Range } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const COMPLETION_PARAMS = {
    handles: [0],
    uri: Uri.file("/proj/.editorconfig").toString(),
    languageId: "editorconfig",
    version: 1,
    line: 0,
    character: 3,
};

const PROGRAM_CS = Uri.file("/proj/Program.cs").toString();

function openDoc(ctx: IVscodeHostContext, uri: string, languageId: string, text: string): void {
    ctx.documentSync.open({ uri, languageId, version: 1, text });
}

function makeCtx(stub: IStubRpc = makeStubRpc()): { ctx: IVscodeHostContext; stub: IStubRpc } {
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    openDoc(ctx, COMPLETION_PARAMS.uri, COMPLETION_PARAMS.languageId, "ind");
    return { ctx, stub };
}

describe("LanguagesNamespace", () => {
    it("registerCompletionItemProvider announces the provider to the core with triggers, dispose removes it once", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const provider = { provideCompletionItems: () => [] } as never;
        const disposable = languages.registerCompletionItemProvider(
            { language: "editorconfig", pattern: "**/.editorconfig" },
            provider,
            "=",
            ".",
            "", // an empty character is never a trigger — dropped
        );
        expect(stub.notifies.filter((n) => n.method.startsWith("languages."))).toEqual([
            {
                method: "languages.register",
                params: {
                    handle: 0,
                    kind: "completion",
                    selector: [{ language: "editorconfig", pattern: "**/.editorconfig" }],
                    triggerCharacters: ["=", "."],
                },
            },
        ]);
        disposable.dispose();
        disposable.dispose();
        expect(stub.notifies.filter((n) => n.method === "languages.unregister")).toEqual([
            { method: "languages.unregister", params: { handle: 0 } },
        ]);
        expect(stub.notifies.filter((n) => n.method === "languages.updateSubscriptions")).toEqual([]);
    });

    it("provideCompletionItems calls providers of the sent handles and serializes items", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);

        const matching = new CompletionItem("indent_style", CompletionItemKind.Property);
        matching.detail = "EditorConfig";
        matching.command = { command: "editorconfig._triggerSuggestAfterDelay", title: "..." };
        const otherLangItem = new CompletionItem("should_not_appear");

        languages.registerCompletionItemProvider({ language: "editorconfig", pattern: "**/.editorconfig" }, {
            provideCompletionItems: () => [matching],
        } as never);
        languages.registerCompletionItemProvider({ language: "ini" }, {
            provideCompletionItems: () => [otherLangItem],
        } as never);

        const [result] = (await stub.callRequest(
            "languages.provideCompletionItems",
            COMPLETION_PARAMS,
        )) as ICoreCompletionResult[];

        // The ini provider (handle 1) wasn't sent, so it isn't asked.
        expect(result.items).toHaveLength(1);
        expect(result.items[0].label).toBe("indent_style");
        expect(result.items[0].insertText).toBe("indent_style");
        expect(result.items[0].kind).toBe(CompletionItemKind.Property);
        expect(result.items[0].detail).toBe("EditorConfig");
        expect(result.items[0].command?.command).toBe("editorconfig._triggerSuggestAfterDelay");
    });

    it("provideCompletionItems: CompletionList and Range; response aligned with handles, failing one is empty", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);

        const withRange = new CompletionItem("root");
        withRange.insertText = "root = true";
        withRange.range = new Range(0, 0, 0, 3);

        languages.registerCompletionItemProvider({ language: "editorconfig" }, {
            provideCompletionItems: () => {
                throw new Error("boom");
            },
        } as never);
        languages.registerCompletionItemProvider({ language: "editorconfig" }, {
            provideCompletionItems: () => ({ items: [withRange] }),
        } as never);

        const results = (await stub.callRequest("languages.provideCompletionItems", {
            ...COMPLETION_PARAMS,
            handles: [1, 0, 7, "x"],
        })) as ICoreCompletionResult[];

        expect(results).toHaveLength(4);
        expect(results[0].items).toHaveLength(1);
        expect(results[0].items[0].insertText).toBe("root = true");
        expect(results[0].items[0].range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 3 } });
        // Failing (0), unknown (7) and wrong-shaped handles give empty results.
        expect(results.slice(1)).toEqual([
            { items: [], isIncomplete: false },
            { items: [], isIncomplete: false },
            { items: [], isIncomplete: false },
        ]);
    });

    it("provideCompletionItems without handles → empty array", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerCompletionItemProvider({ language: "editorconfig" }, {
            provideCompletionItems: () => [new CompletionItem("x")],
        } as never);
        const { handles: _handles, ...noHandles } = COMPLETION_PARAMS;
        expect(await stub.callRequest("languages.provideCompletionItems", noHandles)).toEqual([]);
    });

    it("serializes various field shapes and drops items without label", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const items = [
            {
                label: { label: "objlabel" },
                insertText: { value: "snippet" },
                documentation: { value: "md" },
                sortText: "0",
                filterText: "f",
                kind: 9,
                detail: "D",
                range: { replacing: new Range(0, 0, 0, 1), inserting: new Range(0, 0, 0, 0) },
                command: { command: "c", arguments: [1] },
            },
            {}, // no label → dropped
            { label: "" }, // empty label → dropped
            {
                // insertText/documentation objects without value → fallback; a non-Range range → undefined
                label: "d",
                insertText: {},
                documentation: {},
                range: { foo: 1 },
                command: { command: "" }, // an empty command is dropped
            },
            { label: "e", range: null },
        ];
        languages.registerCompletionItemProvider({ language: "editorconfig" }, {
            provideCompletionItems: () => items,
        } as never);

        const [result] = (await stub.callRequest(
            "languages.provideCompletionItems",
            COMPLETION_PARAMS,
        )) as ICoreCompletionResult[];

        expect(result.items.map((r) => r.label)).toEqual(["objlabel", "d", "e"]);
        const a = result.items[0];
        expect(a.insertText).toBe("snippet");
        expect(a.documentation).toBe("md");
        expect(a.sortText).toBe("0");
        expect(a.filterText).toBe("f");
        expect(a.range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 1 } });
        expect(a.command).toEqual({ command: "c", arguments: [1] });
        const d = result.items[1];
        expect(d.insertText).toBe("d");
        expect(d.documentation).toBeUndefined();
        expect(d.range).toBeUndefined();
        expect(d.command).toBeUndefined();
    });

    it("provideCompletionItems: missing languageId/line/character + string documentation", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const item = new CompletionItem("root");
        item.documentation = "root docs";
        languages.registerCompletionItemProvider(
            { pattern: "**/.editorconfig" }, // matches by path, no language
            { provideCompletionItems: () => [item] } as never,
        );
        // Params with only the resource and version: the other fields resolve to defaults.
        const [result] = (await stub.callRequest("languages.provideCompletionItems", {
            handles: [0],
            uri: Uri.file("/proj/.editorconfig").toString(),
            version: 1,
        })) as ICoreCompletionResult[];
        expect(result.items).toHaveLength(1);
        expect(result.items[0].documentation).toBe("root docs");
        // No languageId: the mirror's language is not overwritten.
        expect(ctx.registry.get(Uri.parse(COMPLETION_PARAMS.uri))?.languageId).toBe("editorconfig");
    });

    it("normalizeResult: undefined and {items: non-array} → empty", async () => {
        const undef = makeCtx();
        const nsU = createLanguagesNamespace(undef.ctx);
        nsU.languages.registerCompletionItemProvider({ language: "editorconfig" }, {
            provideCompletionItems: () => undefined,
        } as never);
        expect(await undef.stub.callRequest("languages.provideCompletionItems", COMPLETION_PARAMS)).toEqual([
            { items: [], isIncomplete: false },
        ]);

        const bad = makeCtx();
        const nsB = createLanguagesNamespace(bad.ctx);
        nsB.languages.registerCompletionItemProvider({ language: "editorconfig" }, {
            provideCompletionItems: () => ({ items: 5 }),
        } as never);
        expect(await bad.stub.callRequest("languages.provideCompletionItems", COMPLETION_PARAMS)).toEqual([
            { items: [], isIncomplete: false },
        ]);
    });

    it("registerFoldingRangeProvider announces the provider to the core, dispose removes it once", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const provider = { provideFoldingRanges: () => [] } as never;
        const d1 = languages.registerFoldingRangeProvider(["csharp"], provider);
        languages.registerFoldingRangeProvider(["typescript"], provider);
        expect(stub.notifies.filter((n) => n.method === "languages.register").map((n) => n.params)).toEqual([
            { handle: 0, kind: "folding", selector: [{ language: "csharp" }] },
            { handle: 1, kind: "folding", selector: [{ language: "typescript" }] },
        ]);

        d1.dispose();
        d1.dispose(); // a repeated dispose is safe
        expect(stub.notifies.filter((n) => n.method === "languages.unregister").map((n) => n.params)).toEqual([
            { handle: 0 },
        ]);
        const subs = stub.notifies.filter((n) => n.method === "languages.updateSubscriptions");
        expect(subs.map((n) => n.params)).not.toContainEqual(expect.objectContaining({ hasFoldingProviders: true }));
    });

    it("provideFoldingRanges: response aligned with handles; non-array → empty list", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerFoldingRangeProvider(["csharp"], {
            provideFoldingRanges: () => null,
        } as never);
        languages.registerFoldingRangeProvider(["csharp"], {
            // Valid + broken start + broken end: the serializer weeds out both broken ones.
            provideFoldingRanges: () => [
                { start: 1, end: 2 },
                { start: "x", end: 2 },
                { start: 3, end: "x" },
            ],
        } as never);
        // A request without languageId takes the default branch: the language stays from didOpen.
        openDoc(ctx, PROGRAM_CS, "csharp", "");
        const result = await stub.callRequest("languages.provideFoldingRanges", {
            handles: [0, 1],
            uri: PROGRAM_CS,
            version: 1,
        });
        expect(ctx.registry.get(Uri.parse(PROGRAM_CS))?.languageId).toBe("csharp");
        expect(result).toEqual([[], [{ start: 1, end: 2 }]]);
    });

    it("provideFoldingRanges: unknown and malformed handles yield empty, no handles yield []", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        let asked = 0;
        languages.registerFoldingRangeProvider(["csharp"], {
            provideFoldingRanges: () => {
                asked++;
                return [{ start: 0, end: 3 }];
            },
        } as never);
        const uri = Uri.file("/proj/Program.txt").toString();
        openDoc(ctx, uri, "plaintext", "");

        expect(
            await stub.callRequest("languages.provideFoldingRanges", { handles: [7, "0"], uri, version: 1 }),
        ).toEqual([[], []]);
        expect(await stub.callRequest("languages.provideFoldingRanges", { uri, version: 1 })).toEqual([]);
        expect(asked).toBe(0);
    });

    it("provide* request does not write to the mirror: provider only after didOpen and by request version, no events", async () => {
        // LSP client regression: the provider was called before didOpen ("Unexpected resource"), and a request
        // with text running ahead wrote to the registry bypassing events, so the next didChange crashed tsserver
        // ("reading 'charCount'"). The document comes only from the mirror.
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const log: string[] = [];
        ctx.documentSync.onDidOpenEmitter.event((doc) => log.push(`open:${doc.getText()}`));
        ctx.documentSync.onDidChangeEmitter.event((e) => {
            const change = e.contentChanges[0];
            log.push(`change:${change.rangeLength}:${change.range.end.line}.${change.range.end.character}`);
        });
        languages.registerFoldingRangeProvider(["csharp"], {
            provideFoldingRanges: (doc: { getText(): string }) => {
                log.push(`provider:${doc.getText()}`);
                return [];
            },
        } as never);
        const request = (version: number) =>
            stub.callRequest("languages.provideFoldingRanges", {
                handles: [0],
                uri: PROGRAM_CS,
                languageId: "csharp",
                version,
            });

        expect(await request(1)).toEqual([]);
        expect(log).toEqual([]);
        expect(ctx.registry.get(Uri.parse(PROGRAM_CS))).toBeUndefined();

        openDoc(ctx, PROGRAM_CS, "csharp", "a");
        await request(1);
        expect(log).toEqual(["open:a", "provider:a"]);

        // A host edit has a range over the old text; a request lagging behind it doesn't wake the provider.
        log.length = 0;
        ctx.documentSync.change({
            uri: PROGRAM_CS,
            version: 2,
            changes: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, text: "ab\ncdd" }],
        });
        expect(await request(1)).toEqual([]);
        await request(2);
        expect(log).toEqual(["change:1:0.1", "provider:ab\ncdd"]);
    });

    it("provideFoldingRanges calls providers of the sent handles and serializes ranges", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerFoldingRangeProvider(["csharp"], {
            provideFoldingRanges: () => [
                { start: 0, end: 3, kind: 3 },
                { start: 5, end: 9 },
            ],
        } as never);
        // A provider the core didn't send must not fire.
        languages.registerFoldingRangeProvider(["typescript"], {
            provideFoldingRanges: () => [{ start: 100, end: 200 }],
        } as never);

        openDoc(ctx, PROGRAM_CS, "csharp", "/* #region */\n\n\n/* #endregion */\n\n\n\n\n\n\n");
        const result = await stub.callRequest("languages.provideFoldingRanges", {
            handles: [0],
            uri: PROGRAM_CS,
            languageId: "csharp",
            version: 1,
        });
        expect(result).toEqual([
            [
                { start: 0, end: 3, kind: 3 },
                { start: 5, end: 9 },
            ],
        ]);
    });

    it("provideFoldingRanges: a failing provider does not break the others", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerFoldingRangeProvider(["csharp"], {
            provideFoldingRanges: () => {
                throw new Error("boom");
            },
        } as never);
        languages.registerFoldingRangeProvider(["csharp"], {
            provideFoldingRanges: () => [{ start: 1, end: 2 }],
        } as never);
        openDoc(ctx, PROGRAM_CS, "csharp", "a\nb\nc\n");
        const result = await stub.callRequest("languages.provideFoldingRanges", {
            handles: [0, 1],
            uri: PROGRAM_CS,
            languageId: "csharp",
            version: 1,
        });
        expect(result).toEqual([[], [{ start: 1, end: 2 }]]);
    });

    it("provideFoldingRanges: unopened, stale and ahead-of-mirror document yields [] without the provider", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        let asked = 0;
        languages.registerFoldingRangeProvider(["csharp"], {
            provideFoldingRanges: () => {
                asked++;
                return [{ start: 0, end: 1 }];
            },
        } as never);
        const request = (uri: string, version: number) =>
            stub.callRequest("languages.provideFoldingRanges", { handles: [0], uri, languageId: "csharp", version });

        openDoc(ctx, PROGRAM_CS, "csharp", "a\nb");
        ctx.documentSync.change({
            uri: PROGRAM_CS,
            version: 2,
            changes: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "x" }],
        });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            expect(await request(Uri.file("/proj/Other.cs").toString(), 1)).toEqual([]);
            expect(await request(PROGRAM_CS, 1)).toEqual([]);
            expect(await request(PROGRAM_CS, 3)).toEqual([]);
            // Running ahead of the mirror is an ordering violation, logged to stderr.
            expect(warn).toHaveBeenCalledTimes(1);
        } finally {
            warn.mockRestore();
        }
        expect(asked).toBe(0);

        expect(await request(PROGRAM_CS, 2)).toEqual([[{ start: 0, end: 1 }]]);
        expect(asked).toBe(1);
    });

    it("provideCompletionItems: unopened and stale document yields [] without the provider", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        let asked = 0;
        languages.registerCompletionItemProvider({ language: "editorconfig" }, {
            provideCompletionItems: () => {
                asked++;
                return [new CompletionItem("x")];
            },
        } as never);

        expect(
            await stub.callRequest("languages.provideCompletionItems", {
                ...COMPLETION_PARAMS,
                uri: Uri.file("/proj/other/.editorconfig").toString(),
            }),
        ).toEqual([]);
        expect(
            await stub.callRequest("languages.provideCompletionItems", { ...COMPLETION_PARAMS, version: 0 }),
        ).toEqual([]);
        expect(asked).toBe(0);
    });
});
