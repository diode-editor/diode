import { describe, expect, it, vi } from "vitest";

import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";

import { ProviderRequestBatcher } from "./providerRequestBatcher.ts";

describe("ProviderRequestBatcher", () => {
    it("вызовы с одним запросом в одном проходе уходят одной пачкой; ответы — по своим handle", async () => {
        const send = vi.fn((handles: readonly number[]) =>
            Promise.resolve(handles.map((handle) => `r${String(handle)}`)),
        );
        const batcher = new ProviderRequestBatcher<object, string>(send, "empty");
        const request = {};

        const results = await Promise.all([
            batcher.call(3, request),
            batcher.call(1, request),
            batcher.call(7, request),
        ]);

        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith([3, 1, 7], request, undefined);
        expect(results).toEqual(["r3", "r1", "r7"]);
    });

    it("разные запросы — разные пачки, даже в одном проходе", async () => {
        const send = vi.fn((handles: readonly number[]) => Promise.resolve(handles.map(() => "ok")));
        const batcher = new ProviderRequestBatcher<object, string>(send, "empty");
        const first = {};
        const second = {};

        await Promise.all([batcher.call(1, first), batcher.call(2, second), batcher.call(3, second)]);

        expect(send.mock.calls).toEqual([
            [[1], first, undefined],
            [[2, 3], second, undefined],
        ]);
    });

    it("отправка ранней пачки не закрывает более позднюю, ещё не ушедшую", async () => {
        const send = vi.fn((handles: readonly number[]) => Promise.resolve(handles.map(() => "ok")));
        const batcher = new ProviderRequestBatcher<object, string>(send, "empty");
        const first = {};
        const second = {};
        let late: Promise<string> | undefined;

        const calls = [batcher.call(1, first)];
        // Микротаска встаёт между отправками пачек `first` и `second`.
        queueMicrotask(() => {
            late = batcher.call(3, second);
        });
        calls.push(batcher.call(2, second));
        await Promise.all(calls);
        await late;

        expect(send.mock.calls).toEqual([
            [[1], first, undefined],
            [[2, 3], second, undefined],
        ]);
    });

    it("тот же запрос после отправки пачки открывает новую", async () => {
        const send = vi.fn((handles: readonly number[]) => Promise.resolve(handles.map(() => "ok")));
        const batcher = new ProviderRequestBatcher<object, string>(send, "empty");
        const request = {};

        await batcher.call(1, request);
        await batcher.call(2, request);

        expect(send.mock.calls).toEqual([
            [[1], request, undefined],
            [[2], request, undefined],
        ]);
    });

    it("токен первого вызова пачки уходит в отправку", async () => {
        const send = vi.fn((handles: readonly number[], _request: object, _token: unknown) =>
            Promise.resolve(handles.map(() => "ok")),
        );
        const batcher = new ProviderRequestBatcher<object, string>(send, "empty");
        const request = {};
        const token = CancellationTokenNone;

        await Promise.all([batcher.call(1, request, token), batcher.call(2, request, token)]);

        expect(send.mock.calls[0]?.[2]).toBe(token);
    });

    it("не хватило результата для handle — пустой ответ", async () => {
        const batcher = new ProviderRequestBatcher<object, string>(() => Promise.resolve(["only"]), "empty");
        const request = {};

        const results = await Promise.all([batcher.call(1, request), batcher.call(2, request)]);

        expect(results).toEqual(["only", "empty"]);
    });
});
