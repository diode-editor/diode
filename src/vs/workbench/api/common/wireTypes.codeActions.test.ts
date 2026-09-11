import { describe, expect, it } from "vitest";

import { parseWireCodeActions, requestApplyCodeAction, requestCodeActions } from "./wireTypes.ts";

// Wire-слой code actions: трёхзначный контракт provide (null/[]/список) и
// строгий boolean apply.

const PARAMS = {
    uri: "file:///a.py",
    languageId: "python",
    text: "x\n",
    range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 1 },
};

const ITEM = { id: "1.0", title: "Fix", kind: "quickfix", isPreferred: true };

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
    it("null — «нет провайдера»; массив — как есть; мусор и таймаут — []", async () => {
        expect(await requestCodeActions(() => Promise.resolve(null), PARAMS, 1000)).toBeNull();
        expect(await requestCodeActions(() => Promise.resolve([ITEM]), PARAMS, 1000)).toEqual([ITEM]);
        expect(await requestCodeActions(() => Promise.resolve({ items: [ITEM] }), PARAMS, 1000)).toEqual([]);
        const never = new Promise<unknown>(() => undefined);
        expect(await requestCodeActions(() => never, PARAMS, 10)).toEqual([]);
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
        const never = new Promise<unknown>(() => undefined);
        expect(await requestApplyCodeAction(() => never, "3.1", 10)).toBe(false);
    });
});
