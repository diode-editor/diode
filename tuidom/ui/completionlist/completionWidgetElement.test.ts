import { describe, expect, it } from "vitest";

import { renderElement } from "../../testing/renderElement.ts";

import { CompletionWidgetElement } from "./completionWidgetElement.ts";

function makeWidget(): CompletionWidgetElement {
    const widget = new CompletionWidgetElement();
    widget.list.setItems([
        { label: "getTime", kind: 1 },
        { label: "toISOString", kind: 1 },
    ]);
    return widget;
}

function render(widget: CompletionWidgetElement): string {
    return renderElement(widget, widget.getMaxIntrinsicWidth(0), widget.getMaxIntrinsicHeight(0)).screenToString();
}

describe("CompletionWidgetElement", () => {
    it("без тумблера показывает только список", () => {
        const widget = makeWidget();
        widget.details.setContent({ detail: "(): number" });
        expect(widget.showsDetails).toBe(false);
        expect(widget.getMaxIntrinsicWidth(0)).toBe(widget.list.getMaxIntrinsicWidth(0));
    });

    it("тумблер без содержимого панель не показывает", () => {
        const widget = makeWidget();
        widget.detailsVisible = true;
        expect(widget.showsDetails).toBe(false);
        expect(widget.getMaxIntrinsicWidth(0)).toBe(widget.list.getMaxIntrinsicWidth(0));
    });

    it("тумблер с содержимым ставит панель справа от списка", () => {
        const widget = makeWidget();
        widget.detailsVisible = true;
        widget.details.setContent({ detail: "(): number" });

        expect(widget.showsDetails).toBe(true);
        expect(widget.getMaxIntrinsicWidth(0)).toBe(
            widget.list.getMaxIntrinsicWidth(0) + widget.details.getMaxIntrinsicWidth(0),
        );

        render(widget);
        expect(widget.details.localPosition.dx).toBe(widget.list.getMaxIntrinsicWidth(0));
        expect(widget.list.localPosition.dx).toBe(0);
    });

    it("сторона left переставляет панель перед списком", () => {
        const widget = makeWidget();
        widget.detailsVisible = true;
        widget.detailsSide = "left";
        widget.details.setContent({ detail: "(): number" });

        render(widget);
        expect(widget.details.localPosition.dx).toBe(0);
        expect(widget.list.localPosition.dx).toBe(widget.details.getMaxIntrinsicWidth(0));
    });

    it("min-размеры совпадают с max, повторная установка стороны/тумблера — no-op", () => {
        const widget = makeWidget();
        widget.detailsVisible = true;
        widget.detailsVisible = true; // повтор
        widget.detailsSide = "right"; // уже right
        widget.details.setContent({ detail: "(): number" });

        expect(widget.detailsSide).toBe("right");
        expect(widget.getMinIntrinsicWidth(0)).toBe(widget.getMaxIntrinsicWidth(0));
        expect(widget.getMinIntrinsicHeight(0)).toBe(widget.getMaxIntrinsicHeight(0));
    });

    it("панель не выше списка", () => {
        const widget = makeWidget();
        widget.detailsVisible = true;
        widget.details.setContent({ documentation: "строка ".repeat(80) });

        const listHeight = widget.list.getMaxIntrinsicHeight(0);
        expect(widget.getMaxIntrinsicHeight(0)).toBe(listHeight);
    });
});
