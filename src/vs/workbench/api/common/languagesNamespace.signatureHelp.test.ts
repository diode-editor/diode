import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { SignatureHelpTriggerKind as CoreTriggerKind } from "../../../editor/common/languages/iSignatureHelpSource.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { MarkdownString, ParameterInformation, SignatureHelp, SignatureInformation, Uri } from "./vscodeTypes.ts";
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
        text: "greet(\n",
        line: 0,
        character: 6,
        triggerKind: CoreTriggerKind.TriggerCharacter,
        triggerCharacter: "(",
        isRetrigger: false,
        ...overrides,
    };
}

/** `vscode.SignatureHelp` в той форме, которую строит конвертер клиента. */
function help(label: string, parameterLabel: string | [number, number] = "name: string"): vscode.SignatureHelp {
    const signature = new SignatureInformation(label, new MarkdownString("Здоровается."));
    signature.parameters = [new ParameterInformation(parameterLabel, new MarkdownString("кого"))];
    const result = new SignatureHelp();
    result.signatures = [signature];
    result.activeSignature = 0;
    result.activeParameter = 0;
    return result as unknown as vscode.SignatureHelp;
}

describe("LanguagesNamespace — registerSignatureHelpProvider", () => {
    const provider = { provideSignatureHelp: () => null };
    const registrations = (stub: { notifies: { method: string; params: unknown }[] }): unknown[] =>
        stub.notifies.filter((n) => n.method === "languages.register").map((n) => n.params);

    it("регистрация объявляется ядру с handle, селектором и символами; dispose — снимает один раз", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);

        const registration = languages.registerSignatureHelpProvider({ language: "typescript" }, provider);
        expect(registrations(stub)).toEqual([
            {
                handle: 0,
                kind: "signatureHelp",
                selector: [{ language: "typescript" }],
                triggerCharacters: [],
                retriggerCharacters: [],
            },
        ]);

        registration.dispose();
        registration.dispose();
        expect(stub.notifies.filter((n) => n.method === "languages.unregister")).toEqual([
            { method: "languages.unregister", params: { handle: 0 } },
        ]);
    });

    it("метаданные сервера (обе перегрузки) едут с регистрацией своего провайдера", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);

        // Форма клиента при `retriggerCharacters` в capability сервера.
        languages.registerSignatureHelpProvider({ language: "typescript" }, provider, {
            triggerCharacters: ["(", ",", "<"],
            retriggerCharacters: [")"],
        });
        // Вторая перегрузка — rest-строками; символы НЕ объединяются по
        // регистрациям: у каждого провайдера свои.
        languages.registerSignatureHelpProvider({ language: "python" }, provider, "(", "[");

        expect(registrations(stub)).toMatchObject([
            { handle: 0, triggerCharacters: ["(", ",", "<"], retriggerCharacters: [")"] },
            { handle: 1, triggerCharacters: ["(", "["], retriggerCharacters: [] },
        ]);
    });

    it("мусор вместо метаданных не роняет регистрацию", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);

        languages.registerSignatureHelpProvider({ language: "typescript" }, provider, {
            triggerCharacters: "(" as unknown as string[],
            retriggerCharacters: [")", 7 as unknown as string],
        });

        expect(registrations(stub)).toMatchObject([{ triggerCharacters: [], retriggerCharacters: [")"] }]);
    });

    it("updateSubscriptions подсказку параметров больше не несёт", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);

        languages.registerSignatureHelpProvider({ language: "typescript" }, provider, "(");

        expect(stub.notifies.filter((n) => n.method === "languages.updateSubscriptions")).toEqual([]);
    });
});

