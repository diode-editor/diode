import { describe, expect, it, vi } from "vitest";

import { type IRequestOptions, TimeoutError } from "./rpcEndpoint.ts";
import { parseWireCodeActions, requestApplyCodeAction, requestCodeActions } from "./wireTypes.ts";

// Wire-слой code actions: provide — список (мусор, null и таймаут — []) и
// строгий boolean apply.

const PARAMS = {
    uri: "file:///a.py",
    languageId: "python",
    text: "x\n",
    range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 1 },
};

const ITEM = { id: "1.0", title: "Fix", kind: "quickfix", isPreferred: true };

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

describe("parseWireCodeActions", () => {
    it("валидные элементы проходят, опциональные поля не выдумываются, мусор отбрасывается поштучно", () => {
        expect(
            parseWireCodeActions([
                ITEM,
                { id: "1.1", title: "Bare" },
                { id: "", title: "no id" },
                { id: 7, title: "numeric id" },
                { id: "1.2", title: 42 },
                { id: "1.3", title: "bad preferred", isPreferred: "yes", kind: 7 },
                null,
                undefined,
                "junk",
            ]),
        ).toStrictEqual([ITEM, { id: "1.1", title: "Bare" }, { id: "1.3", title: "bad preferred" }]);
        expect(parseWireCodeActions("junk")).toEqual([]);
    });
});

describe("requestCodeActions", () => {
    it("массив — как есть; null, мусор и таймаут — []", async () => {
        expect(await requestCodeActions(() => Promise.resolve(null), PARAMS, 1000)).toEqual([]);
        expect(await requestCodeActions(() => Promise.resolve([ITEM]), PARAMS, 1000)).toEqual([ITEM]);
        expect(await requestCodeActions(() => Promise.resolve({ items: [ITEM] }), PARAMS, 1000)).toEqual([]);
        const request = vi.fn(hanging);
        expect(await requestCodeActions(request, PARAMS, 10)).toEqual([]);
        expect(request).toHaveBeenCalledWith("languages.provideCodeActions", PARAMS, { timeoutMs: 10 });
    });

    it("параметры уезжают методом languages.provideCodeActions как есть", async () => {
        const calls: { method: string; params: unknown }[] = [];
        await requestCodeActions(
            (method, params) => {
                calls.push({ method, params });
                return Promise.resolve([]);
            },
            { ...PARAMS, only: "source.fixAll" },
            1000,
        );
        expect(calls).toEqual([
            { method: "languages.provideCodeActions", params: { ...PARAMS, only: "source.fixAll" } },
        ]);
    });
});

describe("requestApplyCodeAction", () => {
    it("только строгий true — успех; false/мусор/таймаут — false", async () => {
        const calls: { method: string; params: unknown }[] = [];
        expect(
            await requestApplyCodeAction(
                (method, params) => {
                    calls.push({ method, params });
                    return Promise.resolve(true);
                },
                "3.1",
                1000,
            ),
        ).toBe(true);
        expect(calls).toEqual([{ method: "languages.applyCodeAction", params: { id: "3.1" } }]);

        expect(await requestApplyCodeAction(() => Promise.resolve(false), "3.1", 1000)).toBe(false);
        expect(await requestApplyCodeAction(() => Promise.resolve("true"), "3.1", 1000)).toBe(false);
        const request = vi.fn(hanging);
        expect(await requestApplyCodeAction(request, "3.1", 10)).toBe(false);
        expect(request).toHaveBeenCalledWith("languages.applyCodeAction", { id: "3.1" }, { timeoutMs: 10 });
    });
});
