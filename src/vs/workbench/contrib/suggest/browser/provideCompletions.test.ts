import { describe, expect, it, vi } from "vitest";

import type {
    CompletionItemProvider,
    ICompletionRequest,
    ICoreCompletionResult,
} from "../../../../editor/common/languages/iCompletionSource.ts";

import { provideCompletions } from "./provideCompletions.ts";

const REQUEST: ICompletionRequest = {
    uri: "file:///a.ts",
    languageId: "typescript",
    text: "a.",
    line: 0,
    character: 2,
};

function provider(result: Promise<ICoreCompletionResult>): CompletionItemProvider {
    return { triggerCharacters: [], provideCompletionItems: vi.fn(() => result) };
}

describe("provideCompletions", () => {
    it("склеивает пункты в порядке провайдеров и помнит владельца каждого", async () => {
        const first = provider(Promise.resolve({ items: [{ label: "a", insertText: "a" }], isIncomplete: false }));
        const second = provider(
            Promise.resolve({
                items: [
                    { label: "b", insertText: "b" },
                    { label: "c", insertText: "c" },
                ],
                isIncomplete: false,
            }),
        );

        const result = await provideCompletions([first, second], REQUEST);

        expect(result.items.map((item) => item.label)).toEqual(["a", "b", "c"]);
        expect(result.isIncomplete).toBe(false);
        expect(result.providerOf.get(result.items[0])).toBe(first);
        expect(result.providerOf.get(result.items[2])).toBe(second);
    });

    it("всем провайдерам уходит ОДИН объект запроса — по нему хост склеит вызовы в один RPC", async () => {
        const first = provider(Promise.resolve({ items: [], isIncomplete: false }));
        const second = provider(Promise.resolve({ items: [], isIncomplete: false }));

        await provideCompletions([first, second], REQUEST);

        expect(vi.mocked(first.provideCompletionItems).mock.calls[0][0]).toBe(REQUEST);
        expect(vi.mocked(second.provideCompletionItems).mock.calls[0][0]).toBe(REQUEST);
    });

    it("неполный список хотя бы одного — неполный весь ответ", async () => {
        const result = await provideCompletions(
            [
                provider(Promise.resolve({ items: [], isIncomplete: false })),
                provider(Promise.resolve({ items: [], isIncomplete: true })),
            ],
            REQUEST,
        );
        expect(result.isIncomplete).toBe(true);
    });

    it("сбойный провайдер = пустой список, остальные доезжают", async () => {
        const result = await provideCompletions(
            [
                provider(Promise.reject(new Error("boom"))),
                provider(Promise.resolve({ items: [{ label: "ok", insertText: "ok" }], isIncomplete: true })),
            ],
            REQUEST,
        );
        expect(result.items.map((item) => item.label)).toEqual(["ok"]);
        expect(result.isIncomplete).toBe(true);
    });
});
