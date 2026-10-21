import { BoxConstraints, Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIContextMenuEvent, TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import { ViewContainerHeaderElement } from "./viewContainerHeaderElement.ts";

/** Engine mouse token (1-based coordinates, as in the terminal). */
function token(overrides: Partial<MouseToken>): MouseToken {
    return {
        kind: "mouse",
        action: "press",
        button: "left",
        x: 1,
        y: 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
        ...overrides,
    };
}

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
    type: "mousedown" | "mouseup" | "mousemove" | "mouseleave",
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
        expect(header.inspectState()).toEqual({ title: "SOURCE CONTROL", busy: false });
        header.setTitle("SCM");
        expect(header.inspectState()).toEqual({ title: "SCM", busy: false });
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

    it("полоса контролов: виджет, скрытая «⋯» и интринсик-ширина по содержимому", () => {
        const header = new ViewContainerHeaderElement("");
        const widget = new FillerElement();
        widget.id = "channel-picker";
        header.setActions([{ id: "out.clear", icon: "C" }]);
        header.setTitleWidget(widget);
        header.setMenuVisible(false);
        header.layout(BoxConstraints.tight(new Size(30, 1)));

        expect(header.querySelector("#channel-picker")).toBe(widget);
        // Empty title (1 column of padding) + the button; "⋯" is removed.
        expect(header.getMaxIntrinsicWidth(1)).toBe(1 + 3);
    });

    it("перехваченный кем-то mouseup меню не открывает", () => {
        const { header, onMenu } = makeHeader();
        mouse(header, "mousedown", { localX: 28 });
        const up = new TUIMouseEvent("mouseup", {
            button: "left",
            screenX: 28,
            screenY: 0,
            localX: 28,
            localY: 0,
        });
        up.preventDefault();
        header.dispatchEvent(up);
        expect(onMenu).not.toHaveBeenCalled();
    });

    it("клик через приложение доходит до заголовка, а не до его лейблов", () => {
        // Hit testing of children is off, otherwise the section's pointer capture wouldn't work;
        // test with a real click through the tree, not dispatchEvent.
        const header = new ViewContainerHeaderElement("SOURCE CONTROL");
        const onMenu = vi.fn();
        header.onMenu = onMenu;
        const app = TestApp.createWithContent(header, new Size(30, 1));
        app.render();

        app.backend.simulateMouse(token({ action: "press", x: 29, y: 1 }));
        app.backend.simulateMouse(token({ action: "release", x: 29, y: 1 }));
        expect(onMenu).toHaveBeenCalledOnce();
    });

    it("виджет в заголовке кликается: мышь доходит до него, а не до заголовка", () => {
        // Regression: the header took the mouse from ALL children, so the Output
        // channel picker rendered but couldn't be clicked.
        const header = new ViewContainerHeaderElement("");
        // A widget with non-zero intrinsic width; a filler would collapse to zero.
        const widget = new TextLabelElement("bootstrap");
        widget.id = "channel-picker";
        header.setTitleWidget(widget);
        const app = TestApp.createWithContent(header, new Size(30, 1));
        app.render();

        const hit = app.root.elementFromPoint(new Point(widget.globalPosition.x, widget.globalPosition.y));
        expect(hit).toBe(widget);
        expect(app.root.elementFromPoint(new Point(header.globalPosition.x, header.globalPosition.y))).toBe(header);
    });

    it("наведение подсвечивает кнопку под курсором, уход — гасит", () => {
        const { header } = makeHeader();
        const bg = (x: number): number => renderElement(header, 30, 1, { themeVars: true }).getBgAt(new Point(x, 0));
        const restBg = bg(25);

        mouse(header, "mousemove", { localX: 25 });
        expect(bg(25)).not.toBe(restBg);

        mouse(header, "mouseleave");
        expect(bg(25)).toBe(restBg);
    });

    it("Shift+F10 якорит меню к кнопке ⋯, правый клик — к курсору", () => {
        const { header, onMenu } = makeHeader();
        header.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "keyboard",
                button: "right",
                screenX: 0,
                screenY: 0,
                localX: 0,
                localY: 0,
            }),
        );
        expect(onMenu).toHaveBeenLastCalledWith({ screenX: 27, screenY: 0 });

        header.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "mouse",
                button: "right",
                screenX: 11,
                screenY: 4,
                localX: 11,
                localY: 0,
            }),
        );
        expect(onMenu).toHaveBeenLastCalledWith({ screenX: 11, screenY: 4 });
    });
});
