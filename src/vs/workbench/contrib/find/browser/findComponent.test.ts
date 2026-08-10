import { describe, expect, it, vi } from "vitest";

import type { MockTerminalBackend } from "../../../../../../tuidom/backend/mockTerminalBackend.ts";
import { BoxConstraints, Point, Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { TUIMouseEvent } from "../../../../../../tuidom/dom/events/tuiMouseEvent.ts";
import type { ButtonElement } from "../../../../../../tuidom/ui/button/buttonElement.ts";
import type { InputElement } from "../../../../../../tuidom/ui/inputbox/inputElement.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { FindWidget } from "./findComponent.ts";

const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);
const WIDTH = 44;

function make(): FindWidget {
    return new FindWidget();
}

/**
 * Lays out + renders the widget so button positions/colors are populated.
 * `resolveStyles` is needed so the counter `TextLabel` resolves its themed fg
 * (per-element style inheritance; the real app runs this in its render pipeline).
 */
function render(component: FindWidget, width = WIDTH): MockTerminalBackend {
    return renderElement(component.view, width, 3, { resolveStyles: true });
}

/** The three nav buttons in tree order: [prev, next, close]. */
function buttons(component: FindWidget): ButtonElement[] {
    return component.view.querySelectorAll("ButtonElement") as ButtonElement[];
}

function input(component: FindWidget): InputElement {
    return component.view.querySelector("InputElement") as InputElement;
}

function mouse(type: "click" | "mouseenter" | "mouseleave"): TUIMouseEvent {
    return new TUIMouseEvent(type, { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 });
}

/** Resolves the element at a screen point and dispatches a left click on it. */
function clickAt(component: FindWidget, x: number, y: number): void {
    const target = component.view.elementFromPoint(new Point(x, y));
    target?.dispatchEvent(mouse("click"));
}

describe("FindWidget — root sizing", () => {
    it("renders at the preferred width and a fixed 3-row height", () => {
        const component = make();
        const size = component.view.layout(BoxConstraints.loose(new Size(80, 10)));
        expect(size).toEqual(new Size(WIDTH, 3));
    });

    it("shrinks to the available width when constrained", () => {
        const component = make();
        const size = component.view.layout(BoxConstraints.loose(new Size(30, 3)));
        expect(size).toEqual(new Size(30, 3));
    });
});

describe("FindWidget — button clicks", () => {
    it("invokes onPrev / onNext / onClose when the matching button is clicked", () => {
        const component = make();
        const onPrev = vi.fn();
        const onNext = vi.fn();
        const onClose = vi.fn();
        component.onPrev = onPrev;
        component.onNext = onNext;
        component.onClose = onClose;
        render(component);

        const [prev, next, close] = buttons(component);
        clickAt(component, prev.globalPosition.x, prev.globalPosition.y);
        clickAt(component, next.globalPosition.x, next.globalPosition.y);
        clickAt(component, close.globalPosition.x, close.globalPosition.y);

        expect(onPrev).toHaveBeenCalledOnce();
        expect(onNext).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("ignores clicks that land on the input rather than a button", () => {
        const component = make();
        const onClose = vi.fn();
        component.onClose = onClose;
        render(component);

        // Column 2, row 1 sits inside the query input, not on a button.
        clickAt(component, 2, 1);

        expect(onClose).not.toHaveBeenCalled();
    });

    it("keeps focus in the input — the nav buttons are non-focusable", () => {
        const component = make();
        expect(buttons(component).every((b) => !b.focusable)).toBe(true);
    });
});

describe("FindWidget — hover", () => {
    it("highlights a button on mouseenter and reverts on mouseleave", () => {
        const component = make();
        render(component);
        const hoverBg = theme.getRequiredColor("button.secondaryHoverBackground");
        const restBg = theme.getRequiredColor("button.secondaryBackground");

        const next = buttons(component)[1];
        const x = next.globalPosition.x;

        next.setStyleState("hover", true);
        expect(render(component).getBgAt(new Point(x, 1))).toBe(hoverBg);

        next.setStyleState("hover", false);
        expect(render(component).getBgAt(new Point(x, 1))).toBe(restBg);
    });
});

describe("FindWidget — theme colors", () => {
    it("paints the border and background from editorWidget.* keys", () => {
        const component = make();
        const backend = render(component);
        // Top-left corner is the box border.
        expect(backend.getFgAt(new Point(0, 0))).toBe(theme.getRequiredColor("editorWidget.border"));
        // The frame fill (top border row, between the corners) carries the widget background.
        expect(backend.getBgAt(new Point(2, 0))).toBe(theme.getRequiredColor("editorWidget.background"));
    });
});

describe("FindWidget — counter", () => {
    it("shows nothing while the query is empty", () => {
        const component = make();
        component.setCounter(1, 3);
        expect(render(component).screenToString()).not.toContain("of");
    });

    it("renders «{i} of {n}» once a query is present", () => {
        const component = make();
        component.setQuery("foo");
        component.setCounter(1, 3);
        expect(render(component).screenToString()).toContain("1 of 3");
    });

    it("renders «No results» with the error color when there are no matches", () => {
        const component = make();
        component.setQuery("zzz");
        component.setCounter(0, 0);
        const backend = render(component);
        const screen = backend.screenToString();
        expect(screen).toContain("No results");

        const rows = screen.split("\n");
        const y = rows.findIndex((row) => row.includes("No results"));
        const x = rows[y].indexOf("No results");
        expect(backend.getFgAt(new Point(x, y))).toBe(theme.getRequiredColor("editorError.foreground"));
    });
});

describe("FindWidget — focus", () => {
    it("focus() delegates to the query input", () => {
        const component = make();
        const testApp = TestApp.createWithContent(component.view, new Size(80, 24));
        component.focus();
        expect(testApp.focusedElement).toBe(input(component));
    });
});
