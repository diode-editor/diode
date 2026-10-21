import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { InlineCompletionItem, InlineCompletionList, Range, SnippetString } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function makeCtx(stub: IStubRpc = makeStubRpc()): { ctx: IVscodeHostContext; stub: IStubRpc } {
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry, () => undefined),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    ctx.documentSync.open({ uri: URI, languageId: "typescript", version: 1, text: TEXT });
    return { ctx, stub };
}

const URI = "file:///proj/main.ts";
const TEXT = "con\n";

function requestParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        handles: [0],
        uri: URI,
        languageId: "typescript",
        version: 1,
        line: 0,
        character: 3,
        triggerKind: 1,
        ...overrides,
    };
}

describe("LanguagesNamespace — registerInlineCompletionItemProvider", () => {
    it("registration is announced to the core with a handle; dispose removes it once; no updateSubscriptions", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);

        const provider: vscode.InlineCompletionItemProvider = { provideInlineCompletionItems: () => [] };
        const registration = languages.registerInlineCompletionItemProvider({ language: "typescript" }, provider);
        expect(stub.notifies.filter((n) => n.method === "languages.register").map((n) => n.params)).toEqual([
            { handle: 0, kind: "inlineCompletions", selector: [{ language: "typescript" }] },
        ]);

        registration.dispose();
        registration.dispose();
        expect(stub.notifies.filter((n) => n.method === "languages.unregister").map((n) => n.params)).toEqual([
            { handle: 0 },
        ]);
        expect(stub.notifies.filter((n) => n.method === "languages.updateSubscriptions")).toEqual([]);
    });
});

describe("LanguagesNamespace — languages.provideInlineCompletions", () => {
    it("calls the provider with the mirror document, position and triggerKind", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { doc?: vscode.TextDocument; pos?: vscode.Position; context?: vscode.InlineCompletionContext } = {};
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            {
                provideInlineCompletionItems: (document, position, context) => {
                    seen.doc = document;
                    seen.pos = position;
                    seen.context = context;
                    return [
                        new InlineCompletionItem(
                            "console.log()",
                            new Range(0, 0, 0, 3) as unknown as vscode.Range,
                        ) as unknown as vscode.InlineCompletionItem,
                    ];
                },
            },
        );

        const result = await stub.callRequest("languages.provideInlineCompletions", requestParams());

        expect(seen.doc?.getText()).toBe("con\n");
        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(3);
        expect(seen.context?.triggerKind).toBe(1);
        expect(seen.context?.selectedCompletionInfo).toBeUndefined();
        expect(seen.doc).toBe(ctx.registry.get(URI as unknown as vscode.Uri));
        expect(result).toStrictEqual([
            [
                {
                    insertText: "console.log()",
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
                },
            ],
        ]);
    });

    it("InlineCompletionList is normalized, SnippetString becomes text with placeholders stripped", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            {
                provideInlineCompletionItems: () =>
                    new InlineCompletionList([
                        new InlineCompletionItem(new SnippetString("log(${1:msg})$0")),
                    ]) as unknown as vscode.InlineCompletionList,
            },
        );

        const result = await stub.callRequest("languages.provideInlineCompletions", requestParams());

        expect(result).toStrictEqual([[{ insertText: "log(msg)" }]]);
    });

    it("filterText goes into the wire item", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            {
                provideInlineCompletionItems: () => {
                    const item = new InlineCompletionItem("console.log()") as unknown as vscode.InlineCompletionItem;
                    item.filterText = "console";
                    return [item];
                },
            },
        );

        expect(await stub.callRequest("languages.provideInlineCompletions", requestParams())).toStrictEqual([
            [{ insertText: "console.log()", filterText: "console" }],
        ]);
    });

    it("walks the providers of the sent handles; the response is aligned to them, failing and unknown ones are empty", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            { provideInlineCompletionItems: () => [new InlineCompletionItem("a") as never] },
        );
        languages.registerInlineCompletionItemProvider(
            { language: "markdown" }, // the core didn't send it
            { provideInlineCompletionItems: () => [new InlineCompletionItem("skip") as never] },
        );
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            {
                provideInlineCompletionItems: () => {
                    throw new Error("boom");
                },
            },
        );
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            { provideInlineCompletionItems: () => [new InlineCompletionItem("b") as never] },
        );

        const handles = [0, 2, 3, 99, "x"];
        expect(await stub.callRequest("languages.provideInlineCompletions", requestParams({ handles }))).toStrictEqual([
            [{ insertText: "a" }],
            [],
            [{ insertText: "b" }],
            [],
            [],
        ]);
    });

    it("params defaults: without languageId/line/character/triggerKind the position is (0,0), Automatic, language is not overwritten", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { doc?: vscode.TextDocument; pos?: vscode.Position; context?: vscode.InlineCompletionContext } = {};
        languages.registerInlineCompletionItemProvider("plaintext", {
            provideInlineCompletionItems: (document, position, context) => {
                seen.doc = document;
                seen.pos = position;
                seen.context = context;
                return [];
            },
        });

        await stub.callRequest("languages.provideInlineCompletions", { handles: [0], uri: URI, version: 1 });

        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(0);
        expect(seen.context?.triggerKind).toBe(1); // Automatic
        expect(seen.doc?.getText()).toBe(TEXT);
        expect(seen.doc?.languageId).toBe("typescript");
    });

    it("null/undefined/garbage from the provider gives an empty response; an empty insertText is dropped", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            { provideInlineCompletionItems: () => null },
        );
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            { provideInlineCompletionItems: () => ({ notItems: true }) as never },
        );
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            // items is not an array (an InlineCompletionList with garbage inside).
            { provideInlineCompletionItems: () => ({ items: 42 }) as never },
        );
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            // null/undefined among the items: drop+skip, not a serializer crash.
            { provideInlineCompletionItems: () => [null, undefined] as never },
        );
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            {
                provideInlineCompletionItems: () =>
                    [
                        new InlineCompletionItem(""),
                        "junk",
                        // insertText is neither a string nor a SnippetString: drop+skip.
                        { insertText: 42 },
                    ] as never,
            },
        );

        const handles = [0, 1, 2, 3, 4];
        expect(await stub.callRequest("languages.provideInlineCompletions", requestParams({ handles }))).toStrictEqual([
            [],
            [],
            [],
            [],
            [],
        ]);
        expect(
            await stub.callRequest("languages.provideInlineCompletions", requestParams({ handles: undefined })),
        ).toStrictEqual([]);
    });
});

