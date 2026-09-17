import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { InlineCompletionItem, InlineCompletionList, Range, SnippetString } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function makeCtx(stub: IStubRpc = makeStubRpc()): { ctx: IVscodeHostContext; stub: IStubRpc } {
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
    };
    return { ctx, stub };
}

const URI = "file:///proj/main.ts";

function requestParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { uri: URI, languageId: "typescript", text: "con\n", line: 0, character: 3, triggerKind: 1, ...overrides };
}

describe("LanguagesNamespace — registerInlineCompletionItemProvider", () => {
    it("подписка сигналится на переходах 0↔1 (hasInlineCompletionProviders)", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const subs = () => stub.notifies.filter((n) => n.method === "languages.updateSubscriptions");

        const provider: vscode.InlineCompletionItemProvider = { provideInlineCompletionItems: () => [] };
        const first = languages.registerInlineCompletionItemProvider({ language: "typescript" }, provider);
        expect(subs()).toHaveLength(1);
        expect((subs()[0].params as { hasInlineCompletionProviders?: unknown }).hasInlineCompletionProviders).toBe(
            true,
        );

        const second = languages.registerInlineCompletionItemProvider({ language: "typescript" }, provider);
        expect(subs()).toHaveLength(1);

        first.dispose();
        expect(subs()).toHaveLength(1);
        second.dispose();
        expect(subs()).toHaveLength(2);
        expect((subs()[1].params as { hasInlineCompletionProviders?: unknown }).hasInlineCompletionProviders).toBe(
            false,
        );
        // Повторный dispose — идемпотентен, без лишних нотификаций.
        second.dispose();
        expect(subs()).toHaveLength(2);
    });
});

describe("LanguagesNamespace — languages.provideInlineCompletions", () => {
    it("кладёт снапшот документа в реестр и зовёт провайдер с позицией и triggerKind", async () => {
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
        expect(ctx.registry.get(URI as unknown as vscode.Uri)?.getText()).toBe("con\n");
        expect(result).toStrictEqual([
            {
                insertText: "console.log()",
                range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 3 },
            },
        ]);
    });

    it("InlineCompletionList нормализуется, SnippetString — текстом со стрипом плейсхолдеров", async () => {
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

        expect(result).toStrictEqual([{ insertText: "log(msg)" }]);
    });

    it("filterText уезжает в wire-пункт", async () => {
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
            { insertText: "console.log()", filterText: "console" },
        ]);
    });

    it("обходит все матчащие провайдеры, конкатенирует; несматчащие и сбойные пропускает", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            { provideInlineCompletionItems: () => [new InlineCompletionItem("a") as never] },
        );
        languages.registerInlineCompletionItemProvider(
            { language: "markdown" }, // не матчит документ
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

        expect(await stub.callRequest("languages.provideInlineCompletions", requestParams())).toStrictEqual([
            { insertText: "a" },
            { insertText: "b" },
        ]);
    });

    it("дефолты params: без languageId/line/character/triggerKind — позиция (0,0), Automatic", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { pos?: vscode.Position; context?: vscode.InlineCompletionContext } = {};
        languages.registerInlineCompletionItemProvider("plaintext", {
            provideInlineCompletionItems: (_doc, position, context) => {
                seen.pos = position;
                seen.context = context;
                return [];
            },
        });

        await stub.callRequest("languages.provideInlineCompletions", { uri: URI });

        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(0);
        expect(seen.context?.triggerKind).toBe(1); // Automatic
        // Без text снапшот документа — пустая строка, не мусор.
        expect(ctx.registry.get(URI as unknown as vscode.Uri)?.getText()).toBe("");
    });

    it("null/undefined/мусор от провайдера — пустой ответ; пустой insertText отбрасывается", async () => {
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
            // items не массив (InlineCompletionList с мусором внутри).
            { provideInlineCompletionItems: () => ({ items: 42 }) as never },
        );
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            // null/undefined среди пунктов — drop+skip, не падение сериализатора.
            { provideInlineCompletionItems: () => [null, undefined] as never },
        );
        languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            {
                provideInlineCompletionItems: () =>
                    [
                        new InlineCompletionItem(""),
                        "junk",
                        // insertText не строка и не SnippetString — drop+skip.
                        { insertText: 42 },
                    ] as never,
            },
        );

        expect(await stub.callRequest("languages.provideInlineCompletions", requestParams())).toStrictEqual([]);
    });
});
