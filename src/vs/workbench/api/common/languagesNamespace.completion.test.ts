import { describe, expect, it, vi } from "vitest";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace, stripSnippetPlaceholders } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { CompletionItem, CompletionList, MarkdownString, Range, SnippetString, TextEdit } from "./vscodeTypes.ts";
import type { WireCompletionResult, WireResolvedCompletionItem } from "./wireTypes.ts";
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

const REQ = {
    uri: "file:///proj/main.ts",
    languageId: "typescript",
    text: "d.",
    line: 0,
    character: 2,
};

describe("stripSnippetPlaceholders", () => {
    it("вырезает плейсхолдеры, оставляя их текст", () => {
        expect(stripSnippetPlaceholders("greet(${1:name})$0")).toBe("greet(name)");
        expect(stripSnippetPlaceholders("if ${1|a,b|} then")).toBe("if a then");
        expect(stripSnippetPlaceholders("call(${1})")).toBe("call()");
        expect(stripSnippetPlaceholders("sum($1, $2)")).toBe("sum(, )");
    });

    it("экранированный доллар остаётся долларом", () => {
        expect(stripSnippetPlaceholders("cost: \\$5")).toBe("cost: $5");
    });

    it("пустой список вариантов не ломает разбор", () => {
        expect(stripSnippetPlaceholders("x${1||}y")).toBe("xy");
    });
});

describe("LanguagesNamespace — completion: сериализация полей источника", () => {
    it("labelDetails, sortText/filterText и сниппет-insertText доезжают в wire-форме", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);

        const item = new CompletionItem("getTime");
        // labelDetailsSupport объявляет за нас стоковый languageclient — лейбл
        // приезжает объектом с сигнатурой и источником.
        (item as { label: unknown }).label = { label: "getTime", detail: "(): number", description: "lib.es5.d.ts" };
        item.insertText = new SnippetString("getTime(${1:arg})$0") as unknown as string;
        item.filterText = ".getTime";
        item.sortText = "11";

        languages.registerCompletionItemProvider({ language: "typescript" }, {
            provideCompletionItems: () => [item],
        } as never);

        const result = (await stub.callRequest("languages.provideCompletionItems", REQ)) as WireCompletionResult;

        expect(result.items[0]).toMatchObject({
            label: "getTime",
            labelDetail: "(): number",
            labelDescription: "lib.es5.d.ts",
            filterText: ".getTime",
            sortText: "11",
            // Сниппет-синтаксис в буфер не пускаем (табстопов у нас нет).
            insertText: "getTime(arg)",
        });
        expect(result.items[0].id).toBeDefined();
    });

    it("isIncomplete из CompletionList доезжает до ядра", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerCompletionItemProvider({ language: "typescript" }, {
            provideCompletionItems: () => new CompletionList([new CompletionItem("getTime")], true),
        } as never);

        const result = (await stub.callRequest("languages.provideCompletionItems", REQ)) as WireCompletionResult;
        expect(result.isIncomplete).toBe(true);
    });

    it("триггер-символы всех регистраций объединяются в подписке", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const provider = { provideCompletionItems: () => [] } as never;
        languages.registerCompletionItemProvider({ language: "typescript" }, provider, ".", '"');
        languages.registerCompletionItemProvider({ language: "json" }, provider, '"', "/");

        const last = stub.notifies.filter((n) => n.method === "languages.updateSubscriptions").at(-1);
        expect((last?.params as { completionTriggerCharacters: string[] }).completionTriggerCharacters).toEqual([
            ".",
            '"',
            "/",
        ]);
    });

    it("triggerKind/triggerCharacter доезжают до провайдера", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const provideCompletionItems = vi.fn((..._args: unknown[]) => []);
        languages.registerCompletionItemProvider({ language: "typescript" }, { provideCompletionItems } as never);

        await stub.callRequest("languages.provideCompletionItems", { ...REQ, triggerKind: 1, triggerCharacter: "." });

        expect(provideCompletionItems.mock.calls[0][3]).toMatchObject({ triggerKind: 1, triggerCharacter: "." });
    });
});

