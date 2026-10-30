import { BoxConstraints, Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";

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
    it("getters and inspectState reflect the state", () => {
        const { header } = makeHeader();
        expect(header.isExpanded).toBe(true);
        expect(header.isDragEnabled).toBe(false);
        header.setExpanded(false);
        header.setDragEnabled(true);
        expect(header.isExpanded).toBe(false);
        expect(header.isDragEnabled).toBe(true);
        expect(header.inspectState()).toEqual({
            title: "CHANGES",
            description: null,
            expanded: false,
            dragEnabled: true,
            collapsible: true,
            busy: false,
        });
    });

    it("a description is dimmed after the title; empty or null removes it", () => {
        const { header } = makeHeader();
        const app = TestApp.createWithContent(header, new Size(30, 1));
        header.setDescription("3 found");
        app.render();
        expect(app.backend.screenToString()).toMatch(/ CHANGES 3 found +⋯/u);
        expect(app.backend.getFgAt(new Point(11, 0))).not.toBe(app.backend.getFgAt(new Point(3, 0)));
        header.setDescription("");
        app.render();
        expect(app.backend.screenToString()).toMatch(/ CHANGES +⋯/u);
        expect(header.inspectState()).toMatchObject({ description: null });
        header.setDescription(null);
        expect(header.inspectState()).toMatchObject({ description: null });
    });

    it("setExpanded to the same state is a no-op", () => {
        const { header } = makeHeader();
        header.setExpanded(true);
        expect(header.isExpanded).toBe(true);
    });

    it("intrinsics are exactly one row", () => {
        const { header } = makeHeader();
        expect(header.getMinIntrinsicHeight(30)).toBe(1);
        expect(header.getMaxIntrinsicHeight(30)).toBe(1);
    });

    it("on a narrow header the title gives way: ⋯ keeps its zone", () => {
        const { header, onToggle, onMenu } = makeHeader(4);
        mouse(header, "mousedown", { localX: 1 });
        mouse(header, "mouseup", { localX: 1 });
        expect(onMenu).toHaveBeenCalledOnce();
        expect(onToggle).not.toHaveBeenCalled();
    });

    it("after a drag starts every move is reported, including returning to the press row", () => {
        const { header, onDrag, onToggle } = makeHeader();
        header.setDragEnabled(true);
        mouse(header, "mousedown", { localX: 2, screenY: 5 });
        mouse(header, "mousemove", { localX: 2, screenY: 7 });
        mouse(header, "mousemove", { localX: 2, screenY: 5 });
        expect(onDrag.mock.calls.map(([y]: unknown[]) => y)).toEqual([7, 5]);
        mouse(header, "mouseup", { localX: 2, screenY: 5 });
        expect(onToggle).not.toHaveBeenCalled();
    });

    it("moving only along X in the press row is not a drag, release stays a click", () => {
        const { header, onDrag, onToggle } = makeHeader();
        header.setDragEnabled(true);
        mouse(header, "mousedown", { localX: 2, screenY: 5 });
        mouse(header, "mousemove", { localX: 5, screenY: 5 });
        mouse(header, "mouseup", { localX: 5, screenY: 5 });
        expect(onDrag).not.toHaveBeenCalled();
        expect(onToggle).toHaveBeenCalledOnce();
    });

    it("mouseup without a press and the right button do not collapse", () => {
        const { header, onToggle } = makeHeader();
        mouse(header, "mouseup", { localX: 2 });
        mouse(header, "mousedown", { localX: 2, button: "right" });
        mouse(header, "mouseup", { localX: 2, button: "right" });
        expect(onToggle).not.toHaveBeenCalled();
    });
});

describe("PaneHeaderElement — non-collapsible (collapsible: false)", () => {
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

    it("a header click outside the ⋯ zone does not call onToggle", () => {
        const { header, onToggle, onMenu } = makeFixedHeader();
        mouse(header, "mousedown", { localX: 2 });
        mouse(header, "mouseup", { localX: 2 });
        expect(onToggle).not.toHaveBeenCalled();
        expect(onMenu).not.toHaveBeenCalled();
    });

    it("a click in the ⋯ zone still opens the menu", () => {
        const { header, onToggle, onMenu } = makeFixedHeader();
        mouse(header, "mousedown", { localX: 28 });
        mouse(header, "mouseup", { localX: 28 });
        expect(onMenu).toHaveBeenCalledOnce();
        expect(onToggle).not.toHaveBeenCalled();
    });

    it("no chevron in the header, inspectState reflects collapsible", () => {
        const { header } = makeFixedHeader();
        expect(header.inspectState()).toMatchObject({ title: "SEARCH", collapsible: false });
    });
});

describe("PaneHeaderElement — inline buttons and widget", () => {
    it("a button click calls onAction, not collapse", () => {
        const { header, onToggle } = makeHeader();
        const onAction = vi.fn();
        header.onAction = onAction;
        header.setActions([{ id: "explorer.newFile", icon: "N" }]);
        header.layout(BoxConstraints.tight(new Size(30, 1)));

        mouse(header, "mousedown", { localX: 25 });
        mouse(header, "mouseup", { localX: 25 });
        expect(onAction).toHaveBeenCalledWith("explorer.newFile");
        expect(onToggle).not.toHaveBeenCalled();
    });

    it("setTitle changes the section label", () => {
        const { header } = makeHeader();
        header.setTitle("SOURCE CONTROL");
        expect(header.inspectState()).toMatchObject({ title: "SOURCE CONTROL" });
    });

    it("the title widget lands in the header tree", () => {
        const { header } = makeHeader();
        const widget = new FillerElement();
        widget.id = "channel-picker";
        header.setTitleWidget(widget);
        header.layout(BoxConstraints.tight(new Size(30, 1)));
        expect(header.querySelector("#channel-picker")).toBe(widget);
    });
});
