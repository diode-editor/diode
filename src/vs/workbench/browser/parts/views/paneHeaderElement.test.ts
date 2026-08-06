import { describe, expect, it, vi } from "vitest";

import { BoxConstraints, Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { TUIMouseEvent } from "../../../../../../tuidom/dom/events/tuiMouseEvent.ts";

import { PaneHeaderElement } from "./paneHeaderElement.ts";

function makeHeader(width = 30): {
    header: PaneHeaderElement;
    onToggle: ReturnType<typeof vi.fn>;
    onDrag: ReturnType<typeof vi.fn>;
    onMenu: ReturnType<typeof vi.fn>;
} {
    const header = new PaneHeaderElement("CHANGES");
    const onToggle = vi.fn();
    const onDrag = vi.fn();
    const onMenu = vi.fn();
    header.onToggle = onToggle;
    header.onDrag = onDrag;
    header.onMenu = onMenu;
    header.layout(BoxConstraints.tight(new Size(width, 1)));
    return { header, onToggle, onDrag, onMenu };
}

function mouse(
    header: PaneHeaderElement,
    type: "mousedown" | "mousemove" | "mouseup",
    init: { localX?: number; localY?: number; screenY?: number; button?: "left" | "right" } = {},
): void {
    header.dispatchEvent(
        new TUIMouseEvent(type, {
            button: init.button ?? "left",
            screenX: init.localX ?? 0,
            screenY: init.screenY ?? 0,
            localX: init.localX ?? 0,
            localY: init.localY ?? 0,
        }),
    );
}

describe("PaneHeaderElement", () => {
    it("геттеры и inspectState отражают состояние", () => {
        const { header } = makeHeader();
        expect(header.isExpanded).toBe(true);
        expect(header.isDragEnabled).toBe(false);
        header.setExpanded(false);
        header.setDragEnabled(true);
        expect(header.isExpanded).toBe(false);
        expect(header.isDragEnabled).toBe(true);
        expect(header.inspectState()).toEqual({
            title: "CHANGES",
            expanded: false,
            dragEnabled: true,
            collapsible: true,
        });
    });

    it("setExpanded в то же состояние — no-op", () => {
        const { header } = makeHeader();
        header.setExpanded(true);
        expect(header.isExpanded).toBe(true);
    });

    it("интринсики — ровно одна строка", () => {
        const { header } = makeHeader();
        expect(header.getMinIntrinsicHeight(30)).toBe(1);
        expect(header.getMaxIntrinsicHeight(30)).toBe(1);
    });

    it("на узком заголовке кнопка ⋯ заклипована — клик в её зону сворачивает", () => {
        const { header, onToggle, onMenu } = makeHeader(4);
        mouse(header, "mousedown", { localX: 3 });
        mouse(header, "mouseup", { localX: 3 });
        expect(onToggle).toHaveBeenCalledOnce();
        expect(onMenu).not.toHaveBeenCalled();
    });

    it("после начала drag репортится каждый move, включая возврат на строку нажатия", () => {
        const { header, onDrag, onToggle } = makeHeader();
        header.setDragEnabled(true);
        mouse(header, "mousedown", { localX: 2, screenY: 5 });
        mouse(header, "mousemove", { localX: 2, screenY: 7 });
        mouse(header, "mousemove", { localX: 2, screenY: 5 });
        expect(onDrag.mock.calls.map(([y]) => y)).toEqual([7, 5]);
        mouse(header, "mouseup", { localX: 2, screenY: 5 });
        expect(onToggle).not.toHaveBeenCalled();
    });

    it("движение только по X в строке нажатия — не drag, отпускание остаётся кликом", () => {
        const { header, onDrag, onToggle } = makeHeader();
        header.setDragEnabled(true);
        mouse(header, "mousedown", { localX: 2, screenY: 5 });
        mouse(header, "mousemove", { localX: 5, screenY: 5 });
        mouse(header, "mouseup", { localX: 5, screenY: 5 });
        expect(onDrag).not.toHaveBeenCalled();
        expect(onToggle).toHaveBeenCalledOnce();
    });

    it("mouseup без нажатия и правая кнопка не сворачивают", () => {
        const { header, onToggle } = makeHeader();
        mouse(header, "mouseup", { localX: 2 });
        mouse(header, "mousedown", { localX: 2, button: "right" });
        mouse(header, "mouseup", { localX: 2, button: "right" });
        expect(onToggle).not.toHaveBeenCalled();
    });
});

describe("PaneHeaderElement — несворачиваемый (collapsible: false)", () => {
    function makeFixedHeader(): ReturnType<typeof makeHeader> {
        const header = new PaneHeaderElement("SEARCH", { collapsible: false });
        const onToggle = vi.fn();
        const onDrag = vi.fn();
        const onMenu = vi.fn();
        header.onToggle = onToggle;
        header.onDrag = onDrag;
        header.onMenu = onMenu;
        header.layout(BoxConstraints.tight(new Size(30, 1)));
        return { header, onToggle, onDrag, onMenu };
    }

    it("клик по заголовку вне зоны ⋯ не вызывает onToggle", () => {
        const { header, onToggle, onMenu } = makeFixedHeader();
        mouse(header, "mousedown", { localX: 2 });
        mouse(header, "mouseup", { localX: 2 });
        expect(onToggle).not.toHaveBeenCalled();
        expect(onMenu).not.toHaveBeenCalled();
    });

    it("клик в зону ⋯ по-прежнему открывает меню", () => {
        const { header, onToggle, onMenu } = makeFixedHeader();
        mouse(header, "mousedown", { localX: 28 });
        mouse(header, "mouseup", { localX: 28 });
        expect(onMenu).toHaveBeenCalledOnce();
        expect(onToggle).not.toHaveBeenCalled();
    });

    it("без шеврона в заголовке, inspectState отражает collapsible", () => {
        const { header } = makeFixedHeader();
        expect(header.inspectState()).toMatchObject({ title: "SEARCH", collapsible: false });
    });
});