describe("LanguagesNamespace — resolveCompletionItem", () => {
    /** Регистрирует провайдер с resolve и возвращает id первого пункта. */
    async function completeOnce(
        provider: Record<string, unknown>,
    ): Promise<{ id: string; stub: ReturnType<typeof makeCtx>["stub"] }> {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerCompletionItemProvider({ language: "typescript" }, provider as never);
        const result = (await stub.callRequest("languages.provideCompletionItems", REQ)) as WireCompletionResult;
        return { id: result.items[0].id!, stub };
    }

    it("отдаёт detail/documentation/additionalEdits, догруженные провайдером", async () => {
        const original = new CompletionItem("greet");
        const { id, stub } = await completeOnce({
            provideCompletionItems: () => [original],
            resolveCompletionItem: (item: CompletionItem) => {
                // Резолвить обязаны ТОТ ЖЕ объект: у languageclient в нём лежит
                // приватный `data` для completionItem/resolve.
                expect(item).toBe(original);
                item.detail = "(alias) greet(name: string): string";
                item.documentation = new MarkdownString("Greets someone.") as unknown as string;
                (item as { additionalTextEdits?: unknown }).additionalTextEdits = [
                    new TextEdit(new Range(0, 0, 0, 0), 'import { greet } from "./defs";\n'),
                ];
                return item;
            },
        });

        const resolved = (await stub.callRequest("languages.resolveCompletionItem", { id })) as WireResolvedCompletionItem;
        expect(resolved.detail).toContain("greet");
        expect(resolved.documentation).toBe("Greets someone.");
        expect(resolved.additionalEdits).toEqual([
            { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 }, text: 'import { greet } from "./defs";\n' },
        ]);
    });

    it("провайдер вернул новый объект — читаем его", async () => {
        const { id, stub } = await completeOnce({
            provideCompletionItems: () => [new CompletionItem("greet")],
            resolveCompletionItem: () => {
                const fresh = new CompletionItem("greet");
                fresh.detail = "fresh detail";
                return fresh;
            },
        });
        const resolved = (await stub.callRequest("languages.resolveCompletionItem", { id })) as WireResolvedCompletionItem;
        expect(resolved.detail).toBe("fresh detail");
    });

    it("битые правки-спутники отбрасываются поштучно", async () => {
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
        const resolved = (await stub.callRequest("languages.resolveCompletionItem", { id })) as WireResolvedCompletionItem;
        expect(resolved.additionalEdits).toHaveLength(1);
        const [edit] = resolved.additionalEdits ?? [];
        expect(edit).toMatchObject({ text: "ok" });
    });

    it("resolve вернул undefined — читаем исходный пункт", async () => {
        const { id, stub } = await completeOnce({
            provideCompletionItems: () => {
                const item = new CompletionItem("greet");
                item.detail = "original detail";
                return [item];
            },
            resolveCompletionItem: () => undefined,
        });
        const resolved = (await stub.callRequest("languages.resolveCompletionItem", { id })) as WireResolvedCompletionItem;
        expect(resolved.detail).toBe("original detail");
    });

    it("лейбл-объект без сигнатуры не даёт пустых полей", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const item = new CompletionItem("greet");
        (item as { label: unknown }).label = { label: "greet" }; // без detail/description
        languages.registerCompletionItemProvider({ language: "typescript" }, {
            provideCompletionItems: () => [item],
        } as never);

        const result = (await stub.callRequest("languages.provideCompletionItems", REQ)) as WireCompletionResult;
        expect(result.items[0].labelDetail).toBeUndefined();
        expect(result.items[0].labelDescription).toBeUndefined();
    });

    it("сбойный resolve не роняет попап", async () => {
        const { id, stub } = await completeOnce({
            provideCompletionItems: () => [new CompletionItem("greet")],
            resolveCompletionItem: () => {
                throw new Error("boom");
            },
        });
        expect(await stub.callRequest("languages.resolveCompletionItem", { id })).toBeNull();
    });

    it("провайдер без resolve, чужой и нечисловой id → null", async () => {
        const { id, stub } = await completeOnce({ provideCompletionItems: () => [new CompletionItem("greet")] });
        expect(await stub.callRequest("languages.resolveCompletionItem", { id })).toBeNull();
        expect(await stub.callRequest("languages.resolveCompletionItem", { id: "999.0" })).toBeNull();
        expect(await stub.callRequest("languages.resolveCompletionItem", {})).toBeNull();
    });

    it("кэш держит только последние два ответа", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerCompletionItemProvider({ language: "typescript" }, {
            provideCompletionItems: () => [new CompletionItem("greet")],
            resolveCompletionItem: (item: CompletionItem) => {
                item.detail = "detail";
                return item;
            },
        } as never);

        const first = (await stub.callRequest("languages.provideCompletionItems", REQ)) as WireCompletionResult;
        await stub.callRequest("languages.provideCompletionItems", REQ);
        await stub.callRequest("languages.provideCompletionItems", REQ);

        // Третий запрос вытеснил первое ведро — резолвить нечего, но и падать
        // нельзя: пользователь мог задержать выбор на устаревшем списке.
        expect(await stub.callRequest("languages.resolveCompletionItem", { id: first.items[0].id! })).toBeNull();
    });
});
