import type * as vscode from "vscode";

import { describe, expect, it } from "vitest";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { Location, Position, Range, Uri } from "./vscodeTypes.ts";
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
        uri: URI,
        languageId: "typescript",
        text: "const a = b;\n",
        line: 0,
        character: 10,
        includeDeclaration: true,
        ...overrides,
    };
}

/** `vscode.Location` в форме, которую отдают настоящие провайдеры. */
function location(uri: string, line: number): vscode.Location {
    return new Location(Uri.parse(uri), new Range(line, 2, line, 7)) as unknown as vscode.Location;
}

function wireLocation(uri: string, line: number): unknown {
    return { uri, range: { startLine: line, startCharacter: 2, endLine: line, endCharacter: 7 } };
}

describe("LanguagesNamespace — registerReferenceProvider", () => {
    it("подписка сигналится на переходах 0↔1 (hasReferenceProviders)", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const subs = (): typeof stub.notifies =>
            stub.notifies.filter((n) => n.method === "languages.updateSubscriptions");

        const first = languages.registerReferenceProvider(
            { language: "typescript" },
            { provideReferences: () => null },
        );
        expect(subs()).toEqual([
            {
                method: "languages.updateSubscriptions",
                params: {
                    hasCompletionProviders: false,
                    hasFoldingProviders: false,
                    hasDefinitionProviders: false,
                    hasHoverProviders: false,
                    hasReferenceProviders: true,
                    completionTriggerCharacters: [],
                },
            },
        ]);

        const second = languages.registerReferenceProvider(
            { language: "typescript" },
            { provideReferences: () => null },
        );
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
            completionTriggerCharacters: [],
        });
        // Повторный dispose — идемпотентен, без лишних нотификаций.
        second.dispose();
        expect(subs()).toHaveLength(2);
    });

    it("реестр регистраций доступен снаружи (его читают тесты и диагностика хоста)", () => {
        const { ctx } = makeCtx();
        const { languages, referenceRegistrations } = createLanguagesNamespace(ctx);
        expect(referenceRegistrations).toHaveLength(0);
        languages.registerReferenceProvider({ language: "typescript" }, { provideReferences: () => null });
        expect(referenceRegistrations).toHaveLength(1);
    });
});

