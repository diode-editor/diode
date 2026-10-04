import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { CompletionItem, CompletionItemKind, Range } from "./vscodeTypes.ts";
import type { WireCompletionItem, WireCompletionResult } from "./wireTypes.ts";
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

/** Открывает документ в зеркале субпроцесса — как `editor.didOpen` хоста. */
function openDoc(ctx: IVscodeHostContext, uri: string, languageId: string, text: string): void {
    ctx.documentSync.open({ uri, languageId, version: 1, text });
}

/**
 * Контекст субпроцесса с открытым документом completion-запроса
 * ({@link COMPLETION_PARAMS}): текст провайдер читает из зеркала.
 */
function makeCtx(stub: IStubRpc = makeStubRpc()): { ctx: IVscodeHostContext; stub: IStubRpc } {
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
    };
    openDoc(ctx, COMPLETION_PARAMS.uri, COMPLETION_PARAMS.languageId, "ind");
    return { ctx, stub };
}

describe("LanguagesNamespace", () => {
    it("registerCompletionItemProvider объявляет провайдера ядру с триггерами, dispose — снимает один раз", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const provider = { provideCompletionItems: () => [] } as never;
        const disposable = languages.registerCompletionItemProvider(
            { language: "editorconfig", pattern: "**/.editorconfig" },
            provider,
            "=",
            ".",
            "", // пустой символ триггером не бывает — отбрасывается
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
        // Бит completion в updateSubscriptions больше не ездит.
        expect(stub.notifies.filter((n) => n.method === "languages.updateSubscriptions")).toEqual([]);
    });

    it("provideCompletionItems зовёт провайдеров присланных handle и сериализует items", async () => {
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
        )) as WireCompletionResult[];

        // Провайдер ini (handle 1) не прислан — его не спрашивают.
        expect(result.items).toHaveLength(1);
        expect(result.items[0].label).toBe("indent_style");
        expect(result.items[0].insertText).toBe("indent_style"); // fallback на label
        expect(result.items[0].kind).toBe(CompletionItemKind.Property);
        expect(result.items[0].detail).toBe("EditorConfig");
        expect(result.items[0].command?.command).toBe("editorconfig._triggerSuggestAfterDelay");
    });

    it("provideCompletionItems: CompletionList и Range; ответ выровнен по handles, сбойный — пустой", async () => {
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
        })) as WireCompletionResult[];

        expect(results).toHaveLength(4);
        expect(results[0].items).toHaveLength(1);
        expect(results[0].items[0].insertText).toBe("root = true");
        expect(results[0].items[0].range).toEqual({ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 3 });
        // Сбойный (0), неизвестный (7) и чужой формы handle — пустые результаты.
        expect(results.slice(1)).toEqual([
            { items: [], isIncomplete: false },
            { items: [], isIncomplete: false },
            { items: [], isIncomplete: false },
        ]);
    });

    it("provideCompletionItems без handles → пустой массив", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerCompletionItemProvider({ language: "editorconfig" }, {
            provideCompletionItems: () => [new CompletionItem("x")],
        } as never);
        const { handles: _handles, ...noHandles } = COMPLETION_PARAMS;
        expect(await stub.callRequest("languages.provideCompletionItems", noHandles)).toEqual([]);
    });

    it("сериализует разнообразные формы полей и отбрасывает элементы без label", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const items = [
            {
                // объектный label, SnippetString insertText, MarkdownString documentation,
                // range как { replacing }, команда с аргументами
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
            {}, // без label → отбрасывается
            { label: "" }, // пустой label → отбрасывается
            {
                // insertText/documentation-объекты без value → fallback; не-Range range → undefined
                label: "d",
                insertText: {},
                documentation: {},
                range: { foo: 1 },
                command: { command: "" }, // пустая команда отбрасывается
            },
            { label: "e", range: null }, // range null
        ];
        languages.registerCompletionItemProvider({ language: "editorconfig" }, {
            provideCompletionItems: () => items,
        } as never);

        const [result] = (await stub.callRequest(
            "languages.provideCompletionItems",
            COMPLETION_PARAMS,
        )) as WireCompletionResult[];

        expect(result.items.map((r) => r.label)).toEqual(["objlabel", "d", "e"]);
        const a = result.items[0];
        expect(a.insertText).toBe("snippet");
        expect(a.documentation).toBe("md");
        expect(a.sortText).toBe("0");
        expect(a.filterText).toBe("f");
        expect(a.range).toEqual({ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 1 });
        expect(a.command).toEqual({ command: "c", arguments: [1] });
        const d = result.items[1];
        expect(d.insertText).toBe("d"); // fallback на label
        expect(d.documentation).toBeUndefined();
        expect(d.range).toBeUndefined();
        expect(d.command).toBeUndefined();
    });

    it("provideCompletionItems: пропущенные languageId/line/character + строковая documentation", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const item = new CompletionItem("root");
        item.documentation = "root docs"; // строка (не MarkdownString)
        languages.registerCompletionItemProvider(
            { pattern: "**/.editorconfig" }, // матч по пути, без language
            { provideCompletionItems: () => [item] } as never,
        );
        // Параметры только с ресурсом и версией — остальные поля резолвятся дефолтами.
        const [result] = (await stub.callRequest("languages.provideCompletionItems", {
            handles: [0],
            uri: Uri.file("/proj/.editorconfig").toString(),
            version: 1,
        })) as WireCompletionResult[];
        expect(result.items).toHaveLength(1);
        expect(result.items[0].documentation).toBe("root docs");
        // languageId не пришёл — язык зеркала не затирается.
        expect(ctx.registry.get(Uri.parse(COMPLETION_PARAMS.uri))?.languageId).toBe("editorconfig");
    });

    it("normalizeResult: undefined и {items: не-массив} → пусто", async () => {
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

    it("registerFoldingRangeProvider объявляет провайдера ядру, dispose снимает один раз", () => {
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
        d1.dispose(); // повторный dispose безопасен
        expect(stub.notifies.filter((n) => n.method === "languages.unregister").map((n) => n.params)).toEqual([
            { handle: 0 },
        ]);
        // Бит folding в updateSubscriptions больше не ездит.
        const subs = stub.notifies.filter((n) => n.method === "languages.updateSubscriptions");
        expect(subs.map((n) => n.params)).not.toContainEqual(expect.objectContaining({ hasFoldingProviders: true }));
    });

    it("provideFoldingRanges: ответ выровнен по handles; не массив → пустой список", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerFoldingRangeProvider(["csharp"], {
            provideFoldingRanges: () => null,
        } as never);
        languages.registerFoldingRangeProvider(["csharp"], {
            // Валидный + битый start + битый end — оба битых отсеются сериализатором.
            provideFoldingRanges: () => [
                { start: 1, end: 2 },
                { start: "x", end: 2 },
                { start: 3, end: "x" },
            ],
        } as never);
        // Запрос без languageId — ветка дефолта: язык остаётся от didOpen.
        openDoc(ctx, PROGRAM_CS, "csharp", "");
        const result = await stub.callRequest("languages.provideFoldingRanges", {
            handles: [0, 1],
            uri: PROGRAM_CS,
            version: 1,
        });
        expect(ctx.registry.get(Uri.parse(PROGRAM_CS))?.languageId).toBe("csharp");
        expect(result).toEqual([[], [{ start: 1, end: 2 }]]);
    });

    it("provideFoldingRanges: неизвестный и чужой формы handle — пустые, без handles — []", async () => {
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

    it("provide*-запрос не пишет в зеркало: провайдер — только после didOpen и по версии запроса, без событий", async () => {
        // Регрессия двух реальных отказов LSP-клиента (vscode-languageclient
        // транслирует события документа в didOpen/didChange серверу):
        // 1) провайдер звался до didOpen → сервер получал foldingRange по
        //    неизвестному документу («Unexpected resource»);
        // 2) запрос с обогнавшим текстом писал в реестр мимо событий → следующий
        //    didChange считал диапазон от УЖЕ нового текста → правка за пределами
        //    серверной копии (крэш tsserver «reading 'charCount'»).
        // Теперь запрос текста не везёт вовсе: документ — только из зеркала.
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

        // До didOpen провайдер не зовётся и документ не заводится.
        expect(await request(1)).toEqual([]);
        expect(log).toEqual([]);
        expect(ctx.registry.get(Uri.parse(PROGRAM_CS))).toBeUndefined();

        openDoc(ctx, PROGRAM_CS, "csharp", "a");
        await request(1);
        expect(log).toEqual(["open:a", "provider:a"]);

        // Правка хоста — событие с диапазоном по старому тексту ("a" → длина 1,
        // конец 0:1); запрос, отставший от неё, провайдера не будит и событий
        // не порождает.
        log.length = 0;
        ctx.documentSync.change({
            uri: PROGRAM_CS,
            version: 2,
            changes: [{ range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 1 }, text: "ab\ncdd" }],
        });
        expect(await request(1)).toEqual([]);
        await request(2);
        expect(log).toEqual(["change:1:0.1", "provider:ab\ncdd"]);
    });

    it("provideFoldingRanges зовёт провайдеров присланных handle и сериализует области", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerFoldingRangeProvider(["csharp"], {
            provideFoldingRanges: () => [
                { start: 0, end: 3, kind: 3 },
                { start: 5, end: 9 },
            ],
        } as never);
        // Провайдер, которого ядро не прислало, не должен сработать.
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

    it("provideFoldingRanges: сбойный провайдер не роняет остальные", async () => {
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

    it("provideFoldingRanges: не открытый, устаревший и обогнавший зеркало документ — [] без провайдера", async () => {
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
            changes: [{ range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 }, text: "x" }],
        });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            expect(await request(Uri.file("/proj/Other.cs").toString(), 1)).toEqual([]);
            expect(await request(PROGRAM_CS, 1)).toEqual([]);
            expect(await request(PROGRAM_CS, 3)).toEqual([]);
            // Обогнавший зеркало — нарушение порядка, в stderr.
            expect(warn).toHaveBeenCalledTimes(1);
        } finally {
            warn.mockRestore();
        }
        expect(asked).toBe(0);

        expect(await request(PROGRAM_CS, 2)).toEqual([[{ start: 0, end: 1 }]]);
        expect(asked).toBe(1);
    });

    it("provideCompletionItems: не открытый и устаревший документ — [] без провайдера", async () => {
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
