import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";

import { DocumentRegistry } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { CompletionItem, CompletionItemKind, Range } from "./vscodeTypes.ts";
import type { WireCompletionItem } from "./wireTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function makeCtx(stub: IStubRpc = makeStubRpc()): { ctx: IVscodeHostContext; stub: IStubRpc } {
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry: new DocumentRegistry(),
        configStore: new WorkspaceConfigStore(),
    };
    return { ctx, stub };
}

const COMPLETION_PARAMS = {
    uri: Uri.file("/proj/.editorconfig").toString(),
    languageId: "editorconfig",
    text: "ind",
    line: 0,
    character: 3,
};

describe("LanguagesNamespace", () => {
    it("registerCompletionItemProvider сохраняет регистрацию и возвращает Disposable", () => {
        const { ctx } = makeCtx();
        const { languages, registrations } = createLanguagesNamespace(ctx);
        const provider = { provideCompletionItems: () => [] } as never;
        const disposable = languages.registerCompletionItemProvider(
            { language: "editorconfig", pattern: "**/.editorconfig" },
            provider,
            "=",
            ".",
        );
        expect(registrations).toHaveLength(1);
        expect(registrations[0].provider).toBe(provider);
        expect(registrations[0].triggerCharacters).toEqual(["=", "."]);
        disposable.dispose();
        expect(registrations).toHaveLength(0);
        // повторный dispose безопасен (ветка idx < 0)
        expect(() => {
            disposable.dispose();
        }).not.toThrow();
        expect(registrations).toHaveLength(0);
    });

    it("сигналит languages.updateSubscriptions на переходах 0↔1", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const provider = { provideCompletionItems: () => [] } as never;
        const d1 = languages.registerCompletionItemProvider({ language: "editorconfig" }, provider);
        const d2 = languages.registerCompletionItemProvider({ language: "ini" }, provider);
        const subs = stub.notifies.filter((n) => n.method === "languages.updateSubscriptions");
        // Только переход 0→1 шлёт notif (второй провайдер не шлёт).
        expect(subs).toHaveLength(1);
        expect(subs[0].params).toEqual({ hasCompletionProviders: true, hasFoldingProviders: false, hasDefinitionProviders: false });

        d1.dispose(); // ещё остаётся d2 — notif нет
        expect(stub.notifies.filter((n) => n.method === "languages.updateSubscriptions")).toHaveLength(1);
        d2.dispose(); // 1→0 — notif {false}
        const after = stub.notifies.filter((n) => n.method === "languages.updateSubscriptions");
        expect(after).toHaveLength(2);
        expect(after[1].params).toEqual({ hasCompletionProviders: false, hasFoldingProviders: false, hasDefinitionProviders: false });
    });

    it("provideCompletionItems вызывает только матчащие провайдеры и сериализует items", async () => {
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

        const result = (await stub.callRequest(
            "languages.provideCompletionItems",
            COMPLETION_PARAMS,
        )) as WireCompletionItem[];

        expect(result).toHaveLength(1);
        expect(result[0].label).toBe("indent_style");
        expect(result[0].insertText).toBe("indent_style"); // fallback на label
        expect(result[0].kind).toBe(CompletionItemKind.Property);
        expect(result[0].detail).toBe("EditorConfig");
        expect(result[0].command?.command).toBe("editorconfig._triggerSuggestAfterDelay");
    });

    it("provideCompletionItems: CompletionList и Range, сбойный провайдер не роняет остальные", async () => {
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

        const result = (await stub.callRequest(
            "languages.provideCompletionItems",
            COMPLETION_PARAMS,
        )) as WireCompletionItem[];

        expect(result).toHaveLength(1);
        expect(result[0].insertText).toBe("root = true");
        expect(result[0].range).toEqual({ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 3 });
    });

    it("provideCompletionItems без матчащих провайдеров → пустой массив", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerCompletionItemProvider({ language: "python" }, {
            provideCompletionItems: () => [new CompletionItem("x")],
        } as never);
        const result = await stub.callRequest("languages.provideCompletionItems", COMPLETION_PARAMS);
        expect(result).toEqual([]);
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

        const result = (await stub.callRequest(
            "languages.provideCompletionItems",
            COMPLETION_PARAMS,
        )) as WireCompletionItem[];

        expect(result.map((r) => r.label)).toEqual(["objlabel", "d", "e"]);
        const a = result[0];
        expect(a.insertText).toBe("snippet");
        expect(a.documentation).toBe("md");
        expect(a.sortText).toBe("0");
        expect(a.filterText).toBe("f");
        expect(a.range).toEqual({ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 1 });
        expect(a.command).toEqual({ command: "c", arguments: [1] });
        const d = result[1];
        expect(d.insertText).toBe("d"); // fallback на label
        expect(d.documentation).toBeUndefined();
        expect(d.range).toBeUndefined();
        expect(d.command).toBeUndefined();
    });

    it("provideCompletionItems: пропущенные languageId/text/line/character + строковая documentation", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const item = new CompletionItem("root");
        item.documentation = "root docs"; // строка (не MarkdownString)
        languages.registerCompletionItemProvider(
            { pattern: "**/.editorconfig" }, // матч по пути, без language
            { provideCompletionItems: () => [item] } as never,
        );
        // Параметры только с fileName — остальные поля резолвятся дефолтами.
        const result = (await stub.callRequest("languages.provideCompletionItems", {
            uri: Uri.file("/proj/.editorconfig").toString(),
        })) as WireCompletionItem[];
        expect(result).toHaveLength(1);
        expect(result[0].documentation).toBe("root docs");
    });

    it("normalizeResult: undefined и {items: не-массив} → пусто", async () => {
        const undef = makeCtx();
        const nsU = createLanguagesNamespace(undef.ctx);
        nsU.languages.registerCompletionItemProvider({ language: "editorconfig" }, {
            provideCompletionItems: () => undefined,
        } as never);
        expect(await undef.stub.callRequest("languages.provideCompletionItems", COMPLETION_PARAMS)).toEqual([]);

        const bad = makeCtx();
        const nsB = createLanguagesNamespace(bad.ctx);
        nsB.languages.registerCompletionItemProvider({ language: "editorconfig" }, {
            provideCompletionItems: () => ({ items: 5 }),
        } as never);
        expect(await bad.stub.callRequest("languages.provideCompletionItems", COMPLETION_PARAMS)).toEqual([]);
    });

    it("registerFoldingRangeProvider сохраняет регистрацию и сигналит subscription", () => {
        const { ctx, stub } = makeCtx();
        const { languages, foldingRegistrations } = createLanguagesNamespace(ctx);
        const provider = { provideFoldingRanges: () => [] } as never;
        const d1 = languages.registerFoldingRangeProvider(["csharp"], provider);
        const d2 = languages.registerFoldingRangeProvider(["typescript"], provider);
        expect(foldingRegistrations).toHaveLength(2);
        // Только переход 0→1 шлёт notif (второй провайдер не шлёт).
        const subs = stub.notifies.filter((n) => n.method === "languages.updateSubscriptions");
        expect(subs).toHaveLength(1);
        expect(subs[0].params).toEqual({ hasCompletionProviders: false, hasFoldingProviders: true, hasDefinitionProviders: false });

        d1.dispose(); // ещё остаётся d2 — notif нет
        expect(stub.notifies.filter((n) => n.method === "languages.updateSubscriptions")).toHaveLength(1);
        d1.dispose(); // повторный dispose безопасен (idx < 0)
        d2.dispose(); // 1→0 — notif {false}
        expect(foldingRegistrations).toHaveLength(0);
        const after = stub.notifies.filter((n) => n.method === "languages.updateSubscriptions");
        expect(after[1].params).toEqual({ hasCompletionProviders: false, hasFoldingProviders: false, hasDefinitionProviders: false });
    });

    it("provideFoldingRanges: провайдер вернул не массив → пропускается", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerFoldingRangeProvider(["csharp"], {
            provideFoldingRanges: () => null,
        } as never);
        languages.registerFoldingRangeProvider(["csharp"], {
            // Валидный + битый start + битый end — оба битых отсеются сериализатором.
            provideFoldingRanges: () => [{ start: 1, end: 2 }, { start: "x", end: 2 }, { start: 3, end: "x" }],
        } as never);
        // Запрос без languageId/text — ветки дефолтов (languageId скипается, text → "").
        // ExtHostTextDocument без languageId остаётся csharp по предыдущему upsert? Нет —
        // тут первый upsert, поэтому явно даём languageId для матча селектора.
        const result = await stub.callRequest("languages.provideFoldingRanges", {
            uri: Uri.file("/proj/Program.cs").toString(),
            languageId: "csharp",
        });
        expect(result).toEqual([{ start: 1, end: 2 }]);
    });

    it("provideFoldingRanges: без languageId/text — дефолты, без матча селектора", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerFoldingRangeProvider(["csharp"], {
            provideFoldingRanges: () => [{ start: 0, end: 3 }],
        } as never);
        // uri без languageId → документ plaintext → селектор csharp не матчит → [].
        const result = await stub.callRequest("languages.provideFoldingRanges", {
            uri: Uri.file("/proj/Program.txt").toString(),
        });
        expect(result).toEqual([]);
    });

    it("provideFoldingRanges вызывает только матчащие провайдеры и сериализует области", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerFoldingRangeProvider(["csharp"], {
            provideFoldingRanges: () => [
                { start: 0, end: 3, kind: 3 },
                { start: 5, end: 9 },
            ],
        } as never);
        // Провайдер другого языка не должен сработать.
        languages.registerFoldingRangeProvider(["typescript"], {
            provideFoldingRanges: () => [{ start: 100, end: 200 }],
        } as never);

        const result = await stub.callRequest("languages.provideFoldingRanges", {
            uri: Uri.file("/proj/Program.cs").toString(),
            languageId: "csharp",
            text: "/* #region */\n\n\n/* #endregion */\n\n\n\n\n\n\n",
        });
        expect(result).toEqual([
            { start: 0, end: 3, kind: 3 },
            { start: 5, end: 9 },
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
        const result = await stub.callRequest("languages.provideFoldingRanges", {
            uri: Uri.file("/proj/Program.cs").toString(),
            languageId: "csharp",
            text: "a\nb\nc\n",
        });
        expect(result).toEqual([{ start: 1, end: 2 }]);
    });
});
