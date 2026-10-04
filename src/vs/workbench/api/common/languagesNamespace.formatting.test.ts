import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { Range, TextEdit, Uri } from "./vscodeTypes.ts";
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

function requestParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        handle: 0,
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
    it("оба вида объявляются ядру своим kind; dispose снимает один раз", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);

        const doc = languages.registerDocumentFormattingEditProvider({ language: "typescript" }, oneEditProvider());
        const range = languages.registerDocumentRangeFormattingEditProvider({ language: "python" }, {
            provideDocumentRangeFormattingEdits: () => [],
        } as unknown as vscode.DocumentRangeFormattingEditProvider);
        expect(stub.notifies.filter((n) => n.method === "languages.register").map((n) => n.params)).toEqual([
            { handle: 0, kind: "formatting", selector: [{ language: "typescript" }] },
            { handle: 1, kind: "rangeFormatting", selector: [{ language: "python" }] },
        ]);

        doc.dispose();
        range.dispose();
        doc.dispose();
        expect(stub.notifies.filter((n) => n.method === "languages.unregister").map((n) => n.params)).toEqual([
            { handle: 0 },
            { handle: 1 },
        ]);
        expect(stub.notifies.filter((n) => n.method === "languages.updateSubscriptions")).toEqual([]);
    });

    it("документный запрос: правки провайдера запрошенного handle сериализуются, options доезжают", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { languageId: string; text: string; options: vscode.FormattingOptions }[] = [];
        languages.registerDocumentFormattingEditProvider({ language: "typescript" }, {
            provideDocumentFormattingEdits: (doc: vscode.TextDocument, options: vscode.FormattingOptions) => {
                seen.push({ languageId: doc.languageId, text: doc.getText(), options });
                return [new TextEdit(new Range(0, 5, 0, 7), " ")];
            },
        } as unknown as vscode.DocumentFormattingEditProvider);
        // Второй (handle 1) не запрошен — и не спрошен.
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

    it("неизвестный handle и handle другого вида — пустой ответ, провайдер не зовётся", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const provide = vi.fn(() => [new TextEdit(new Range(0, 5, 0, 7), " ")]);
        const documentProvider = {
            provideDocumentFormattingEdits: provide,
        } as unknown as vscode.DocumentFormattingEditProvider;
        languages.registerDocumentFormattingEditProvider({ language: "typescript" }, documentProvider); // 0
        languages.registerDocumentFormattingEditProvider({ language: "typescript" }, documentProvider); // 1
        languages.registerDocumentRangeFormattingEditProvider({ language: "typescript" }, {
            provideDocumentRangeFormattingEdits: provide,
        } as unknown as vscode.DocumentRangeFormattingEditProvider); // 2
        const selection = { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 5 };

        // Снятый handle и handle чужого вида не будят и синхронизацию документа.
        const stale = "file:///proj/stale.ts";
        for (const extra of [
            { handle: 7 },
            { handle: 7, range: selection },
            { handle: 2 }, // документный запрос к range-провайдеру
            { handle: 0, range: selection }, // range-запрос к документному
        ]) {
            expect(
                await stub.callRequest("languages.provideFormattingEdits", requestParams({ uri: stale, ...extra })),
            ).toEqual([]);
        }
        expect(ctx.registry.get(Uri.parse(stale))).toBeUndefined();

        // Ненулевой handle доходит до своего провайдера как есть.
        expect(await stub.callRequest("languages.provideFormattingEdits", requestParams({ handle: 1 }))).toHaveLength(
            1,
        );
        expect(provide).toHaveBeenCalledTimes(1);
        provide.mockClear();
        expect(
            await stub.callRequest("languages.provideFormattingEdits", requestParams({ handle: undefined })),
        ).toEqual([]);
        expect(provide).not.toHaveBeenCalled();
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
        expect(result).toEqual([
            { range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 5 }, text: "x" },
        ]);
        expect(ranges).toEqual([new Range(1, 2, 2, 4)]);
    });

    it("документный запрос к range-провайдеру — пустой ответ (синтетический формат строит ядро)", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const provide = vi.fn(() => []);
        languages.registerDocumentRangeFormattingEditProvider({ language: "typescript" }, {
            provideDocumentRangeFormattingEdits: provide,
        } as unknown as vscode.DocumentRangeFormattingEditProvider);

        expect(await stub.callRequest("languages.provideFormattingEdits", requestParams())).toEqual([]);
        expect(provide).not.toHaveBeenCalled();
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

    it("сбой провайдера пишется в stderr — иначе он неотличим от «менять нечего»", async () => {
        const errors: string[] = [];
        const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
            errors.push(args.map(String).join(" "));
        });
        try {
            const { ctx, stub } = makeCtx();
            const { languages } = createLanguagesNamespace(ctx);
            languages.registerDocumentFormattingEditProvider({ language: "typescript" }, {
                provideDocumentFormattingEdits: () => {
                    throw new Error("provider boom");
                },
            } as unknown as vscode.DocumentFormattingEditProvider);
            expect(await stub.callRequest("languages.provideFormattingEdits", requestParams())).toEqual([]);

            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain("provideDocumentFormattingEdits failed");
            expect(errors[0]).toContain("provider boom");
        } finally {
            spy.mockRestore();
        }
    });

    it("сбой range-провайдера пишется в stderr", async () => {
        const errors: string[] = [];
        const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
            errors.push(args.map(String).join(" "));
        });
        try {
            const { ctx, stub } = makeCtx();
            const { languages } = createLanguagesNamespace(ctx);
            languages.registerDocumentRangeFormattingEditProvider({ language: "typescript" }, {
                provideDocumentRangeFormattingEdits: () => {
                    throw new Error("range boom");
                },
            } as unknown as vscode.DocumentRangeFormattingEditProvider);
            // Полный диапазон за документный запрос ядро шлёт тем же range-запросом.
            await stub.callRequest(
                "languages.provideFormattingEdits",
                requestParams({ range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 5 } }),
            );

            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain("provideDocumentRangeFormattingEdits failed");
            expect(errors[0]).toContain("range boom");
        } finally {
            spy.mockRestore();
        }
    });

    it("сбойный range-провайдер — пустой ответ", async () => {
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

        expect(await stub.callRequest("languages.provideFormattingEdits", { handle: 0, uri: URI })).toEqual([]);
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
