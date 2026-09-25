import { describe, expect, it } from "vitest";

import {
    parseWireInputBoxRequest,
    parseWireInputBoxResult,
    parseWireQuickInputCancel,
    parseWireQuickPickRequest,
    parseWireQuickPickResult,
    parseWireValidationMessage,
} from "./wireTypes.ts";

describe("parseWireInputBoxRequest", () => {
    it("разбирает полный запрос", () => {
        expect(
            parseWireInputBoxRequest({
                handle: 3,
                title: "Your name",
                prompt: "Как к вам",
                placeHolder: "имя",
                value: "Ада",
                password: true,
                validates: true,
            }),
        ).toEqual({
            handle: 3,
            title: "Your name",
            prompt: "Как к вам",
            placeHolder: "имя",
            value: "Ада",
            password: true,
            validates: true,
        });
    });

    it("необязательные поля отсутствуют, а не приезжают undefined'ами", () => {
        expect(parseWireInputBoxRequest({ handle: 1 })).toEqual({ handle: 1, password: false, validates: false });
    });

    it("не-строковые опции отбрасываются", () => {
        expect(parseWireInputBoxRequest({ handle: 1, title: 7, prompt: null, value: {} })).toEqual({
            handle: 1,
            password: false,
            validates: false,
        });
    });

    it("без числового handle — null", () => {
        expect(parseWireInputBoxRequest({ handle: "три" })).toBeNull();
        expect(parseWireInputBoxRequest({})).toBeNull();
        expect(parseWireInputBoxRequest(null)).toBeNull();
        expect(parseWireInputBoxRequest("строка")).toBeNull();
    });

    it("validates честно булев: любое не-true значит «валидатора нет»", () => {
        expect(parseWireInputBoxRequest({ handle: 1, validates: "да" })?.validates).toBe(false);
        expect(parseWireInputBoxRequest({ handle: 1, validates: true })?.validates).toBe(true);
    });

    it("password честно булев: маску включает только настоящее true", () => {
        expect(parseWireInputBoxRequest({ handle: 1, password: true })?.password).toBe(true);
        // Строка «да» истинна по-джаваскриптовому — но поле пароля по ней не
        // включается: иначе мусор на проводе делал бы обычное поле слепым.
        expect(parseWireInputBoxRequest({ handle: 1, password: "да" })?.password).toBe(false);
        expect(parseWireInputBoxRequest({ handle: 1, password: 0 })?.password).toBe(false);
    });
});

describe("parseWireQuickPickRequest", () => {
    it("разбирает список с описаниями", () => {
        expect(
            parseWireQuickPickRequest({
                handle: 2,
                title: "Кто",
                placeHolder: "Выберите",
                canPickMany: true,
                items: [{ label: "a" }, { label: "b", description: "вторая" }],
                picked: [1],
            }),
        ).toEqual({
            handle: 2,
            title: "Кто",
            placeHolder: "Выберите",
            canPickMany: true,
            items: [{ label: "a" }, { label: "b", description: "вторая" }],
            picked: [1],
        });
    });

    it("пункт без лейбла остаётся пустой строкой — иначе поехали бы индексы ответа", () => {
        const parsed = parseWireQuickPickRequest({ handle: 1, items: [{ label: 7 }, { label: "b" }], picked: [] });
        expect(parsed?.items).toEqual([{ label: "" }, { label: "b" }]);
    });

    it("не-объектные пункты выбрасываются", () => {
        const parsed = parseWireQuickPickRequest({ handle: 1, items: ["a", null, { label: "b" }], picked: [] });
        expect(parsed?.items).toEqual([{ label: "b" }]);
    });

    it("предотметки вне диапазона отбрасываются", () => {
        const parsed = parseWireQuickPickRequest({
            handle: 1,
            canPickMany: true,
            items: [{ label: "a" }, { label: "b" }],
            picked: [-1, 0, 5, 1.5, "x"],
        });
        expect(parsed?.picked).toEqual([0]);
    });

    it("индекс, равный длине списка, — уже за его пределами", () => {
        const parsed = parseWireQuickPickRequest({
            handle: 1,
            canPickMany: true,
            items: [{ label: "a" }, { label: "b" }],
            picked: [1, 2],
        });
        expect(parsed?.picked).toEqual([1]);
    });

    it("без canPickMany предотметки гасятся", () => {
        const parsed = parseWireQuickPickRequest({ handle: 1, items: [{ label: "a" }], picked: [0] });
        expect(parsed?.picked).toEqual([]);
        expect(parsed?.canPickMany).toBe(false);
    });

    it("не-массив picked — пустые предотметки", () => {
        const parsed = parseWireQuickPickRequest({ handle: 1, canPickMany: true, items: [{ label: "a" }], picked: 7 });
        expect(parsed?.picked).toEqual([]);
    });

    it("без handle или без массива items — null", () => {
        expect(parseWireQuickPickRequest({ items: [] })).toBeNull();
        expect(parseWireQuickPickRequest({ handle: 1 })).toBeNull();
        expect(parseWireQuickPickRequest(null)).toBeNull();
    });
});

