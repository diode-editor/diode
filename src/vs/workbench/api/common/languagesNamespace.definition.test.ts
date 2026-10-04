import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

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
        disk: createNodeExtHostDisk(),
    };
    return { ctx, stub };
}

const URI = "file:///proj/main.ts";
const DEFS = Uri.file("/proj/defs.ts");

const TEXT = "const a = b;\n";

/** Открывает документ в зеркале субпроцесса — как `editor.didOpen` хоста. */
function openDoc(ctx: IVscodeHostContext, text = TEXT, languageId = "typescript"): void {
    ctx.documentSync.open({ uri: URI, languageId, version: 1, text });
}

function requestParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        handle: 0,
        uri: URI,
        languageId: "typescript",
        version: 1,
        line: 0,
        character: 10,
        ...overrides,
    };
}

describe("LanguagesNamespace — registerDefinitionProvider", () => {
    it("регистрация объявляется ядру с handle и селектором, dispose — снимает (один раз)", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const sent = () => stub.notifies.filter((n) => n.method.startsWith("languages."));

        const registration = languages.registerDefinitionProvider(
            { language: "typescript" },
            { provideDefinition: () => null },
        );
        expect(sent()).toEqual([
            {
                method: "languages.register",
                params: { handle: 0, kind: "definition", selector: [{ language: "typescript" }] },
            },
        ]);

        registration.dispose();
        registration.dispose();
        expect(sent().slice(1)).toEqual([{ method: "languages.unregister", params: { handle: 0 } }]);
    });
});

describe("LanguagesNamespace — languages.provideDefinition", () => {
    it("документ — из зеркала по версии запроса, провайдер зовётся с позицией каретки", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { doc?: vscode.TextDocument; pos?: vscode.Position } = {};
        languages.registerDefinitionProvider(
            { language: "typescript" },
            {
                provideDefinition: (document, position) => {
                    seen.doc = document;
                    seen.pos = position;
                    return new Location(
                        DEFS as unknown as vscode.Uri,
                        new Range(2, 4, 2, 9),
                    ) as unknown as vscode.Location;
                },
            },
        );

        openDoc(ctx);
        const result = await stub.callRequest("languages.provideDefinition", requestParams());

        expect(seen.doc).toBe(ctx.registry.get(Uri.parse(URI)));
        expect(seen.doc?.getText()).toBe("const a = b;\n");
        expect(seen.doc?.languageId).toBe("typescript");
        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(10);
        expect(ctx.registry.get(Uri.parse(URI))?.getText()).toBe("const a = b;\n");
        expect(result).toEqual([
            { uri: DEFS.toString(), range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } } },
        ]);
    });

    it("Location[] сериализуется целиком; позиция без line/character — (0,0), язык зеркала не затирается", async () => {
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

        openDoc(ctx, "", "markdown");
        const result = await stub.callRequest("languages.provideDefinition", { handle: 0, uri: URI, version: 1 });

        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(0);
        // languageId в запросе не пришёл — язык документа остаётся от didOpen.
        expect(ctx.registry.get(Uri.parse(URI))?.languageId).toBe("markdown");
        // Position в конструкторе Location свёрнут в пустой Range.
        expect(result).toEqual([
            { uri: DEFS.toString(), range: { start: { line: 1, character: 2 }, end: { line: 1, character: 2 } } },
            { uri: DEFS.toString(), range: { start: { line: 3, character: 0 }, end: { line: 3, character: 5 } } },
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

        openDoc(fresh.ctx);
        const result = await fresh.stub.callRequest("languages.provideDefinition", requestParams());

        expect(result).toEqual([
            { uri: DEFS.toString(), range: { start: { line: 5, character: 9 }, end: { line: 5, character: 14 } } },
            { uri: DEFS.toString(), range: { start: { line: 10, character: 0 }, end: { line: 12, character: 1 } } },
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

        openDoc(ctx);
        const result = await stub.callRequest("languages.provideDefinition", requestParams());

        expect(result).toEqual([
            { uri: DEFS.toString(), range: { start: { line: 1, character: 1 }, end: { line: 1, character: 4 } } },
        ]);
    });

    it("зовётся ровно провайдер запрошенного handle; сбойный, пустой и неизвестный — []", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const calls: string[] = [];
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
                    return new Location(
                        DEFS as unknown as vscode.Uri,
                        new Range(0, 0, 0, 3),
                    ) as unknown as vscode.Location;
                },
            },
        );

        openDoc(ctx);
        const result = await stub.callRequest("languages.provideDefinition", requestParams({ handle: 2 }));
        expect(calls).toEqual(["ok"]);
        expect(result).toEqual([
            { uri: DEFS.toString(), range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } },
        ]);

        expect(await stub.callRequest("languages.provideDefinition", requestParams({ handle: 0 }))).toEqual([]);
        expect(await stub.callRequest("languages.provideDefinition", requestParams({ handle: 1 }))).toEqual([]);
        expect(calls).toEqual(["ok", "throwing", "empty"]);

        // Неизвестный и отсутствующий handle — никого не зовём и документ не синхронизируем.
        const stale = "file:///proj/stale.ts";
        expect(
            await stub.callRequest("languages.provideDefinition", requestParams({ handle: 42, uri: stale })),
        ).toEqual([]);
        expect(ctx.registry.get(Uri.parse(stale))).toBeUndefined();
        expect(await stub.callRequest("languages.provideDefinition", requestParams({ handle: undefined }))).toEqual([]);
        expect(calls).toHaveLength(3);
    });

    it("документ не открыт, запрос устарел или впереди зеркала — [], провайдер не зовётся", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        let calls = 0;
        languages.registerDefinitionProvider(
            { language: "typescript" },
            {
                provideDefinition: () => {
                    calls++;
                    return new Location(
                        DEFS as unknown as vscode.Uri,
                        new Range(0, 0, 0, 1),
                    ) as unknown as vscode.Location;
                },
            },
        );

        // Не открыт: хост ещё не прислал didOpen (или уже прислал didClose).
        expect(await stub.callRequest("languages.provideDefinition", requestParams())).toEqual([]);

        openDoc(ctx);
        ctx.documentSync.change({
            uri: URI,
            version: 2,
            changes: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "x" }],
        });
        // Устарел: ядро уже ушло на v2.
        expect(await stub.callRequest("languages.provideDefinition", requestParams({ version: 1 }))).toEqual([]);
        // Впереди зеркала: правки v3 ещё не доехали — нарушение порядка, в stderr.
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            expect(await stub.callRequest("languages.provideDefinition", requestParams({ version: 3 }))).toEqual([]);
            expect(warn).toHaveBeenCalledTimes(1);
        } finally {
            warn.mockRestore();
        }
        expect(calls).toBe(0);

        expect(await stub.callRequest("languages.provideDefinition", requestParams({ version: 2 }))).toHaveLength(1);
        expect(calls).toBe(1);
    });
});
