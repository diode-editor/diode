import { describe, expect, it } from "vitest";

import { SignatureHelpTriggerKind } from "../../../editor/common/languages/iSignatureHelpSource.ts";

import { parseWireSignatureHelp, requestSignatureHelp, type IWireSignatureHelpParams } from "./wireTypes.ts";

const PARAMS: IWireSignatureHelpParams = {
    uri: "file:///a.ts",
    languageId: "typescript",
    text: "greet(\n",
    line: 0,
    character: 6,
    triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
    triggerCharacter: "(",
    isRetrigger: false,
};

const HELP = {
    signatures: [{ label: "greet(name: string): void", parameters: [{ label: "name: string" }] }],
    activeSignature: 0,
    activeParameter: 0,
};

describe("wireTypes — parseWireSignatureHelp", () => {
    it("разбирает ответ сервера целиком: метки, документация, активные индексы", () => {
        expect(
            parseWireSignatureHelp({
                signatures: [
                    {
                        label: "greet(name: string, age: number): void",
                        documentation: "Здоровается.",
                        parameters: [
                            { label: "name: string", documentation: "кого" },
                            { label: [20, 31] },
                        ],
                        activeParameter: 1,
                    },
                ],
                activeSignature: 0,
                activeParameter: 1,
            }),
        ).toEqual({
            signatures: [
                {
                    label: "greet(name: string, age: number): void",
                    documentation: "Здоровается.",
                    parameters: [{ label: "name: string", documentation: "кого" }, { label: [20, 31] }],
                    activeParameter: 1,
                },
            ],
            activeSignature: 0,
            activeParameter: 1,
        });
    });

    it("не-объект, отсутствие сигнатур и пустой список — подсказки нет", () => {
        expect(parseWireSignatureHelp("junk")).toBeNull();
        expect(parseWireSignatureHelp(null)).toBeNull();
        // `undefined` приезжает, когда субпроцесс ответил пустотой.
        expect(parseWireSignatureHelp(undefined)).toBeNull();
        expect(parseWireSignatureHelp({ signatures: "нет" })).toBeNull();
        expect(parseWireSignatureHelp({ signatures: [] })).toBeNull();
    });

    it("битая сигнатура или параметр роняют ВЕСЬ ответ, а не выбрасываются поодиночке", () => {
        // Выброс одного элемента сдвинул бы activeParameter на соседний
        // параметр — подсветка молча уехала бы не туда.
        expect(parseWireSignatureHelp({ signatures: [{ label: 42 }] })).toBeNull();
        expect(parseWireSignatureHelp({ signatures: [null] })).toBeNull();
        expect(parseWireSignatureHelp({ signatures: [{ label: "f()", parameters: "нет" }] })).toBeNull();
        expect(parseWireSignatureHelp({ signatures: [{ label: "f(a)", parameters: [{ label: 7 }] }] })).toBeNull();
        expect(parseWireSignatureHelp({ signatures: [{ label: "f(a)", parameters: [null] }] })).toBeNull();
        expect(parseWireSignatureHelp({ signatures: [{ label: "f(a)", parameters: [{ label: [1] }] }] })).toBeNull();
        expect(
            parseWireSignatureHelp({ signatures: [{ label: "f(a)", parameters: [{ label: [1, "x"] }] }] }),
        ).toBeNull();
        expect(
            parseWireSignatureHelp({ signatures: [{ label: "f(a)", parameters: [{ label: ["x", 1] }] }] }),
        ).toBeNull();
        expect(
            parseWireSignatureHelp({ signatures: [{ label: "f(a)", parameters: [{ label: [1, Infinity] }] }] }),
        ).toBeNull();
        expect(
            parseWireSignatureHelp({ signatures: [{ label: "f(a)", parameters: [{ label: [Infinity, 1] }] }] }),
        ).toBeNull();
        // Тройка офсетов — не пара: без проверки длины разбор молча взял бы первые два.
        expect(
            parseWireSignatureHelp({ signatures: [{ label: "f(a)", parameters: [{ label: [1, 2, 3] }] }] }),
        ).toBeNull();
        // `parameters` числом: перебор по нему не просто пуст, а невозможен.
        expect(parseWireSignatureHelp({ signatures: [{ label: "f(a)", parameters: 42 }] })).toBeNull();
    });

    it("сигнатура без параметров и без документации — валидна", () => {
        expect(parseWireSignatureHelp({ signatures: [{ label: "now(): Date" }] })).toEqual({
            signatures: [{ label: "now(): Date", parameters: [] }],
            activeSignature: 0,
            activeParameter: 0,
        });
    });

    it("пустая и нестроковая документация не доезжает до попапа", () => {
        expect(
            parseWireSignatureHelp({
                signatures: [{ label: "f(a)", documentation: "", parameters: [{ label: "a", documentation: "" }] }],
            }),
        ).toEqual({
            signatures: [{ label: "f(a)", parameters: [{ label: "a" }] }],
            activeSignature: 0,
            activeParameter: 0,
        });
        // Число вместо строки — не «непустая документация», а мусор: в попап
        // такое уехало бы как `documentation: 42`.
        expect(
            parseWireSignatureHelp({
                signatures: [{ label: "f(a)", documentation: 42, parameters: [{ label: "a", documentation: 7 }] }],
            }),
        ).toEqual({
            signatures: [{ label: "f(a)", parameters: [{ label: "a" }] }],
            activeSignature: 0,
            activeParameter: 0,
        });
    });

    it("activeSignature вне списка и не-целое приводится к нулю", () => {
        // Ровно длина списка — уже за границей (индексы 0-based).
        for (const activeSignature of [7, 1, -1, 0.5, "0", undefined]) {
            expect(parseWireSignatureHelp({ ...HELP, activeSignature })?.activeSignature).toBe(0);
        }
        const two = { signatures: [HELP.signatures[0], { label: "greet(): void" }] };
        expect(parseWireSignatureHelp({ ...two, activeSignature: 1 })?.activeSignature).toBe(1);
        expect(parseWireSignatureHelp({ ...two, activeSignature: 2 })?.activeSignature).toBe(0);
    });

    it("activeParameter: -1 («нет активного») доезжает как есть, мусор — нулём", () => {
        expect(parseWireSignatureHelp({ ...HELP, activeParameter: -1 })?.activeParameter).toBe(-1);
        expect(parseWireSignatureHelp({ ...HELP, activeParameter: "1" })?.activeParameter).toBe(0);
        expect(parseWireSignatureHelp({ ...HELP, activeParameter: Infinity })?.activeParameter).toBe(0);
        expect(parseWireSignatureHelp({ ...HELP, activeParameter: undefined })?.activeParameter).toBe(0);
    });

    it("activeParameter сигнатуры отбраковывается нечислом и бесконечностью", () => {
        for (const activeParameter of ["нет", Infinity, NaN]) {
            const parsed = parseWireSignatureHelp({
                signatures: [{ label: "f(a)", parameters: [{ label: "a" }], activeParameter }],
            });
            expect(parsed?.signatures[0].activeParameter).toBeUndefined();
        }
        const ok = parseWireSignatureHelp({
            signatures: [{ label: "f(a)", parameters: [{ label: "a" }], activeParameter: 0 }],
        });
        expect(ok?.signatures[0].activeParameter).toBe(0);
    });
});

describe("wireTypes — requestSignatureHelp", () => {
    it("успешный ответ парсится, метод и параметры уходят как есть", async () => {
        const result = await requestSignatureHelp(
            (method, params) => {
                expect(method).toBe("languages.provideSignatureHelp");
                expect(params).toEqual(PARAMS);
                return Promise.resolve(HELP);
            },
            PARAMS,
            1000,
        );

        expect(result).toEqual({
            signatures: [{ label: "greet(name: string): void", parameters: [{ label: "name: string" }] }],
            activeSignature: 0,
            activeParameter: 0,
        });
    });

    it("таймаут, ошибка RPC и чужая форма ответа → подсказки нет", async () => {
        expect(await requestSignatureHelp(() => new Promise(() => undefined), PARAMS, 5)).toBeNull();
        expect(await requestSignatureHelp(() => Promise.reject(new Error("boom")), PARAMS, 1000)).toBeNull();
        expect(await requestSignatureHelp(() => Promise.resolve({ nope: true }), PARAMS, 1000)).toBeNull();
    });
});
