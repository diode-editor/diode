import { describe, expect, it, vi } from "vitest";

import type {
    ICoreCompletionResult,
    ICoreResolvedCompletion,
} from "../../../editor/common/languages/iCompletionSource.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { CompletionItem, CompletionList, MarkdownString, Range, SnippetString, TextEdit } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const REQ = {
    handles: [0],
    uri: "file:///proj/main.ts",
    languageId: "typescript",
    version: 1,
    line: 0,
    character: 2,
};

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
    ctx.documentSync.open({ uri: REQ.uri, languageId: REQ.languageId, version: REQ.version, text: "d." });
    return { ctx, stub };
}

describe("LanguagesNamespace — completion: source field serialization", () => {
    it("labelDetails, sortText/filterText and snippet insertText arrive in wire form", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);

        const item = new CompletionItem("getTime");
        // The stock languageclient declares labelDetailsSupport for us — the label
        // arrives as an object with a signature and a source.
        (item as { label: unknown }).label = { label: "getTime", detail: "(): number", description: "lib.es5.d.ts" };
        item.insertText = new SnippetString("getTime(${1:arg})$0") as unknown as string;
        item.filterText = ".getTime";
        item.sortText = "11";

        languages.registerCompletionItemProvider({ language: "typescript" }, {
            provideCompletionItems: () => [item],
        } as never);

        const [result] = (await stub.callRequest("languages.provideCompletionItems", REQ)) as ICoreCompletionResult[];

        expect(result.items[0]).toMatchObject({
            label: "getTime",
            labelDetail: "(): number",
            labelDescription: "lib.es5.d.ts",
            filterText: ".getTime",
            sortText: "11",
            // Snippet syntax is kept out of the buffer (we have no tab stops).
            insertText: "getTime(arg)",
        });
        expect(result.items[0].id).toBeDefined();
    });

    it("additionalTextEdits from the list itself arrive in the item; empty and broken ones omit the field", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        // gopls sends the import right in the list — the server has no resolve.
        const eager = new CompletionItem("ToLower");
        // A broken edit — from an extension with a foreign TextEdit shape.
        (eager as { additionalTextEdits?: unknown }).additionalTextEdits = [
            new TextEdit(new Range(0, 0, 0, 0), 'import "strings"\n'),
            { bogus: true },
        ];
        const empty = new CompletionItem("empty");
        (empty as { additionalTextEdits?: unknown }).additionalTextEdits = [];
        const broken = new CompletionItem("broken");
        (broken as { additionalTextEdits?: unknown }).additionalTextEdits = "not an array";

        languages.registerCompletionItemProvider({ language: "typescript" }, {
            provideCompletionItems: () => [eager, empty, broken, new CompletionItem("plain")],
        } as never);

        const [result] = (await stub.callRequest("languages.provideCompletionItems", REQ)) as ICoreCompletionResult[];

        expect(result.items[0].additionalEdits).toEqual([
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'import "strings"\n' },
        ]);
        // No edits, no field: accepting such an item still waits for resolve.
        for (const item of result.items.slice(1)) expect(item).not.toHaveProperty("additionalEdits");
    });

    it("a Range from another bundle (duck-typed, not instanceof Range) arrives as the replace range", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const foreign = { start: { line: 0, character: 0 }, end: { line: 0, character: 2 }, isEmpty: false };
        const plain = new CompletionItem("plain");
        (plain as { range: unknown }).range = foreign;
        const split = new CompletionItem("split");
        (split as { range: unknown }).range = { inserting: foreign, replacing: foreign };
        languages.registerCompletionItemProvider({ language: "typescript" }, {
            provideCompletionItems: () => [plain, split],
        } as never);

        const [result] = (await stub.callRequest("languages.provideCompletionItems", REQ)) as ICoreCompletionResult[];
        const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } };
        expect(result.items.map((item) => item.range)).toEqual([range, range]);
    });

    it("isIncomplete from CompletionList reaches the core", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerCompletionItemProvider({ language: "typescript" }, {
            provideCompletionItems: () => new CompletionList([new CompletionItem("getTime")], true),
        } as never);

        const [result] = (await stub.callRequest("languages.provideCompletionItems", REQ)) as ICoreCompletionResult[];
        expect(result.isIncomplete).toBe(true);
    });

    it("trigger characters travel with their own provider registration, not merged", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const provider = { provideCompletionItems: () => [] } as never;
        // Garbage instead of a character (an untyped JS extension) is dropped.
        languages.registerCompletionItemProvider({ language: "typescript" }, provider, ".", 7 as never, '"');
        languages.registerCompletionItemProvider({ language: "json" }, provider, '"', "/");

        const registered = stub.notifies.filter((n) => n.method === "languages.register").map((n) => n.params);
        expect(registered).toMatchObject([
            { handle: 0, triggerCharacters: [".", '"'] },
            { handle: 1, triggerCharacters: ['"', "/"] },
        ]);
    });

    it("triggerKind/triggerCharacter reach the provider", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const provideCompletionItems = vi.fn((..._args: unknown[]) => []);
        languages.registerCompletionItemProvider({ language: "typescript" }, { provideCompletionItems } as never);

        await stub.callRequest("languages.provideCompletionItems", { ...REQ, triggerKind: 1, triggerCharacter: "." });

        expect(provideCompletionItems.mock.calls[0][3]).toMatchObject({ triggerKind: 1, triggerCharacter: "." });
    });

    it("the request position reaches the provider; item ids are the response bucket and an ordinal", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const provideCompletionItems = vi.fn((..._args: unknown[]) => [
            new CompletionItem("a"),
            new CompletionItem("b"),
        ]);
        languages.registerCompletionItemProvider({ language: "typescript" }, { provideCompletionItems } as never);

        const ids = async (): Promise<(string | undefined)[]> => {
            const [result] = (await stub.callRequest("languages.provideCompletionItems", {
                ...REQ,
                line: 3,
                character: 2,
            })) as ICoreCompletionResult[];
            return result.items.map((item) => item.id);
        };
        const first = await ids();
        const bucket = Number(first[0]?.split(".")[0]);
        expect(first).toEqual([`${String(bucket)}.0`, `${String(bucket)}.1`]);
        expect(await ids()).toEqual([`${String(bucket + 1)}.0`, `${String(bucket + 1)}.1`]);
        expect(provideCompletionItems.mock.calls[0][1]).toMatchObject({ line: 3, character: 2 });
    });

    it("the document comes from the mirror: the provider sees didOpen text and didChange edits", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const texts: string[] = [];
        languages.registerCompletionItemProvider({ language: "typescript" }, {
            provideCompletionItems: (document: { getText(): string }) => {
                texts.push(document.getText());
                return [];
            },
        } as never);

        await stub.callRequest("languages.provideCompletionItems", REQ);
        ctx.documentSync.change({
            uri: REQ.uri,
            version: 2,
            changes: [{ range: { start: { line: 0, character: 2 }, end: { line: 0, character: 2 } }, text: "g" }],
        });
        await stub.callRequest("languages.provideCompletionItems", { ...REQ, version: 2, character: 3 });

        expect(texts).toEqual(["d.", "d.g"]);
    });

    it("document not open, request stale or ahead of the mirror gives [] and the provider is not called", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const provideCompletionItems = vi.fn(() => [new CompletionItem("x")]);
        languages.registerCompletionItemProvider({ language: "typescript" }, { provideCompletionItems } as never);
        ctx.documentSync.change({
            uri: REQ.uri,
            version: 2,
            changes: [{ range: { start: { line: 0, character: 2 }, end: { line: 0, character: 2 } }, text: "g" }],
        });

        // Not open: the host hasn't sent didOpen yet (or has already sent didClose).
        expect(
            await stub.callRequest("languages.provideCompletionItems", { ...REQ, uri: "file:///proj/other.ts" }),
        ).toEqual([]);
        // Stale: the core has already moved on to v2.
        expect(await stub.callRequest("languages.provideCompletionItems", REQ)).toEqual([]);
        // Ahead of the mirror: the v3 edits haven't arrived — an ordering violation, logged to stderr.
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            expect(await stub.callRequest("languages.provideCompletionItems", { ...REQ, version: 3 })).toEqual([]);
            expect(warn).toHaveBeenCalledTimes(1);
        } finally {
            warn.mockRestore();
        }
        expect(provideCompletionItems).not.toHaveBeenCalled();

        expect(await stub.callRequest("languages.provideCompletionItems", { ...REQ, version: 2 })).toHaveLength(1);
        expect(provideCompletionItems).toHaveBeenCalledTimes(1);
    });
});

