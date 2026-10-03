import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

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
    return {
        handle: 0,
        uri: URI,
        languageId: "typescript",
        text: "const a = b;\n",
        line: 0,
        character: 10,
        ...overrides,
    };
}

describe("LanguagesNamespace — registerHoverProvider", () => {
    it("каждая регистрация объявляется ядру с handle и селектором, dispose — снимает", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const sent = () => stub.notifies.filter((n) => n.method.startsWith("languages."));

        const first = languages.registerHoverProvider({ language: "typescript" }, { provideHover: () => null });
        const second = languages.registerHoverProvider("markdown", { provideHover: () => null });
        expect(sent()).toEqual([
            {
                method: "languages.register",
                params: { handle: 0, kind: "hover", selector: [{ language: "typescript" }] },
            },
            {
                method: "languages.register",
                params: { handle: 1, kind: "hover", selector: [{ language: "markdown" }] },
            },
        ]);

        first.dispose();
        second.dispose();
        expect(sent().slice(2)).toEqual([
            { method: "languages.unregister", params: { handle: 0 } },
            { method: "languages.unregister", params: { handle: 1 } },
        ]);

        // Повторный dispose — идемпотентен, без лишних нотификаций.
        second.dispose();
        expect(sent()).toHaveLength(4);
    });

    it("снятый провайдер на запрос по своему handle не отвечает", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const registration = languages.registerHoverProvider(
            { language: "typescript" },
            { provideHover: () => new Hover("жив") as unknown as vscode.Hover },
        );
        expect(await stub.callRequest("languages.provideHover", requestParams())).toEqual({ contents: ["жив"] });

        registration.dispose();

        expect(await stub.callRequest("languages.provideHover", requestParams())).toBeNull();
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
        expect(result).toEqual({
            contents: ["```ts\nconst a: number\n```"],
            range: { startLine: 0, startCharacter: 6, endLine: 0, endCharacter: 7 },
        });
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

        expect(result).toEqual({
            contents: ["просто строка", "**markdown**", "```ts\nconst b = 1\n```", "без языка"],
        });
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

        const result = await stub.callRequest("languages.provideHover", { handle: 0, uri: URI });

        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(0);
        expect(ctx.registry.get(Uri.parse(URI))?.getText()).toBe("");
        // languageId в запросе не пришёл — документ остаётся на дефолте реестра,
        // а не получает undefined (иначе селекторы перестали бы матчиться).
        expect(ctx.registry.get(Uri.parse(URI))?.languageId).toBe("plaintext");
        expect(result).toEqual({ contents: ["одна строка не в массиве"] });
    });

    it("зовётся ровно провайдер запрошенного handle; сбойный, пустой и неизвестный — null", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const calls: string[] = [];
        const provider = (name: string, answer: () => vscode.ProviderResult<vscode.Hover>): vscode.HoverProvider => ({
            provideHover: () => {
                calls.push(name);
                return answer();
            },
        });
        languages.registerHoverProvider(
            { language: "typescript" },
            provider("throwing", () => {
                throw new Error("boom");
            }),
        );
        languages.registerHoverProvider(
            { language: "typescript" },
            provider("empty", () => null),
        );
        languages.registerHoverProvider(
            { language: "typescript" },
            provider("second", () => new Hover(["от второго", "и ещё"]) as unknown as vscode.Hover),
        );

        expect(await stub.callRequest("languages.provideHover", requestParams({ handle: 2 }))).toEqual({
            contents: ["от второго", "и ещё"],
        });
        expect(calls).toEqual(["second"]);

        expect(await stub.callRequest("languages.provideHover", requestParams({ handle: 0 }))).toBeNull();
        expect(await stub.callRequest("languages.provideHover", requestParams({ handle: 1 }))).toBeNull();
        expect(calls).toEqual(["second", "throwing", "empty"]);

        // Неизвестный и отсутствующий handle — никого не зовём и документ не синхронизируем.
        const stale = "file:///proj/stale.ts";
        expect(await stub.callRequest("languages.provideHover", requestParams({ handle: 42, uri: stale }))).toBeNull();
        expect(ctx.registry.get(Uri.parse(stale))).toBeUndefined();
        expect(await stub.callRequest("languages.provideHover", requestParams({ handle: undefined }))).toBeNull();
        expect(calls).toHaveLength(3);
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

        expect(await stub.callRequest("languages.provideHover", requestParams())).toEqual({ contents: ["текст"] });
        expect(await stub.callRequest("languages.provideHover", requestParams({ handle: 1 }))).toBeNull();
    });
});