describe("LanguagesNamespace — languages.provideSignatureHelp", () => {
    it("кладёт снапшот в реестр и зовёт провайдер с позицией и LSP-контекстом", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { doc?: vscode.TextDocument; pos?: vscode.Position; ctx?: vscode.SignatureHelpContext } = {};
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: (document, position, _token, context) => {
                    seen.doc = document;
                    seen.pos = position;
                    seen.ctx = context;
                    return help("greet(name: string): void");
                },
            },
        );

        const result = await stub.callRequest("languages.provideSignatureHelp", requestParams());

        expect(seen.doc?.getText()).toBe("greet(\n");
        expect(seen.doc?.languageId).toBe("typescript");
        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(6);
        expect(seen.ctx).toEqual({
            triggerKind: CoreTriggerKind.TriggerCharacter,
            triggerCharacter: "(",
            isRetrigger: false,
            activeSignatureHelp: undefined,
        });
        expect(ctx.registry.get(Uri.parse(URI))?.getText()).toBe("greet(\n");
        // MarkdownString провайдера уезжает сырым markdown — стрипает его UI.
        expect(result).toEqual({
            signatures: [
                {
                    label: "greet(name: string): void",
                    documentation: "Здоровается.",
                    parameters: [{ label: "name: string", documentation: "кого" }],
                },
            ],
            activeSignature: 0,
            activeParameter: 0,
        });
    });

    it("эхо показанной подсказки и ретриггер доезжают до провайдера", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: vscode.SignatureHelpContext[] = [];
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: (_doc, _pos, _token, context) => {
                    seen.push(context);
                    return null;
                },
            },
        );

        const active = {
            signatures: [{ label: "greet(): void", parameters: [] }],
            activeSignature: 0,
            activeParameter: 0,
        };
        await stub.callRequest(
            "languages.provideSignatureHelp",
            requestParams({ isRetrigger: true, activeSignatureHelp: active, triggerCharacter: "," }),
        );

        expect(seen[0]).toMatchObject({ isRetrigger: true, triggerCharacter: "," });
        expect(seen[0].activeSignatureHelp).toEqual(active);
    });

    it("контекст без полей: Invoke по умолчанию, isRetrigger — false", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: vscode.SignatureHelpContext[] = [];
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: (_doc, _pos, _token, context) => {
                    seen.push(context);
                    return null;
                },
            },
        );

        await stub.callRequest(
            "languages.provideSignatureHelp",
            requestParams({ triggerKind: undefined, triggerCharacter: undefined, isRetrigger: "да" }),
        );

        expect(seen[0]).toMatchObject({ triggerKind: CoreTriggerKind.Invoke, isRetrigger: false });
        expect(seen[0].triggerCharacter).toBeUndefined();
    });

    it("зовётся ровно провайдер запрошенного handle; сбойный и пустые — null", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const asked: string[] = [];
        const ask = (handle: number) => stub.callRequest("languages.provideSignatureHelp", requestParams({ handle }));

        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () => {
                    asked.push("throws");
                    throw new Error("boom");
                },
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () => {
                    asked.push("null");
                    return null;
                },
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () => {
                    asked.push("empty");
                    const empty = new SignatureHelp();
                    return empty as unknown as vscode.SignatureHelp;
                },
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () => {
                    asked.push("winner");
                    return help("greet(name: string): void");
                },
            },
        );

        const result = await ask(3);
        expect(asked).toEqual(["winner"]);
        expect((result as { signatures: { label: string }[] }).signatures[0].label).toBe("greet(name: string): void");

        expect(await ask(0)).toBeNull();
        expect(await ask(1)).toBeNull();
        expect(await ask(2)).toBeNull();
        expect(asked).toEqual(["winner", "throws", "null", "empty"]);
    });

    it("асинхронный провайдер и отказ промиса", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            { provideSignatureHelp: () => Promise.reject(new Error("boom")) },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            { provideSignatureHelp: () => Promise.resolve(help("greet(name: string): void")) },
        );

        expect(await stub.callRequest("languages.provideSignatureHelp", requestParams())).toBeNull();
        const result = await stub.callRequest("languages.provideSignatureHelp", requestParams({ handle: 1 }));

        expect((result as { signatures: { label: string }[] }).signatures[0].label).toBe("greet(name: string): void");
    });

    it("битая форма от провайдера отбраковывается целиком", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({
                        signatures: [{ label: 42 }],
                        activeSignature: 0,
                        activeParameter: 0,
                    }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () => ({ signatures: "нет" }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({
                        signatures: [{ label: "f(a)", parameters: [{ label: null }] }],
                    }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () => ({ signatures: [42] }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () => ({ signatures: [null] }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({ signatures: [{ label: "f(a)", parameters: 42 }] }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({
                        signatures: [{ label: "f(a)", parameters: [{ label: [1, 2, 3] }] }],
                    }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({
                        signatures: [{ label: "f(a)", parameters: [{ label: ["x", 1] }] }],
                    }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({ signatures: [{ label: "f(a)", parameters: "нет" }] }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({ signatures: [{ label: "f(a)", parameters: [null] }] }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({
                        signatures: [{ label: "f(a)", parameters: [{ label: [1, "x"] }] }],
                    }) as unknown as vscode.SignatureHelp,
            },
        );
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            { provideSignatureHelp: () => help("greet(name: string): void") },
        );

        // Каждая битая форма — «подсказки нет», целая — доезжает.
        for (let handle = 0; handle < 11; handle++) {
            expect(await stub.callRequest("languages.provideSignatureHelp", requestParams({ handle }))).toBeNull();
        }
        const result = await stub.callRequest("languages.provideSignatureHelp", requestParams({ handle: 11 }));

        expect((result as { signatures: { label: string }[] }).signatures[0].label).toBe("greet(name: string): void");
    });

    it("минимальная форма провайдера: без параметров, без документации, без индексов", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({ signatures: [{ label: "now(): Date" }] }) as unknown as vscode.SignatureHelp,
            },
        );

        const result = (await stub.callRequest("languages.provideSignatureHelp", requestParams())) as {
            signatures: Record<string, unknown>[];
        };

        expect(result).toEqual({
            signatures: [{ label: "now(): Date", parameters: [] }],
            activeSignature: 0,
            activeParameter: 0,
        });
        // Ключей `documentation`/`activeParameter` в проводе быть не должно вовсе:
        // `{ documentation: undefined }` — это лишний байт на каждом ответе.
        expect(Object.keys(result.signatures[0]).sort()).toEqual(["label", "parameters"]);
    });

    it("параметр без документации доезжает голой меткой", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({
                        signatures: [{ label: "greet(name)", parameters: [{ label: "name" }] }],
                        activeSignature: "нет",
                        activeParameter: null,
                    }) as unknown as vscode.SignatureHelp,
            },
        );

        const result = await stub.callRequest("languages.provideSignatureHelp", requestParams());

        expect(result).toEqual({
            signatures: [{ label: "greet(name)", parameters: [{ label: "name" }] }],
            // Нечисловые индексы приводятся к нулю ещё в сериализаторе.
            activeSignature: 0,
            activeParameter: 0,
        });
        const parameter = (result as { signatures: { parameters: Record<string, unknown>[] }[] }).signatures[0]
            .parameters[0];
        expect(Object.keys(parameter)).toEqual(["label"]);
    });

    it("выбранная сервером перегрузка доезжает как есть", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () =>
                    ({
                        signatures: [{ label: "f(a)" }, { label: "f(a, b)" }],
                        activeSignature: 1,
                        activeParameter: 1,
                    }) as unknown as vscode.SignatureHelp,
            },
        );

        const result = (await stub.callRequest("languages.provideSignatureHelp", requestParams())) as {
            activeSignature: number;
            activeParameter: number;
        };

        expect(result.activeSignature).toBe(1);
        expect(result.activeParameter).toBe(1);
    });

    it("метка параметра парой офсетов и активные индексы сериализуются как есть", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerSignatureHelpProvider(
            { language: "typescript" },
            {
                provideSignatureHelp: () => {
                    const value = help("greet(name: string): void", [6, 18]);
                    (value as unknown as { activeSignature: number }).activeSignature = 0;
                    (value as unknown as { activeParameter: number }).activeParameter = -1;
                    value.signatures[0].activeParameter = 1;
                    return value;
                },
            },
        );

        const result = (await stub.callRequest("languages.provideSignatureHelp", requestParams())) as {
            signatures: { parameters: { label: unknown }[]; activeParameter?: number }[];
            activeParameter: number;
        };

        expect(result.signatures[0].parameters[0].label).toEqual([6, 18]);
        expect(result.signatures[0].activeParameter).toBe(1);
        expect(result.activeParameter).toBe(-1);
    });

    it("параметры без полей: документ пустой, позиция — начало файла", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { doc?: vscode.TextDocument; pos?: vscode.Position } = {};
        // Селектор «любой язык»: без `languageId` документ заводится на дефолтном.
        languages.registerSignatureHelpProvider("*", {
            provideSignatureHelp: (document, position) => {
                seen.doc = document;
                seen.pos = position;
                return null;
            },
        });

        await stub.callRequest("languages.provideSignatureHelp", {
            handle: 0,
            uri: URI,
            triggerKind: CoreTriggerKind.Invoke,
            isRetrigger: false,
        });

        expect(seen.doc?.getText()).toBe("");
        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(0);
    });

    it("неизвестный и отсутствующий handle — подсказки нет, никого не зовём, документ не синхронизируем", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        let asked = false;
        const provider: vscode.SignatureHelpProvider = {
            provideSignatureHelp: () => {
                asked = true;
                return help("greet()");
            },
        };
        languages.registerSignatureHelpProvider({ language: "typescript" }, provider);
        languages.registerSignatureHelpProvider({ language: "typescript" }, provider);

        const stale = "file:///proj/stale.ts";
        expect(
            await stub.callRequest("languages.provideSignatureHelp", requestParams({ handle: 5, uri: stale })),
        ).toBeNull();
        expect(ctx.registry.get(Uri.parse(stale))).toBeUndefined();
        expect(
            await stub.callRequest("languages.provideSignatureHelp", requestParams({ handle: undefined })),
        ).toBeNull();
        expect(asked).toBe(false);
    });
});