describe("parseWireQuickInputCancel", () => {
    it("разбирает handle", () => {
        expect(parseWireQuickInputCancel({ handle: 9 })).toBe(9);
    });

    it("мусор — null", () => {
        expect(parseWireQuickInputCancel({})).toBeNull();
        expect(parseWireQuickInputCancel({ handle: "девять" })).toBeNull();
        expect(parseWireQuickInputCancel(null)).toBeNull();
    });
});

describe("parseWireValidationMessage", () => {
    it("разбирает сообщение со строгостью", () => {
        expect(parseWireValidationMessage({ message: "ой", severity: "warning" })).toEqual({
            message: "ой",
            severity: "warning",
        });
        expect(parseWireValidationMessage({ message: "к сведению", severity: "info" })).toEqual({
            message: "к сведению",
            severity: "info",
        });
    });

    it("незнакомая или отсутствующая строгость — ошибка", () => {
        expect(parseWireValidationMessage({ message: "x" })).toEqual({ message: "x", severity: "error" });
        expect(parseWireValidationMessage({ message: "x", severity: "фатально" })).toEqual({
            message: "x",
            severity: "error",
        });
    });

    it("молчание или мусор — значение в порядке", () => {
        expect(parseWireValidationMessage(null)).toBeNull();
        expect(parseWireValidationMessage({})).toBeNull();
        expect(parseWireValidationMessage({ message: 7 })).toBeNull();
    });
});

describe("parseWireInputBoxResult", () => {
    it("строка — введённое значение, всё прочее — отмена", () => {
        expect(parseWireInputBoxResult({ value: "Ада" })).toEqual({ value: "Ада" });
        expect(parseWireInputBoxResult({ value: "" })).toEqual({ value: "" });
        expect(parseWireInputBoxResult({ value: null })).toEqual({ value: null });
        expect(parseWireInputBoxResult({})).toEqual({ value: null });
        expect(parseWireInputBoxResult(null)).toEqual({ value: null });
    });
});

describe("parseWireQuickPickResult", () => {
    it("массив целых — выбранные индексы", () => {
        expect(parseWireQuickPickResult({ indices: [0, 2] })).toEqual({ indices: [0, 2] });
        expect(parseWireQuickPickResult({ indices: [] })).toEqual({ indices: [] });
    });

    it("мусорные индексы выбрасываются", () => {
        expect(parseWireQuickPickResult({ indices: [0, -1, 1.5, "x", 3] })).toEqual({ indices: [0, 3] });
    });

    it("отсутствие массива — отмена", () => {
        expect(parseWireQuickPickResult({ indices: null })).toEqual({ indices: null });
        expect(parseWireQuickPickResult({})).toEqual({ indices: null });
        expect(parseWireQuickPickResult(null)).toEqual({ indices: null });
    });
});
