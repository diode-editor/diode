import { describe, expect, it } from "vitest";

import {
    parseWireClipboardText,
    parseWireOpenExternalResult,
    parseWireShowMessageRequest,
    parseWireShowMessageResult,
} from "./wireTypes.ts";

describe("parseWireShowMessageRequest", () => {
    it("разбирает полный запрос", () => {
        expect(
            parseWireShowMessageRequest({
                severity: "warn",
                message: "careful",
                detail: "подробности",
                modal: true,
                items: [{ title: "Delete" }, { title: "Cancel", isCloseAffordance: true }],
            }),
        ).toEqual({
            severity: "warn",
            message: "careful",
            detail: "подробности",
            modal: true,
            items: [
                { title: "Delete", isCloseAffordance: false },
                { title: "Cancel", isCloseAffordance: true },
            ],
        });
    });

    it("минимальный запрос: без кнопок, немодальный, без detail", () => {
        expect(parseWireShowMessageRequest({ severity: "info", message: "hi" })).toEqual({
            severity: "info",
            message: "hi",
            detail: undefined,
            modal: false,
            items: [],
        });
    });

    it("непонятная строгость читается как info", () => {
        expect(parseWireShowMessageRequest({ severity: "fatal", message: "hi" })?.severity).toBe("info");
    });

    it("error и warn проходят как есть", () => {
        expect(parseWireShowMessageRequest({ severity: "error", message: "hi" })?.severity).toBe("error");
        expect(parseWireShowMessageRequest({ severity: "warn", message: "hi" })?.severity).toBe("warn");
    });

    it("без текста показывать нечего — null", () => {
        expect(parseWireShowMessageRequest({ severity: "info" })).toBeNull();
        expect(parseWireShowMessageRequest({ severity: "info", message: 7 })).toBeNull();
    });

    it("не-объект — null", () => {
        expect(parseWireShowMessageRequest(null)).toBeNull();
        expect(parseWireShowMessageRequest("hi")).toBeNull();
    });

    it("мусор вместо items — кнопок нет", () => {
        expect(parseWireShowMessageRequest({ severity: "info", message: "hi", items: "nope" })?.items).toEqual([]);
    });

    it("кнопка-мусор ОСТАЁТСЯ в наборе пустой: ответ адресуется индексом в нём", () => {
        expect(
            parseWireShowMessageRequest({
                severity: "info",
                message: "hi",
                items: [null, { title: 7 }, { title: "Ok" }],
            })?.items,
        ).toEqual([
            { title: "", isCloseAffordance: false },
            { title: "", isCloseAffordance: false },
            { title: "Ok", isCloseAffordance: false },
        ]);
    });

    it("modal только по строгому true", () => {
        expect(parseWireShowMessageRequest({ severity: "info", message: "hi", modal: "yes" })?.modal).toBe(false);
    });

    it("не-строковый detail отбрасывается", () => {
        expect(parseWireShowMessageRequest({ severity: "info", message: "hi", detail: 7 })?.detail).toBeUndefined();
    });
});

describe("parseWireShowMessageResult", () => {
    it("индекс проходит как есть", () => {
        expect(parseWireShowMessageResult({ index: 2 })).toEqual({ index: 2 });
        expect(parseWireShowMessageResult({ index: 0 })).toEqual({ index: 0 });
    });

    it("null, мусор и отрицательный индекс — закрыто без выбора", () => {
        expect(parseWireShowMessageResult({ index: null })).toEqual({ index: null });
        expect(parseWireShowMessageResult({ index: "1" })).toEqual({ index: null });
        expect(parseWireShowMessageResult({ index: 1.5 })).toEqual({ index: null });
        expect(parseWireShowMessageResult({ index: -1 })).toEqual({ index: null });
        expect(parseWireShowMessageResult(null)).toEqual({ index: null });
    });
});

describe("parseWireClipboardText", () => {
    it("строка проходит как есть", () => {
        expect(parseWireClipboardText({ text: "copied" })).toEqual({ text: "copied" });
    });

    it("мусор — пустой буфер", () => {
        expect(parseWireClipboardText({ text: 7 })).toEqual({ text: "" });
        expect(parseWireClipboardText(null)).toEqual({ text: "" });
    });
});

describe("parseWireOpenExternalResult", () => {
    it("true только по строгому флагу", () => {
        expect(parseWireOpenExternalResult({ opened: true })).toBe(true);
        expect(parseWireOpenExternalResult({ opened: "yes" })).toBe(false);
        expect(parseWireOpenExternalResult({})).toBe(false);
        expect(parseWireOpenExternalResult(null)).toBe(false);
    });
});
