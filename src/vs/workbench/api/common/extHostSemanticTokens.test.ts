import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { CancellationTokenNone } from "../../../base/common/cancellation.ts";

import { DocumentRangeSemanticTokensAdapter, DocumentSemanticTokensAdapter } from "./extHostSemanticTokens.ts";
import { Range, SemanticTokens, SemanticTokensEdit, SemanticTokensEdits } from "./vscodeTypes.ts";

const DOC = {} as vscode.TextDocument;
const TOKEN = CancellationTokenNone as unknown as vscode.CancellationToken;

function tokens(data: number[], resultId?: string): SemanticTokens {
    return new SemanticTokens(new Uint32Array(data), resultId);
}

/** Провайдер, отдающий ответы по очереди; запоминает аргументы вызовов. */
function sequence(results: unknown[], withEdits?: unknown[]) {
    const full = vi.fn(() => results.shift());
    const edits = vi.fn((_doc: unknown, _previousResultId: string) => withEdits?.shift());
    const provider = {
        provideDocumentSemanticTokens: full,
        ...(withEdits === undefined ? {} : { provideDocumentSemanticTokensEdits: edits }),
    } as unknown as vscode.DocumentSemanticTokensProvider;
    return { provider, full, edits };
}

describe("DocumentSemanticTokensAdapter", () => {
    it("полный ответ: id растёт с каждым ответом, данные — массивом чисел", async () => {
        const { provider } = sequence([tokens([0, 1, 2, 3, 4]), tokens([5, 6, 7, 8, 9])]);
        const adapter = new DocumentSemanticTokensAdapter(provider);
        expect(await adapter.provideDocumentSemanticTokens(DOC, 0, TOKEN)).toEqual({
            id: 1,
            type: "full",
            data: [0, 1, 2, 3, 4],
        });
        // Неизвестный id прошлого ответа — как «прошлого нет».
        expect(await adapter.provideDocumentSemanticTokens(DOC, 99, TOKEN)).toEqual({
            id: 2,
            type: "full",
            data: [5, 6, 7, 8, 9],
        });
    });

    it("прошлый ответ со строковым resultId и метод Edits → provideDocumentSemanticTokensEdits", async () => {
        const { provider, full, edits } = sequence(
            [tokens([1, 1, 1, 1, 1], "a")],
            [new SemanticTokensEdits([new SemanticTokensEdit(0, 5, new Uint32Array([2]))], "b")],
        );
        const adapter = new DocumentSemanticTokensAdapter(provider);
        await adapter.provideDocumentSemanticTokens(DOC, 0, TOKEN);
        expect(await adapter.provideDocumentSemanticTokens(DOC, 1, TOKEN)).toEqual({
            id: 2,
            type: "delta",
            deltas: [{ start: 0, deleteCount: 5, data: [2] }],
        });
        expect(full).toHaveBeenCalledTimes(1);
        expect(edits.mock.calls[0][1]).toBe("a");
    });

    it("прошлый ответ без resultId — снова полный запрос, хоть метод Edits и есть", async () => {
        const { provider, full, edits } = sequence([tokens([1, 1, 1, 1, 1]), tokens([1, 1, 1, 1, 1])], []);
        const adapter = new DocumentSemanticTokensAdapter(provider);
        await adapter.provideDocumentSemanticTokens(DOC, 0, TOKEN);
        await adapter.provideDocumentSemanticTokens(DOC, 1, TOKEN);
        expect(full).toHaveBeenCalledTimes(2);
        expect(edits).not.toHaveBeenCalled();
    });

    it("без метода Edits полный ответ превращается в дельту prefix/suffix", async () => {
        const { provider } = sequence([
            tokens([1, 2, 3, 4, 5, 6, 7], "a"),
            tokens([1, 2, 9, 9, 9, 6, 7], "b"),
            tokens([1, 2, 9, 9, 9, 6, 7]),
            tokens([1, 2, 9, 7]),
            tokens([1, 2, 9, 7, 7, 7]),
        ]);
        const adapter = new DocumentSemanticTokensAdapter(provider);
        await adapter.provideDocumentSemanticTokens(DOC, 0, TOKEN);
        expect(await adapter.provideDocumentSemanticTokens(DOC, 1, TOKEN)).toEqual({
            id: 2,
            type: "delta",
            deltas: [{ start: 2, deleteCount: 3, data: [9, 9, 9] }],
        });
        // Полное совпадение — пустая дельта.
        expect(await adapter.provideDocumentSemanticTokens(DOC, 2, TOKEN)).toEqual({
            id: 3,
            type: "delta",
            deltas: [],
        });
        // Укоротилось: суффикс ограничен остатком после префикса.
        expect(await adapter.provideDocumentSemanticTokens(DOC, 3, TOKEN)).toEqual({
            id: 4,
            type: "delta",
            deltas: [{ start: 3, deleteCount: 3, data: [] }],
        });
        // Удлинилось.
        expect(await adapter.provideDocumentSemanticTokens(DOC, 4, TOKEN)).toEqual({
            id: 5,
            type: "delta",
            deltas: [{ start: 4, deleteCount: 0, data: [7, 7] }],
        });
    });

    it("правки от провайдера: хранится только resultId — следующий полный ответ уже не дифается", async () => {
        const { provider } = sequence(
            [tokens([1, 1, 1, 1, 1], "a"), tokens([1, 1, 1, 1, 1], "c")],
            [new SemanticTokensEdits([new SemanticTokensEdit(0, 0)], "b"), undefined],
        );
        const adapter = new DocumentSemanticTokensAdapter(provider);
        await adapter.provideDocumentSemanticTokens(DOC, 0, TOKEN);
        expect(await adapter.provideDocumentSemanticTokens(DOC, 1, TOKEN)).toEqual({
            id: 2,
            type: "delta",
            deltas: [{ start: 0, deleteCount: 0 }],
        });
        // Edits-метод вернул пусто — null; запись id 2 при этом использована.
        expect(await adapter.provideDocumentSemanticTokens(DOC, 2, TOKEN)).toBeNull();
    });

    it("после правок от провайдера полный ответ уходит полным (данных для дифа нет)", async () => {
        const edits = vi
            .fn()
            .mockReturnValueOnce(new SemanticTokensEdits([], "b"))
            .mockReturnValueOnce(tokens([7, 7, 7, 7, 7], "c"));
        const provider = {
            provideDocumentSemanticTokens: () => tokens([1, 1, 1, 1, 1], "a"),
            provideDocumentSemanticTokensEdits: edits,
        } as unknown as vscode.DocumentSemanticTokensProvider;
        const adapter = new DocumentSemanticTokensAdapter(provider);
        await adapter.provideDocumentSemanticTokens(DOC, 0, TOKEN);
        await adapter.provideDocumentSemanticTokens(DOC, 1, TOKEN);
        expect(await adapter.provideDocumentSemanticTokens(DOC, 2, TOKEN)).toEqual({
            id: 3,
            type: "full",
            data: [7, 7, 7, 7, 7],
        });
    });

    it("дельта от полного ответа хранит его данные — следующий диф считается от них", async () => {
        const { provider } = sequence([tokens([1, 2, 3], "a"), tokens([1, 5, 3], "b"), tokens([1, 5, 6], "c")]);
        const adapter = new DocumentSemanticTokensAdapter(provider);
        await adapter.provideDocumentSemanticTokens(DOC, 0, TOKEN);
        await adapter.provideDocumentSemanticTokens(DOC, 1, TOKEN);
        expect(await adapter.provideDocumentSemanticTokens(DOC, 2, TOKEN)).toEqual({
            id: 3,
            type: "delta",
            deltas: [{ start: 2, deleteCount: 1, data: [6] }],
        });
    });

    it("данные обычными массивами принимаются — и в полном ответе, и в правках", async () => {
        const { provider } = sequence(
            [{ resultId: "a", data: [3, 4, 5, 6, 7] }],
            [
                {
                    resultId: "b",
                    edits: [
                        { start: 0, deleteCount: 1, data: [8] },
                        { start: 2, deleteCount: 1 },
                    ],
                },
            ],
        );
        const adapter = new DocumentSemanticTokensAdapter(provider);
        expect(await adapter.provideDocumentSemanticTokens(DOC, 0, TOKEN)).toEqual({
            id: 1,
            type: "full",
            data: [3, 4, 5, 6, 7],
        });
        expect(await adapter.provideDocumentSemanticTokens(DOC, 1, TOKEN)).toEqual({
            id: 2,
            type: "delta",
            deltas: [
                { start: 0, deleteCount: 1, data: [8] },
                { start: 2, deleteCount: 1 },
            ],
        });
    });

    it("пустой ответ и чужая форма — null", async () => {
        const { provider } = sequence([null, undefined, { foo: 1 }, "x", { data: null }]);
        const adapter = new DocumentSemanticTokensAdapter(provider);
        for (let i = 0; i < 5; i++) {
            expect(await adapter.provideDocumentSemanticTokens(DOC, 0, TOKEN)).toBeNull();
        }
    });

    it("использованный id забывается: повторный запрос с ним — полный", async () => {
        const { provider, edits } = sequence([tokens([1], "a"), tokens([2], "c")], [new SemanticTokensEdits([], "b")]);
        const adapter = new DocumentSemanticTokensAdapter(provider);
        await adapter.provideDocumentSemanticTokens(DOC, 0, TOKEN);
        await adapter.provideDocumentSemanticTokens(DOC, 1, TOKEN);
        expect(await adapter.provideDocumentSemanticTokens(DOC, 1, TOKEN)).toEqual({ id: 3, type: "full", data: [2] });
        expect(edits).toHaveBeenCalledTimes(1);
    });

    it("release забывает ответ: дельта к нему больше не считается", async () => {
        const { provider } = sequence([tokens([1, 2], "a"), tokens([1, 3], "b")]);
        const adapter = new DocumentSemanticTokensAdapter(provider);
        await adapter.provideDocumentSemanticTokens(DOC, 0, TOKEN);
        adapter.releaseDocumentSemanticColoring(1);
        expect(await adapter.provideDocumentSemanticTokens(DOC, 1, TOKEN)).toEqual({
            id: 2,
            type: "full",
            data: [1, 3],
        });
    });
});

