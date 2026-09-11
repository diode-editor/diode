import type * as vscode from "vscode";

import { describe, expect, it, vi } from "vitest";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { Range, TextEdit } from "./vscodeTypes.ts";
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
        text: "const  a=1;\nconst b = 2;\n",
        tabSize: 2,
        insertSpaces: true,
        ...overrides,
    };
}

const WIRE_EDIT = { range: { startLine: 0, startCharacter: 5, endLine: 0, endCharacter: 7 }, text: " " };

/** Провайдер, отдающий один TextEdit (схлопнуть двойной пробел). */
function oneEditProvider(): vscode.DocumentFormattingEditProvider {
    return {
        provideDocumentFormattingEdits: () => [new TextEdit(new Range(0, 5, 0, 7), " ")],
    } as unknown as vscode.DocumentFormattingEditProvider;
}

describe("LanguagesNamespace — провайдеры форматирования", () => {
    it("подписка сигналится на переходах 0↔1, range-провайдер тоже считается", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const flags = (): unknown[] =>
            stub.notifies
                .filter((n) => n.method === "languages.updateSubscriptions")
                .map((n) => (n.params as { hasFormattingProviders?: unknown }).hasFormattingProviders);

        const doc = languages.registerDocumentFormattingEditProvider({ language: "typescript" }, oneEditProvider());
        expect(flags()).toEqual([true]);

        // Второй провайдер того же вида — сигнала нет (переход не 0↔1).
        const doc2 = languages.registerDocumentFormattingEditProvider({ language: "python" }, oneEditProvider());
        expect(flags()).toEqual([true]);
        doc2.dispose();
        expect(flags()).toEqual([true]);

        doc.dispose();
        expect(flags()).toEqual([true, false]);

        const range = languages.registerDocumentRangeFormattingEditProvider(
            { language: "typescript" },
            { provideDocumentRangeFormattingEdits: () => [] } as unknown as vscode.DocumentRangeFormattingEditProvider,
        );
        expect(flags()).toEqual([true, false, true]);
        const range2 = languages.registerDocumentRangeFormattingEditProvider(
            { language: "python" },
            { provideDocumentRangeFormattingEdits: () => [] } as unknown as vscode.DocumentRangeFormattingEditProvider,
        );
        expect(flags()).toEqual([true, false, true]);
        range2.dispose();
        expect(flags()).toEqual([true, false, true]);
        range.dispose();
        expect(flags()).toEqual([true, false, true, false]);

        // Повторный dispose — no-op, не портит счётчики и не шлёт сигналов.
        doc.dispose();
        range.dispose();
        expect(flags()).toEqual([true, false, true, false]);
    });

    it("документный запрос: правки первого матчащего провайдера сериализуются, options доезжают", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { languageId: string; text: string; options: vscode.FormattingOptions }[] = [];
        languages.registerDocumentFormattingEditProvider({ language: "typescript" }, {
            provideDocumentFormattingEdits: (doc: vscode.TextDocument, options: vscode.FormattingOptions) => {
                seen.push({ languageId: doc.languageId, text: doc.getText(), options });
                return [new TextEdit(new Range(0, 5, 0, 7), " ")];
            },
        } as unknown as vscode.DocumentFormattingEditProvider);
        // Второй матчащий — не должен быть спрошен (первый выиграл).
        const second = vi.fn(() => [new TextEdit(new Range(1, 0, 1, 0), "zzz")]);
        languages.registerDocumentFormattingEditProvider({ language: "typescript" }, {
            provideDocumentFormattingEdits: second,
        } as unknown as vscode.DocumentFormattingEditProvider);

        const result = await stub.callRequest("languages.provideFormattingEdits", requestParams());
        expect(result).toEqual([WIRE_EDIT]);
        expect(second).not.toHaveBeenCalled();
        expect(seen).toEqual([
            {
                languageId: "typescript",
                text: "const  a=1;\nconst b = 2;\n",
                options: { tabSize: 2, insertSpaces: true },
            },
        ]);
    });

    it("нет матчащего провайдера — null («нет форматтера»), не пустой массив", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerDocumentFormattingEditProvider({ language: "python" }, oneEditProvider());

        const result = await stub.callRequest("languages.provideFormattingEdits", requestParams());
        expect(result).toBeNull();

        // И для range-запроса без range-провайдеров — тоже null.
        const ranged = await stub.callRequest(
            "languages.provideFormattingEdits",
            requestParams({ range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 5 } }),
        );
        expect(ranged).toBeNull();
    });

    it("range-запрос уходит range-провайдеру с диапазоном как есть", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const ranges: vscode.Range[] = [];
        languages.registerDocumentRangeFormattingEditProvider({ language: "typescript" }, {
            provideDocumentRangeFormattingEdits: (doc: vscode.TextDocument, range: vscode.Range) => {
                ranges.push(range);
                return [new TextEdit(new Range(1, 0, 1, 5), "x")];
            },
        } as unknown as vscode.DocumentRangeFormattingEditProvider);

        const result = await stub.callRequest(
            "languages.provideFormattingEdits",
            requestParams({ range: { startLine: 1, startCharacter: 2, endLine: 2, endCharacter: 4 } }),
        );
        expect(result).toEqual([{ range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 5 }, text: "x" }]);
        expect(ranges).toEqual([new Range(1, 2, 2, 4)]);
    });

    it("документный запрос без документного провайдера падает на range-провайдер полным диапазоном", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const ranges: vscode.Range[] = [];
        languages.registerDocumentRangeFormattingEditProvider({ language: "typescript" }, {
            provideDocumentRangeFormattingEdits: (doc: vscode.TextDocument, range: vscode.Range) => {
                ranges.push(range);
                return [];
            },
        } as unknown as vscode.DocumentRangeFormattingEditProvider);

        const result = await stub.callRequest("languages.provideFormattingEdits", requestParams());
        expect(result).toEqual([]);
        // Полный диапазон: от (0,0) до конца последней строки (пустая строка после \n).
        expect(ranges).toEqual([new Range(0, 0, 2, 0)]);
    });

    it("сбойный или мусорный провайдер — пустой ответ (no-op), не «нет форматтера»", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerDocumentFormattingEditProvider({ language: "typescript" }, {
            provideDocumentFormattingEdits: () => {
                throw new Error("provider boom");
            },
        } as unknown as vscode.DocumentFormattingEditProvider);
        expect(await stub.callRequest("languages.provideFormattingEdits", requestParams())).toEqual([]);

        const { ctx: ctx2, stub: stub2 } = makeCtx();
        const { languages: languages2 } = createLanguagesNamespace(ctx2);
        languages2.registerDocumentFormattingEditProvider({ language: "typescript" }, {
            provideDocumentFormattingEdits: () => "junk" as unknown as vscode.TextEdit[],
        } as unknown as vscode.DocumentFormattingEditProvider);
        expect(await stub2.callRequest("languages.provideFormattingEdits", requestParams())).toEqual([]);

        // Невалидные элементы результата отбрасываются поштучно.
        const { ctx: ctx3, stub: stub3 } = makeCtx();
        const { languages: languages3 } = createLanguagesNamespace(ctx3);
        languages3.registerDocumentFormattingEditProvider({ language: "typescript" }, {
            provideDocumentFormattingEdits: () => [
                { newText: 42 } as unknown as vscode.TextEdit,
                new TextEdit(new Range(0, 5, 0, 7), " "),
            ],
        } as unknown as vscode.DocumentFormattingEditProvider);
        expect(await stub3.callRequest("languages.provideFormattingEdits", requestParams())).toEqual([WIRE_EDIT]);
    });

    it("сбойный range-провайдер — пустой ответ в обеих ветках (range и full-range fallback)", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerDocumentRangeFormattingEditProvider({ language: "typescript" }, {
            provideDocumentRangeFormattingEdits: () => {
                throw new Error("range boom");
            },
        } as unknown as vscode.DocumentRangeFormattingEditProvider);
        expect(
            await stub.callRequest(
                "languages.provideFormattingEdits",
                requestParams({ range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 5 } }),
            ),
        ).toEqual([]);
        expect(await stub.callRequest("languages.provideFormattingEdits", requestParams())).toEqual([]);
    });

    it("голые параметры (без languageId/text) — документ на дефолтном языке с пустым текстом", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const texts: string[] = [];
        languages.registerDocumentFormattingEditProvider({ language: "plaintext" }, {
            provideDocumentFormattingEdits: (doc: vscode.TextDocument) => {
                texts.push(doc.getText());
                return [];
            },
        } as unknown as vscode.DocumentFormattingEditProvider);

        expect(await stub.callRequest("languages.provideFormattingEdits", { uri: URI })).toEqual([]);
        expect(texts).toEqual([""]);
    });

    it("дефолты options: без tabSize/insertSpaces провайдер видит 4 и true", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: vscode.FormattingOptions[] = [];
        languages.registerDocumentFormattingEditProvider({ language: "typescript" }, {
            provideDocumentFormattingEdits: (doc: vscode.TextDocument, options: vscode.FormattingOptions) => {
                seen.push(options);
                return null;
            },
        } as unknown as vscode.DocumentFormattingEditProvider);

        await stub.callRequest(
            "languages.provideFormattingEdits",
            requestParams({ tabSize: undefined, insertSpaces: undefined }),
        );
        expect(seen).toEqual([{ tabSize: 4, insertSpaces: true }]);
    });
});