describe("LanguagesNamespace — resolveCompletionItem", () => {
    async function completeOnce(
        provider: Record<string, unknown>,
    ): Promise<{ id: string; stub: ReturnType<typeof makeCtx>["stub"] }> {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerCompletionItemProvider({ language: "typescript" }, provider as never);
        const [result] = (await stub.callRequest("languages.provideCompletionItems", REQ)) as ICoreCompletionResult[];
        return { id: result.items[0].id!, stub };
    }

    it("returns detail/documentation/additionalEdits resolved by the provider", async () => {
        const original = new CompletionItem("greet");
        const { id, stub } = await completeOnce({
            provideCompletionItems: () => [original],
            resolveCompletionItem: (item: CompletionItem) => {
                // Resolve must get THE SAME object: in languageclient it carries
                // the private `data` for completionItem/resolve.
                expect(item).toBe(original);
                item.detail = "(alias) greet(name: string): string";
                item.documentation = new MarkdownString("Greets someone.") as unknown as string;
                (item as { additionalTextEdits?: unknown }).additionalTextEdits = [
                    new TextEdit(new Range(0, 0, 0, 0), 'import { greet } from "./defs";\n'),
                ];
                return item;
            },
        });

        const resolved = (await stub.callRequest("languages.resolveCompletionItem", {
            id,
        })) as ICoreResolvedCompletion;
        expect(resolved.detail).toContain("greet");
        expect(resolved.documentation).toBe("Greets someone.");
        expect(resolved.additionalEdits).toEqual([
            {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                text: 'import { greet } from "./defs";\n',
            },
        ]);
    });

    it("reads the new object when the provider returns one", async () => {
        const { id, stub } = await completeOnce({
            provideCompletionItems: () => [new CompletionItem("greet")],
            resolveCompletionItem: () => {
                const fresh = new CompletionItem("greet");
                fresh.detail = "fresh detail";
                return fresh;
            },
        });
        const resolved = (await stub.callRequest("languages.resolveCompletionItem", {
            id,
        })) as ICoreResolvedCompletion;
        expect(resolved.detail).toBe("fresh detail");
    });

    it("broken additional edits are dropped one by one", async () => {
        const { id, stub } = await completeOnce({
            provideCompletionItems: () => [new CompletionItem("greet")],
            resolveCompletionItem: (item: CompletionItem) => {
                (item as { additionalTextEdits?: unknown }).additionalTextEdits = [
                    null,
                    { range: null, newText: "x" },
                    { range: new Range(1, 0, 1, 0), newText: 42 },
                    new TextEdit(new Range(1, 0, 1, 0), "ok"),
                ];
                return item;
            },
        });
        const resolved = (await stub.callRequest("languages.resolveCompletionItem", {
            id,
        })) as ICoreResolvedCompletion;
        expect(resolved.additionalEdits).toHaveLength(1);
        const [edit] = resolved.additionalEdits ?? [];
        expect(edit).toMatchObject({ text: "ok" });
    });

    it("reads the original item when resolve returns undefined", async () => {
        const { id, stub } = await completeOnce({
            provideCompletionItems: () => {
                const item = new CompletionItem("greet");
                item.detail = "original detail";
                return [item];
            },
            resolveCompletionItem: () => undefined,
        });
        const resolved = (await stub.callRequest("languages.resolveCompletionItem", {
            id,
        })) as ICoreResolvedCompletion;
        expect(resolved.detail).toBe("original detail");
    });

    it("resolve without detail/documentation/edits gives an empty object with no empty keys", async () => {
        const { id, stub } = await completeOnce({
            provideCompletionItems: () => [new CompletionItem("greet")],
            resolveCompletionItem: () => new CompletionItem("greet"),
        });
        expect(await stub.callRequest("languages.resolveCompletionItem", { id })).toStrictEqual({});
    });

    it("a label object without a signature yields no empty fields", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const item = new CompletionItem("greet");
        (item as { label: unknown }).label = { label: "greet" }; // no detail/description
        languages.registerCompletionItemProvider({ language: "typescript" }, {
            provideCompletionItems: () => [item],
        } as never);

        const [result] = (await stub.callRequest("languages.provideCompletionItems", REQ)) as ICoreCompletionResult[];
        expect(result.items[0].labelDetail).toBeUndefined();
        expect(result.items[0].labelDescription).toBeUndefined();
    });

    it("a failing resolve does not break the popup", async () => {
        const { id, stub } = await completeOnce({
            provideCompletionItems: () => [new CompletionItem("greet")],
            resolveCompletionItem: () => {
                throw new Error("boom");
            },
        });
        expect(await stub.callRequest("languages.resolveCompletionItem", { id })).toBeNull();
    });

    it("a provider without resolve, an unknown and a non-numeric id → null", async () => {
        const { id, stub } = await completeOnce({ provideCompletionItems: () => [new CompletionItem("greet")] });
        expect(await stub.callRequest("languages.resolveCompletionItem", { id })).toBeNull();
        expect(await stub.callRequest("languages.resolveCompletionItem", { id: "999.0" })).toBeNull();
        expect(await stub.callRequest("languages.resolveCompletionItem", {})).toBeNull();
    });

    it("the cache keeps only the last two responses", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerCompletionItemProvider({ language: "typescript" }, {
            provideCompletionItems: () => [new CompletionItem("greet")],
            resolveCompletionItem: (item: CompletionItem) => {
                item.detail = "detail";
                return item;
            },
        } as never);

        const [first] = (await stub.callRequest("languages.provideCompletionItems", REQ)) as ICoreCompletionResult[];
        await stub.callRequest("languages.provideCompletionItems", REQ);
        await stub.callRequest("languages.provideCompletionItems", REQ);

        // The third request evicted the first bucket — nothing to resolve, but it must not
        // throw either: the user may have lingered on a stale list.
        expect(await stub.callRequest("languages.resolveCompletionItem", { id: first.items[0].id! })).toBeNull();
    });
});