describe("LanguagesNamespace — languages.provideReferences", () => {
    it("кладёт снапшот в реестр и зовёт провайдер с позицией каретки и контекстом", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { doc?: vscode.TextDocument; pos?: vscode.Position; ctx?: vscode.ReferenceContext } = {};
        languages.registerReferenceProvider(
            { language: "typescript" },
            {
                provideReferences: (document, position, context) => {
                    seen.doc = document;
                    seen.pos = position;
                    seen.ctx = context;
                    return [location("file:///proj/use.ts", 3)];
                },
            },
        );

        const result = await stub.callRequest("languages.provideReferences", requestParams());

        expect(seen.doc?.getText()).toBe("const a = b;\n");
        expect(seen.doc?.languageId).toBe("typescript");
        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(10);
        expect(seen.ctx).toEqual({ includeDeclaration: true });
        expect(ctx.registry.get(Uri.parse(URI))?.getText()).toBe("const a = b;\n");
        expect(result).toEqual([wireLocation("file:///proj/use.ts", 3)]);
    });

    it("includeDeclaration: false доезжает до провайдера; без поля — false", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: vscode.ReferenceContext[] = [];
        languages.registerReferenceProvider(
            { language: "typescript" },
            {
                provideReferences: (_doc, _pos, context) => {
                    seen.push(context);
                    return [];
                },
            },
        );

        await stub.callRequest("languages.provideReferences", requestParams({ includeDeclaration: false }));
        await stub.callRequest("languages.provideReferences", requestParams({ includeDeclaration: undefined }));

        expect(seen).toEqual([{ includeDeclaration: false }, { includeDeclaration: false }]);
    });

    it("несколько провайдеров: результаты конкатенируются в порядке регистрации, сбойный пропускается", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);

        // 1. Чужой селектор — не спрашиваем вовсе.
        let askedForeign = false;
        languages.registerReferenceProvider(
            { language: "python" },
            {
                provideReferences: () => {
                    askedForeign = true;
                    return [location("file:///proj/python.py", 0)];
                },
            },
        );
        // 2. Первый рабочий.
        languages.registerReferenceProvider(
            { language: "typescript" },
            { provideReferences: () => [location("file:///proj/a.ts", 1)] },
        );
        // 3. Сбойный — бросает синхронно.
        languages.registerReferenceProvider(
            { language: "typescript" },
            {
                provideReferences: () => {
                    throw new Error("boom");
                },
            },
        );
        // 4. Отклонённый промис — тоже не роняет остальных.
        languages.registerReferenceProvider(
            { language: "typescript" },
            { provideReferences: () => Promise.reject(new Error("nope")) },
        );
        // 5. Пустой ответ и null.
        languages.registerReferenceProvider({ language: "typescript" }, { provideReferences: () => [] });
        languages.registerReferenceProvider({ language: "typescript" }, { provideReferences: () => null });
        // 6. Второй рабочий — асинхронный, с двумя ссылками.
        languages.registerReferenceProvider(
            { language: "typescript" },
            {
                provideReferences: () =>
                    Promise.resolve([location("file:///proj/b.ts", 2), location("file:///proj/c.ts", 3)]),
            },
        );

        const result = await stub.callRequest("languages.provideReferences", requestParams());

        expect(askedForeign).toBe(false);
        expect(result).toEqual([
            wireLocation("file:///proj/a.ts", 1),
            wireLocation("file:///proj/b.ts", 2),
            wireLocation("file:///proj/c.ts", 3),
        ]);
    });

    it("не-массив от провайдера и мусор внутри массива отбрасываются", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        // Одиночный Location вместо массива — форма definition, для references
        // она не по контракту (`ProviderResult<Location[]>`), и мы её не принимаем.
        languages.registerReferenceProvider(
            { language: "typescript" },
            { provideReferences: () => location("file:///proj/single.ts", 0) as unknown as vscode.Location[] },
        );
        languages.registerReferenceProvider(
            { language: "typescript" },
            {
                provideReferences: () =>
                    [
                        null,
                        42,
                        { uri: "file:///proj/no-range.ts" },
                        { range: new Range(0, 0, 0, 1) },
                        location("file:///proj/ok.ts", 4),
                    ] as unknown as vscode.Location[],
            },
        );

        const result = await stub.callRequest("languages.provideReferences", requestParams());

        expect(result).toEqual([wireLocation("file:///proj/ok.ts", 4)]);
    });

    it("запрос без полей: позиция (0,0), пустой текст, язык реестра не затирается", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { pos?: vscode.Position } = {};
        languages.registerReferenceProvider(
            { language: "plaintext" },
            {
                provideReferences: (_doc, position) => {
                    seen.pos = position;
                    return [];
                },
            },
        );

        const result = await stub.callRequest("languages.provideReferences", { uri: URI });

        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(0);
        expect(ctx.registry.get(Uri.parse(URI))?.getText()).toBe("");
        expect(ctx.registry.get(Uri.parse(URI))?.languageId).toBe("plaintext");
        expect(result).toEqual([]);
    });

    it("без провайдеров — пустой ответ, а не ошибка", async () => {
        const { ctx, stub } = makeCtx();
        createLanguagesNamespace(ctx);
        expect(await stub.callRequest("languages.provideReferences", requestParams())).toEqual([]);
    });
});

describe("LanguagesNamespace — Position/Location стаба", () => {
    it("Position из vscodeTypes конструируется так же, как ждёт провайдер", () => {
        // Дежурная проверка, что стаб-классы, которыми пользуется конвертер
        // стокового vscode-languageclient (`new code.Location(uri, range)`),
        // остаются конструируемыми: без них конвертация ответа падает целиком.
        const loc = new Location(Uri.parse(URI), new Position(1, 2));
        expect(loc.range.start.line).toBe(1);
        expect(loc.range.end.character).toBe(2);
    });
});
