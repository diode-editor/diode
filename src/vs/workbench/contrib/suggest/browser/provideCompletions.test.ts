import { describe, expect, it, vi } from "vitest";

import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import type {
    CompletionItemProvider,
    ICompletionRequest,
    ICoreCompletionResult,
} from "../../../../editor/common/languages/iCompletionSource.ts";

import { provideCompletions } from "./provideCompletions.ts";

const TOKEN = new CancellationTokenSource().token;

const REQUEST: ICompletionRequest = {
    uri: "file:///a.ts",
    languageId: "typescript",
    versionId: 1,
    line: 0,
    character: 2,
};

function provider(result: Promise<ICoreCompletionResult>): CompletionItemProvider {
    return { triggerCharacters: [], provideCompletionItems: vi.fn(() => result) };
}

describe("provideCompletions", () => {
    it("concatenates items in provider order and remembers the owner of each", async () => {
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

        const result = await provideCompletions([first, second], REQUEST, TOKEN);

        expect(result.items.map((item) => item.label)).toEqual(["a", "b", "c"]);
        expect(result.isIncomplete).toBe(false);
        expect(result.providerOf.get(result.items[0])).toBe(first);
        expect(result.providerOf.get(result.items[2])).toBe(second);
    });

    it("all providers get the SAME request object and request token — the host batches the calls into one RPC by them", async () => {
        const first = provider(Promise.resolve({ items: [], isIncomplete: false }));
        const second = provider(Promise.resolve({ items: [], isIncomplete: false }));

        await provideCompletions([first, second], REQUEST, TOKEN);

        expect(vi.mocked(first.provideCompletionItems).mock.calls[0][0]).toBe(REQUEST);
        expect(vi.mocked(second.provideCompletionItems).mock.calls[0][0]).toBe(REQUEST);
        expect(vi.mocked(first.provideCompletionItems)).toHaveBeenCalledWith(REQUEST, TOKEN);
        expect(vi.mocked(second.provideCompletionItems)).toHaveBeenCalledWith(REQUEST, TOKEN);
    });

    it("an incomplete list from any provider makes the whole result incomplete", async () => {
        const result = await provideCompletions(
            [
                provider(Promise.resolve({ items: [], isIncomplete: false })),
                provider(Promise.resolve({ items: [], isIncomplete: true })),
            ],
            REQUEST,
            TOKEN,
        );
        expect(result.isIncomplete).toBe(true);
    });

    it("a failing provider yields an empty list, the others still arrive", async () => {
        const result = await provideCompletions(
            [
                provider(Promise.reject(new Error("boom"))),
                provider(Promise.resolve({ items: [{ label: "ok", insertText: "ok" }], isIncomplete: true })),
            ],
            REQUEST,
            TOKEN,
        );
        expect(result.items.map((item) => item.label)).toEqual(["ok"]);
        expect(result.isIncomplete).toBe(true);
    });
});
