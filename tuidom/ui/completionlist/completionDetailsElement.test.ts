import { describe, expect, it } from "vitest";

import { renderElement } from "../../../src/TestUtils/renderElement.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { Point } from "../../common/geometryPromitives.ts";

import { CompletionDetailsElement, wrapText } from "./completionDetailsElement.ts";

function makeDetails(detail?: string, documentation?: string, maxWidth = 30): CompletionDetailsElement {
    const element = new CompletionDetailsElement();
    element.maxWidth = maxWidth;
    element.setContent({
        ...(detail !== undefined ? { detail } : {}),
        ...(documentation !== undefined ? { documentation } : {}),
    });
    return element;
}

function renderToString(element: CompletionDetailsElement): string {
    return renderElement(element, element.getMaxIntrinsicWidth(0), element.getMaxIntrinsicHeight(0)).screenToString();
}

describe("wrapText", () => {
    it("переносит по словам и сохраняет переводы строк источника", () => {
        expect(wrapText("alpha beta gamma", 11)).toEqual(["alpha beta", "gamma"]);
        expect(wrapText("one\ntwo", 10)).toEqual(["one", "two"]);
    });

    it("режет слово, которое шире строки", () => {
        expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    });

    it("нулевая ширина — пусто (места нет вовсе)", () => {
        expect(wrapText("text", 0)).toEqual([]);
    });

    it("символ шире строки не зацикливает перенос", () => {
        // Иероглиф занимает две ячейки — в строку шириной 1 он не влезает
        // никогда; цикл обязан прерваться, а не молотить вечно.
        expect(wrapText("漢字", 1)).toEqual(["漢字"]);
    });
});

describe("CompletionDetailsElement", () => {
    it("пустое содержимое не занимает места", () => {
        const element = new CompletionDetailsElement();
        expect(element.isEmpty).toBe(true);
        expect(element.getMaxIntrinsicWidth(0)).toBe(0);
        expect(element.getMaxIntrinsicHeight(0)).toBe(0);
    });

    it("рисует сигнатуру и документацию, разделяя их пустой строкой", () => {
        const element = makeDetails("(method) Date.getTime(): number", "Returns the stored time value.");
        const frame = renderToString(element);
        expect(frame).toContain("(method) Date.getTime():");
        expect(frame).toContain("Returns the stored time");
        // Обе части есть → между ними разделитель.
        expect(element.linesFor(20)).toContain("");
    });

    it("без документации разделитель не появляется", () => {
        const element = makeDetails("(method) getTime(): number");
        expect(element.linesFor(30)).not.toContain("");
    });

    it("высота не превышает maxHeight (панель не выше списка)", () => {
        const element = makeDetails(undefined, "слово ".repeat(60), 20);
        element.maxHeight = 5;
        expect(element.getMaxIntrinsicHeight(0)).toBe(5);
    });

    it("ширина не превышает maxWidth", () => {
        const element = makeDetails(undefined, "оченьдлинноеслово".repeat(5), 24);
        expect(element.getMaxIntrinsicWidth(0)).toBeLessThanOrEqual(24);
    });

    it("только документация — рисуется цветом текста, без строки сигнатуры", () => {
        const element = makeDetails(undefined, "Returns the stored time value.");
        expect(renderToString(element)).toContain("Returns the stored");
        expect(element.linesFor(30)[0]).toContain("Returns");
    });

    it("min-размеры совпадают с max (панель не тянется)", () => {
        const element = makeDetails("signature", "docs");
        expect(element.getMinIntrinsicWidth(0)).toBe(element.getMaxIntrinsicWidth(0));
        expect(element.getMinIntrinsicHeight(0)).toBe(element.getMaxIntrinsicHeight(0));
    });

    it("пустая и схлопнутая до нуля панель ничего не рисует", () => {
        const empty = new CompletionDetailsElement();
        expect(renderElement(empty, 10, 3).screenToString().trim()).toBe("");

        // Владелец схлопнул панель (места не осталось) — рисовать нечего.
        const collapsed = makeDetails("signature");
        expect(renderElement(collapsed, 0, 0).screenToString().trim()).toBe("");
    });

    it("повторная установка того же содержимого — no-op", () => {
        const element = makeDetails("same");
        const before = element.linesFor(20);
        element.setContent({ detail: "same" });
        expect(element.linesFor(20)).toEqual(before);
    });

    it("красится токенами темы suggest-виджета", () => {
        const element = makeDetails("signature", "docs");
        element.setStyleVars({
            "editorSuggestWidget.background": packRgb(1, 2, 3),
            "editorSuggestWidget.detailForeground": packRgb(4, 5, 6),
        });
        const backend = renderElement(element, element.getMaxIntrinsicWidth(0), element.getMaxIntrinsicHeight(0), {
            resolveStyles: true,
        });
        expect(backend.getBgAt(new Point(2, 1))).toBe(packRgb(1, 2, 3));
        expect(backend.getFgAt(new Point(2, 1))).toBe(packRgb(4, 5, 6)); // строка сигнатуры
    });
});