describe("DocumentRangeSemanticTokensAdapter", () => {
    it("ответ всегда полный с id 0; диапазон доезжает до провайдера", async () => {
        const provide = vi.fn((_doc: unknown, _range: unknown) => tokens([0, 1, 2, 3, 4], "x"));
        const adapter = new DocumentRangeSemanticTokensAdapter({
            provideDocumentRangeSemanticTokens: provide,
        } as unknown as vscode.DocumentRangeSemanticTokensProvider);
        const range = new Range(1, 0, 3, 5);
        expect(await adapter.provideDocumentRangeSemanticTokens(DOC, range, TOKEN)).toEqual({
            id: 0,
            type: "full",
            data: [0, 1, 2, 3, 4],
        });
        expect(provide.mock.calls[0][1]).toBe(range);
    });

    it("массив чисел принимается; пусто и чужая форма — null", async () => {
        const results: unknown[] = [{ data: [9, 9] }, null, { edits: [] }];
        const adapter = new DocumentRangeSemanticTokensAdapter({
            provideDocumentRangeSemanticTokens: () => results.shift(),
        } as unknown as vscode.DocumentRangeSemanticTokensProvider);
        const range = new Range(0, 0, 0, 1);
        expect(await adapter.provideDocumentRangeSemanticTokens(DOC, range, TOKEN)).toEqual({
            id: 0,
            type: "full",
            data: [9, 9],
        });
        expect(await adapter.provideDocumentRangeSemanticTokens(DOC, range, TOKEN)).toBeNull();
        expect(await adapter.provideDocumentRangeSemanticTokens(DOC, range, TOKEN)).toBeNull();
    });
});
