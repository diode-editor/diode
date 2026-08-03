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
const DEFS = Uri.file("/proj/defs.ts");

function requestParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { uri: URI, languageId: "typescript", text: "const a = b;\n", line: 0, character: 10, ...overrides };
}

describe("LanguagesNamespace — registerDefinitionProvider", () => {
    it("подписка сигналится на переходах 0↔1 (hasDefinitionProviders)", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const subs = () => stub.notifies.filter((n) => n.method === "languages.updateSubscriptions");

        const first = languages.registerDefinitionProvider({ language: "typescript" }, { provideDefinition: () => null });
        expect(subs()).toEqual([
            {
                method: "languages.updateSubscriptions",
                params: { hasCompletionProviders: false, hasFoldingProviders: false, hasDefinitionProviders: true },
            },
        ]);

        const second = languages.registerDefinitionProvider({ language: "typescript" }, { provideDefinition: () => null });
        expect(subs()).toHaveLength(1);

        first.dispose();
        expect(subs()).toHaveLength(1);
        second.dispose();
        expect(subs()).toHaveLength(2);
        expect(subs()[1].params).toEqual({
            hasCompletionProviders: false,
            hasFoldingProviders: false,
            hasDefinitionProviders: false,
        });
        // Повторный dispose — идемпотентен, без лишних нотификаций.
        second.dispose();
        expect(subs()).toHaveLength(2);
    });
});

describe("LanguagesNamespace — languages.provideDefinition", () => {
    it("кладёт снапшот документа в реестр и зовёт провайдер с позицией каретки", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { doc?: vscode.TextDocument; pos?: vscode.Position } = {};
        languages.registerDefinitionProvider(
            { language: "typescript" },
            {
                provideDefinition: (document, position) => {
                    seen.doc = document;
                    seen.pos = position;
                    return new Location(DEFS as unknown as vscode.Uri, new Range(2, 4, 2, 9)) as unknown as vscode.Location;
                },
            },
        );

        const result = await stub.callRequest("languages.provideDefinition", requestParams());

        expect(seen.doc?.getText()).toBe("const a = b;\n");
        expect(seen.doc?.languageId).toBe("typescript");
        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(10);
        expect(ctx.registry.get(Uri.parse(URI))?.getText()).toBe("const a = b;\n");
        expect(result).toEqual([
            { uri: DEFS.toString(), range: { startLine: 2, startCharacter: 4, endLine: 2, endCharacter: 9 } },
        ]);
    });

    it("Location[] сериализуется целиком; позиция без line/character — (0,0), текст — пустой", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { pos?: vscode.Position } = {};
        languages.registerDefinitionProvider(
            { language: "plaintext" },
            {
                provideDefinition: (_doc, position) => {
                    seen.pos = position;
                    return [
                        new Location(DEFS as unknown as vscode.Uri, new Position(1, 2) as unknown as vscode.Position),
                        new Location(DEFS as unknown as vscode.Uri, new Range(3, 0, 3, 5)),
                    ] as unknown as vscode.Location[];
                },
            },
        );

        const result = await stub.callRequest("languages.provideDefinition", { uri: URI });

        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(0);
        expect(ctx.registry.get(Uri.parse(URI))?.getText()).toBe("");
        // Position в конструкторе Location свёрнут в пустой Range.
        expect(result).toEqual([
            { uri: DEFS.toString(), range: { startLine: 1, startCharacter: 2, endLine: 1, endCharacter: 2 } },
            { uri: DEFS.toString(), range: { startLine: 3, startCharacter: 0, endLine: 3, endCharacter: 5 } },
        ]);
    });

    it("LocationLink: targetSelectionRange побеждает targetRange; без него — targetRange", async () => {
        const fresh = makeCtx();
        const ns = createLanguagesNamespace(fresh.ctx);
        ns.languages.registerDefinitionProvider(
            { language: "typescript" },
            {
                provideDefinition: () =>
                    [
                        {
                            targetUri: DEFS as unknown as vscode.Uri,
                            targetRange: new Range(5, 0, 8, 1) as unknown as vscode.Range,
                            targetSelectionRange: new Range(5, 9, 5, 14) as unknown as vscode.Range,
                        },
                        {
                            targetUri: DEFS as unknown as vscode.Uri,
                            targetRange: new Range(10, 0, 12, 1) as unknown as vscode.Range,
                        },
                    ] as vscode.DefinitionLink[],
            },
        );

        const result = await fresh.stub.callRequest("languages.provideDefinition", requestParams());

        expect(result).toEqual([
            { uri: DEFS.toString(), range: { startLine: 5, startCharacter: 9, endLine: 5, endCharacter: 14 } },
            { uri: DEFS.toString(), range: { startLine: 10, startCharacter: 0, endLine: 12, endCharacter: 1 } },
        ]);
    });

    it("невалидные элементы результата отбрасываются, не роняя ответ", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerDefinitionProvider(
            { language: "typescript" },
            {
                provideDefinition: () =>
                    [
                        null,
                        "junk",
                        {}, // ни uri, ни targetUri
                        { uri: DEFS }, // нет range
                        { uri: DEFS, range: { start: null, end: null } },
                        { uri: DEFS, range: { start: { line: "x", character: 0 }, end: { line: 0, character: 0 } } },
                        { targetUri: DEFS, targetRange: "junk" },
                        new Location(DEFS as unknown as vscode.Uri, new Range(1, 1, 1, 4)),
                    ] as unknown as vscode.Location[],
            },
        );

        const result = await stub.callRequest("languages.provideDefinition", requestParams());

        expect(result).toEqual([
            { uri: DEFS.toString(), range: { startLine: 1, startCharacter: 1, endLine: 1, endCharacter: 4 } },
        ]);
    });

    it("сбойный/пустой провайдер и несовпавший селектор пропускаются", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const calls: string[] = [];
        languages.registerDefinitionProvider(
            { language: "python" },
            {
                provideDefinition: () => {
                    calls.push("python");
                    return null;
                },
            },
        );
        languages.registerDefinitionProvider(
            { language: "typescript" },
            {
                provideDefinition: () => {
                    calls.push("throwing");
                    throw new Error("boom");
                },
            },
        );
        languages.registerDefinitionProvider(
            { language: "typescript" },
            {
                provideDefinition: () => {
                    calls.push("empty");
                    return null;
                },
            },
        );
        languages.registerDefinitionProvider(
            { language: "typescript" },
            {
                provideDefinition: () => {
                    calls.push("ok");
                    return new Location(DEFS as unknown as vscode.Uri, new Range(0, 0, 0, 3)) as unknown as vscode.Location;
                },
            },
        );

        const result = await stub.callRequest("languages.provideDefinition", requestParams());

        expect(calls).toEqual(["throwing", "empty", "ok"]);
        expect(result).toEqual([
            { uri: DEFS.toString(), range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 3 } },
        ]);
    });
});
