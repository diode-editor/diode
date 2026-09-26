import { describe, expect, it } from "vitest";

import {
    parseWireClipboardText,
    parseWireOpenExternalResult,
    parseWireShowMessageRequest,
    parseWireShowMessageResult,
} from "./wireTypes.ts";

describe("parseWireShowMessageRequest", () => {
    it("разбирает severity, текст и подписи кнопок", () => {
        expect(parseWireShowMessageRequest({ severity: "warn", message: "careful", items: ["OK", "Cancel"] })).toEqual({
            severity: "warn",
            message: "careful",
            items: ["OK", "Cancel"],
        });
    });

    it("незнакомая строгость (и её отсутствие) читается как info", () => {
        expect(parseWireShowMessageRequest({ severity: "fatal", message: "x" })?.severity).toBe("info");
        expect(parseWireShowMessageRequest({ message: "x" })?.severity).toBe("info");
    });

    it("`error` доезжает как error", () => {
        expect(parseWireShowMessageRequest({ severity: "error", message: "x" })?.severity).toBe("error");
    });

    it("нет items — пустой список кнопок", () => {
        expect(parseWireShowMessageRequest({ severity: "info", message: "x" })?.items).toEqual([]);
        expect(parseWireShowMessageRequest({ severity: "info", message: "x", items: "OK" })?.items).toEqual([]);
    });

    it("нестроковая подпись становится пустой, а не исчезает: индексы не должны сдвинуться", () => {
        expect(parseWireShowMessageRequest({ message: "x", items: ["A", 7, "B"] })?.items).toEqual(["A", "", "B"]);
    });

    it("примитив вместо текста записывается как есть (расширение на JS)", () => {
        expect(parseWireShowMessageRequest({ severity: "info", message: 7 })?.message).toBe("7");
        expect(parseWireShowMessageRequest({ severity: "info", message: false })?.message).toBe("false");
        expect(parseWireShowMessageRequest({ severity: "info", message: 1n })?.message).toBe("1");
    });

    it("не-объект, null и объект вместо текста — показывать нечего", () => {
        expect(parseWireShowMessageRequest(null)).toBeNull();
        expect(parseWireShowMessageRequest("boom")).toBeNull();
        expect(parseWireShowMessageRequest({ severity: "info" })).toBeNull();
        expect(parseWireShowMessageRequest({ severity: "info", message: { toString: () => "x" } })).toBeNull();
    });
});

describe("parseWireShowMessageResult", () => {
    it("целый неотрицательный индекс — ответ человека", () => {
        expect(parseWireShowMessageResult({ index: 0 })).toEqual({ index: 0 });
        expect(parseWireShowMessageResult({ index: 2 })).toEqual({ index: 2 });
    });

    it("null, мусор и отрицательный индекс — «человек закрыл»", () => {
        expect(parseWireShowMessageResult({ index: null })).toEqual({ index: null });
        expect(parseWireShowMessageResult({ index: -1 })).toEqual({ index: null });
        expect(parseWireShowMessageResult({ index: 1.5 })).toEqual({ index: null });
        expect(parseWireShowMessageResult({})).toEqual({ index: null });
        expect(parseWireShowMessageResult(null)).toEqual({ index: null });
        expect(parseWireShowMessageResult(42)).toEqual({ index: null });
    });
});

describe("parseWireClipboardText", () => {
    it("строка доезжает как есть", () => {
        expect(parseWireClipboardText({ text: "hello" })).toEqual({ text: "hello" });
    });

    it("чужой ответ читается как пустой буфер", () => {
        expect(parseWireClipboardText({ text: 7 })).toEqual({ text: "" });
        expect(parseWireClipboardText({})).toEqual({ text: "" });
        expect(parseWireClipboardText(null)).toEqual({ text: "" });
        expect(parseWireClipboardText("hello")).toEqual({ text: "" });
    });
});

describe("parseWireOpenExternalResult", () => {
    it("только буквальное true значит «открыли»", () => {
        expect(parseWireOpenExternalResult({ opened: true })).toEqual({ opened: true });
        expect(parseWireOpenExternalResult({ opened: "yes" })).toEqual({ opened: false });
        expect(parseWireOpenExternalResult({})).toEqual({ opened: false });
        expect(parseWireOpenExternalResult(null)).toEqual({ opened: false });
        expect(parseWireOpenExternalResult(true)).toEqual({ opened: false });
    });
});
