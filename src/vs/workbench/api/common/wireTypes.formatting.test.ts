import { describe, expect, it, vi } from "vitest";

import { type IRequestOptions, TimeoutError } from "./rpcEndpoint.ts";
import { requestFormattingEdits } from "./wireTypes.ts";

// `requestFormattingEdits`: [] = менять нечего/таймаут/мусор, иначе — core-правки.
// «Нет форматтера» решает ядро по реестру, а не провод.

const WIRE_EDIT = { range: { startLine: 0, startCharacter: 5, endLine: 1, endCharacter: 2 }, text: "x" };

const PARAMS = { uri: "file:///a.ts", languageId: "typescript", text: "const a;\n", tabSize: 4, insertSpaces: true };

/**
 * Субпроцесс, который не отвечает, за транспортом, который держит срок, как
 * `RpcEndpoint.request`: по истечении `options.timeoutMs` — `TimeoutError`.
 */
function hanging(method: string, _params: unknown, options: IRequestOptions): Promise<unknown> {
    return new Promise((_resolve, reject) => {
        setTimeout(() => {
            reject(new TimeoutError(method, options.timeoutMs ?? 0));
        }, options.timeoutMs);
    });
}

describe("requestFormattingEdits", () => {
    it("валидный ответ конвертируется в core-правки, мусорные элементы отбрасываются", async () => {
        const result = await requestFormattingEdits(
            () => Promise.resolve([WIRE_EDIT, { range: null, text: "y" }, "junk"]),
            PARAMS,
            1000,
        );
        expect(result).toEqual([
            {
                range: { start: { line: 0, character: 5 }, end: { line: 1, character: 2 } },
                text: "x",
            },
        ]);
    });

    it("null от субпроцесса (старая форма «нет форматтера») — пустой список", async () => {
        expect(await requestFormattingEdits(() => Promise.resolve(null), PARAMS, 1000)).toEqual([]);
    });

    it("мусорный ответ — пустой список, не null", async () => {
        expect(await requestFormattingEdits(() => Promise.resolve("junk"), PARAMS, 1000)).toEqual([]);
        expect(await requestFormattingEdits(() => Promise.resolve({ edits: [WIRE_EDIT] }), PARAMS, 1000)).toEqual([]);
    });

    it("таймаут — пустой список (молчаливый no-op), не «нет форматтера»", async () => {
        const request = vi.fn(hanging);
        expect(await requestFormattingEdits(request, PARAMS, 10)).toEqual([]);
        expect(request).toHaveBeenCalledWith("languages.provideFormattingEdits", PARAMS, { timeoutMs: 10 });
    });

    it("параметры уезжают методом languages.provideFormattingEdits как есть", async () => {
        const calls: { method: string; params: unknown }[] = [];
        await requestFormattingEdits(
            (method, params) => {
                calls.push({ method, params });
                return Promise.resolve([]);
            },
            { ...PARAMS, range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 4 } },
            1000,
        );
        expect(calls).toEqual([
            {
                method: "languages.provideFormattingEdits",
                params: { ...PARAMS, range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 4 } },
            },
        ]);
    });
});