describe("LanguagesNamespace — provideInlineCompletions by mirror version", () => {
    it("an unopened document, a stale or ahead-of-mirror version give [] and the provider is not called", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        let asked = 0;
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            {
                provideInlineCompletionItems: () => {
                    asked++;
                    return [new InlineCompletionItem("x") as never];
                },
            },
        );
        ctx.documentSync.change({ uri: URI, version: 2, changes: [] });

        const stale = [{ uri: "file:///proj/unknown.ts" }, { version: 1 }, { version: 3 }, { version: undefined }];
        for (const overrides of stale) {
            expect(
                await stub.callRequest("languages.provideInlineCompletions", requestParams(overrides)),
            ).toStrictEqual([]);
        }
        expect(asked).toBe(0);
        expect(
            await stub.callRequest("languages.provideInlineCompletions", requestParams({ version: 2 })),
        ).toStrictEqual([[{ insertText: "x" }]]);
    });
});

describe("LanguagesNamespace — provideInlineCompletions cancellation", () => {
    it("the provider gets a real token: request cancellation fires on it", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const fired: string[] = [];
        let release: () => void = () => undefined;
        let seen: vscode.CancellationToken | undefined;
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            {
                provideInlineCompletionItems: (_doc, _pos, _context, token) => {
                    seen = token;
                    token.onCancellationRequested(() => fired.push("cancelled"));
                    return new Promise((resolve) => {
                        release = () => {
                            resolve([new InlineCompletionItem("late") as never]);
                        };
                    });
                },
            },
        );

        const caller = new CancellationTokenSource();
        const pending = stub.callRequest("languages.provideInlineCompletions", requestParams(), caller.token);
        await Promise.resolve();

        expect(seen?.isCancellationRequested).toBe(false);
        expect(fired).toEqual([]);

        caller.cancel();
        expect(seen?.isCancellationRequested).toBe(true);
        expect(fired).toEqual(["cancelled"]);

        // A stubborn provider answers anyway — the extension layer doesn't silence it
        // (the core cuts it off: the old seq guard against stale answers).
        release();
        expect(await pending).toStrictEqual([[{ insertText: "late" }]]);
    });

    it("the remaining providers are not queried after cancellation", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const polled: string[] = [];
        let release: () => void = () => undefined;
        const caller = new CancellationTokenSource();
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            {
                provideInlineCompletionItems: () => {
                    polled.push("A");
                    return new Promise((resolve) => {
                        release = () => {
                            resolve([]);
                        };
                    });
                },
            },
        );
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            {
                provideInlineCompletionItems: () => {
                    polled.push("B");
                    return [];
                },
            },
        );

        const pending = stub.callRequest(
            "languages.provideInlineCompletions",
            requestParams({ handles: [0, 1] }),
            caller.token,
        );
        await Promise.resolve();
        expect(polled).toEqual(["A"]);

        caller.cancel();
        release();

        expect(await pending).toStrictEqual([[], []]);
        expect(polled).toEqual(["A"]);
    });

    it("cancellation ahead of the request: the provider is never called", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const polled: string[] = [];
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            {
                provideInlineCompletionItems: () => {
                    polled.push("A");
                    return [new InlineCompletionItem("x") as never];
                },
            },
        );

        const caller = new CancellationTokenSource();
        caller.cancel();

        expect(
            await stub.callRequest("languages.provideInlineCompletions", requestParams(), caller.token),
        ).toStrictEqual([[]]);
        expect(polled).toEqual([]);
    });
});
