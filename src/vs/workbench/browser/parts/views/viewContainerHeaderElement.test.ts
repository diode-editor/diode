import { describe, expect, it, vi } from "vitest";

import { BoxConstraints, Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { TUIContextMenuEvent, TUIMouseEvent } from "../../../../../../tuidom/dom/events/tuiMouseEvent.ts";

import { ViewContainerHeaderElement } from "./viewContainerHeaderElement.ts";

function makeHeader(width = 30): {
    header: ViewContainerHeaderElement;
    onMenu: ReturnType<typeof vi.fn>;
    onAction: ReturnType<typeof vi.fn>;
} {
    const header = new ViewContainerHeaderElement("SOURCE CONTROL");
    const onMenu = vi.fn();
    const onAction = vi.fn();
    header.onMenu = onMenu;
    header.onAction = onAction;
    header.setActions([{ id: "scm.refresh", icon: "R" }]);
    header.layout(BoxConstraints.tight(new Size(width, 1)));
    return { header, onMenu, onAction };
}

function mouse(
    header: ViewContainerHeaderElement,
    type: "mousedown" | "mouseup",
    init: { localX?: number; button?: "left" | "right" } = {},
): void {
    header.dispatchEvent(
        new TUIMouseEvent(type, {
            button: init.button ?? "left",
            screenX: init.localX ?? 0,
            screenY: 0,
            localX: init.localX ?? 0,
            localY: 0,
        }),
    );
}

describe("ViewContainerHeaderElement", () => {
    it("одна строка, название и inspectState", () => {
        const { header } = makeHeader();
        expect(header.getMinIntrinsicHeight(30)).toBe(1);
        expect(header.getMaxIntrinsicHeight(30)).toBe(1);
        expect(header.inspectState()).toEqual({ title: "SOURCE CONTROL" });
        header.setTitle("SCM");
        expect(header.inspectState()).toEqual({ title: "SCM" });
    });

    it("клик по ⋯ открывает меню, клик по кнопке — её действие", () => {
        const { header, onMenu, onAction } = makeHeader();
        mouse(header, "mousedown", { localX: 28 });
        mouse(header, "mouseup", { localX: 28 });
        expect(onMenu).toHaveBeenCalledWith({ screenX: 28, screenY: 0 });

        mouse(header, "mousedown", { localX: 25 });
        mouse(header, "mouseup", { localX: 25 });
        expect(onAction).toHaveBeenCalledWith("scm.refresh");
    });

    it("клик по названию ничего не делает — контейнер не сворачивается", () => {
        const { header, onMenu, onAction } = makeHeader();
        mouse(header, "mousedown", { localX: 3 });
        mouse(header, "mouseup", { localX: 3 });
        expect(onMenu).not.toHaveBeenCalled();
        expect(onAction).not.toHaveBeenCalled();
    });

    it("mouseup без нажатия и правая кнопка мимо — не срабатывают", () => {
        const { header, onMenu } = makeHeader();
        mouse(header, "mouseup", { localX: 28 });
        mouse(header, "mousedown", { localX: 28, button: "right" });
        mouse(header, "mouseup", { localX: 28, button: "right" });
        expect(onMenu).not.toHaveBeenCalled();
    });

    it("Shift+F10 якорит меню к кнопке ⋯, правый клик — к курсору", () => {
        const { header, onMenu } = makeHeader();
        header.dispatchEvent(new TUIContextMenuEvent({ trigger: "keyboard", button: "right", screenX: 0, screenY: 0, localX: 0, localY: 0 }));
        expect(onMenu).toHaveBeenLastCalledWith({ screenX: 27, screenY: 0 });

        header.dispatchEvent(new TUIContextMenuEvent({ trigger: "mouse", button: "right", screenX: 11, screenY: 4, localX: 11, localY: 0 }));
        expect(onMenu).toHaveBeenLastCalledWith({ screenX: 11, screenY: 4 });
    });
});
