import type * as vscode from "vscode";

import { describe, expect, it } from "vitest";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { Hover, MarkdownString, Range, Uri } from "./vscodeTypes.ts";
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
    return { uri: URI, languageId: "typescript", text: "const a = b;\n", line: 0, character: 10, ...overrides };
}

describe("LanguagesNamespace — registerHoverProvider", () => {
    it("подписка сигналится на переходах 0↔1 (hasHoverProviders)", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const subs = () => stub.notifies.filter((n) => n.method === "languages.updateSubscriptions");

        const first = languages.registerHoverProvider({ language: "typescript" }, { provideHover: () => null });
        expect(subs()).toEqual([
            {
                method: "languages.updateSubscriptions",
                params: {
                    hasCompletionProviders: false,
                    hasFoldingProviders: false,
                    hasDefinitionProviders: false,
                    hasHoverProviders: true,
                    hasReferenceProviders: false,
                    hasSignatureHelpProviders: false,
                    signatureHelpTriggerCharacters: [],
                    signatureHelpRetriggerCharacters: [],
                    completionTriggerCharacters: [],
                },
            },
        ]);

        const second = languages.registerHoverProvider({ language: "typescript" }, { provideHover: () => null });
        expect(subs()).toHaveLength(1);

        first.dispose();
        expect(subs()).toHaveLength(1);
        second.dispose();
        expect(subs()).toHaveLength(2);
        expect(subs()[1].params).toEqual({
            hasCompletionProviders: false,
            hasFoldingProviders: false,
            hasDefinitionProviders: false,
            hasHoverProviders: false,
            hasReferenceProviders: false,
            hasSignatureHelpProviders: false,
            signatureHelpTriggerCharacters: [],
            signatureHelpRetriggerCharacters: [],
            completionTriggerCharacters: [],
        });
        // Повторный dispose — идемпотентен, без лишних нотификаций.
        second.dispose();
        expect(subs()).toHaveLength(2);
    });
});

describe("LanguagesNamespace — languages.provideHover", () => {
    it("кладёт снапшот документа в реестр и зовёт провайдер с позицией каретки", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { doc?: vscode.TextDocument; pos?: vscode.Position } = {};
        languages.registerHoverProvider(
            { language: "typescript" },
            {
                provideHover: (document, position) => {
                    seen.doc = document;
                    seen.pos = position;
                    return new Hover(
                        new MarkdownString("```ts\nconst a: number\n```"),
                        new Range(0, 6, 0, 7) as unknown as vscode.Range,
                    ) as unknown as vscode.Hover;
                },
            },
        );

        const result = await stub.callRequest("languages.provideHover", requestParams());

        expect(seen.doc?.getText()).toBe("const a = b;\n");
        expect(seen.doc?.languageId).toBe("typescript");
        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(10);
        expect(ctx.registry.get(Uri.parse(URI))?.getText()).toBe("const a = b;\n");
        expect(result).toEqual([
            {
                contents: ["```ts\nconst a: number\n```"],
                range: { startLine: 0, startCharacter: 6, endLine: 0, endCharacter: 7 },
            },
        ]);
    });

    it("contents нормализуется: строка, MarkdownString и MarkedString-codeblock → блоки markdown", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerHoverProvider(
            { language: "typescript" },
            {
                provideHover: () =>
                    ({
                        contents: [
                            "просто строка",
                            new MarkdownString("**markdown**"),
                            { language: "ts", value: "const b = 1" }, // legacy MarkedString
                            { language: "", value: "без языка" },
                            "", // пустой блок отбрасывается
                            "   \n  ", // из одних пробелов — тоже пустой
                            42, // мусор отбрасывается
                            {}, // объект без value — тоже мусор
                            null, // typeof null === "object", но полей у него нет
                        ],
                        // range нет — hover без диапазона валиден
                    }) as unknown as vscode.Hover,
            },
        );

        const result = await stub.callRequest("languages.provideHover", requestParams());

        expect(result).toEqual([
            {
                contents: ["просто строка", "**markdown**", "```ts\nconst b = 1\n```", "без языка"],
            },
        ]);
    });

    it("contents не-массивом и запрос без полей: позиция — (0,0), текст — пустой", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { pos?: vscode.Position } = {};
        languages.registerHoverProvider(
            { language: "plaintext" },
            {
                provideHover: (_doc, position) => {
                    seen.pos = position;
                    return { contents: "одна строка не в массиве" } as unknown as vscode.Hover;
                },
            },
        );

        const result = await stub.callRequest("languages.provideHover", { uri: URI });

        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(0);
        expect(ctx.registry.get(Uri.parse(URI))?.getText()).toBe("");
        // languageId в запросе не пришёл — документ остаётся на дефолте реестра,
        // а не получает undefined (иначе селекторы перестали бы матчиться).
        expect(ctx.registry.get(Uri.parse(URI))?.languageId).toBe("plaintext");
        expect(result).toEqual([{ contents: ["одна строка не в массиве"] }]);
    });

    it("несколько провайдеров: результаты конкатенируются в порядке регистрации, сбойные и пустые пропускаются", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const calls: string[] = [];
        languages.registerHoverProvider(
            { language: "python" },
            {
                provideHover: () => {
                    calls.push("python");
                    return null;
                },
            },
        );
        languages.registerHoverProvider(
            { language: "typescript" },
            {
                provideHover: () => {
                    calls.push("throwing");
                    throw new Error("boom");
                },
            },
        );
        languages.registerHoverProvider(
            { language: "typescript" },
            {
                provideHover: () => {
                    calls.push("empty");
                    return null;
                },
            },
        );
        languages.registerHoverProvider(
            { language: "typescript" },
            {
                provideHover: () => {
                    calls.push("first");
                    return new Hover("от первого") as unknown as vscode.Hover;
                },
            },
        );
        languages.registerHoverProvider(
            { language: "typescript" },
            {
                provideHover: () => {
                    calls.push("second");
                    return new Hover(["от второго", "и ещё"]) as unknown as vscode.Hover;
                },
            },
        );

        const result = await stub.callRequest("languages.provideHover", requestParams());

        // Несовпавший селектор (python) вообще не вызывается; порядок — порядок регистрации.
        expect(calls).toEqual(["throwing", "empty", "first", "second"]);
        expect(result).toEqual([{ contents: ["от первого"] }, { contents: ["от второго", "и ещё"] }]);
    });

    it("hover с кривым range сериализуется без range; без contents — отбрасывается целиком", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerHoverProvider(
            { language: "typescript" },
            {
                provideHover: () =>
                    ({ contents: ["текст"], range: { start: null, end: null } }) as unknown as vscode.Hover,
            },
        );
        languages.registerHoverProvider(
            { language: "typescript" },
            { provideHover: () => ({ contents: [] }) as unknown as vscode.Hover },
        );

        const result = await stub.callRequest("languages.provideHover", requestParams());

        expect(result).toEqual([{ contents: ["текст"] }]);
    });
});
