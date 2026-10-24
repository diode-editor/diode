import { BoxConstraints, Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { OverlayHostElement } from "@tuidom/elements/contextview/overlayHostElement";
import type { InputElement } from "@tuidom/elements/inputbox/inputElement";
import type { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { MATCHES_LIMIT } from "../../../../editor/contrib/find/findMatches.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { FindWidget } from "./findComponent.ts";

const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);
const WIDTH = 44;

function make(): FindWidget {
    return new FindWidget();
}

/** `resolveStyles` so the counter gets the theme color (in the app the render pipeline does this). */
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

    it("renders «19999+» when the collection stopped at the upstream limit", () => {
        const component = make();
        component.setQuery("e");
        component.setCounter(7, MATCHES_LIMIT);
        expect(render(component).screenToString()).toContain("7 of 19999+");
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

    /** The walk over a document on disk runs in the background: the counter shows what it has found so far. */
    describe("while the search is still running", () => {
        it("renders «Searching…» in the description color, not the red «No results», while nothing is found yet", () => {
            const component = make();
            component.setQuery("zzz");
            component.setCounter(0, 0, true);
            const backend = render(component);
            const screen = backend.screenToString();
            expect(screen).toContain("Searching…");
            expect(screen).not.toContain("No results");
            const rows = screen.split("\n");
            const y = rows.findIndex((row) => row.includes("Searching"));
            const x = rows[y].indexOf("Searching");
            expect(backend.getFgAt(new Point(x, y))).not.toBe(theme.getRequiredColor("editorError.foreground"));
        });

        it("renders «{i} of {n}…» with the count so far, and «? of {n}…» before a match after the cursor is in", () => {
            const component = make();
            component.setQuery("foo");
            component.setCounter(2, 57, true);
            expect(render(component).screenToString()).toContain("2 of 57…");
            component.setCounter(0, 57, true);
            expect(render(component).screenToString()).toContain("? of 57…");
            component.setCounter(2, 57);
            expect(render(component).screenToString()).toContain("2 of 57 ");
        });

        it("the limit reached ends the search: «19999+» without the ellipsis", () => {
            const component = make();
            component.setQuery("e");
            component.setCounter(1, MATCHES_LIMIT);
            expect(render(component).screenToString()).toContain("1 of 19999+ ");
        });
    });
});

describe("FindWidget — overlay session", () => {
    it("show() before attachHost is a no-op: the widget does not open and does not crash", () => {
        const component = make();

        expect(() => {
            component.show();
        }).not.toThrow();

        expect(component.isOpen()).toBe(false);
    });

    it("a repeated attachHost with the same host is a no-op, the live session is not recreated", () => {
        const component = make();
        const host = new OverlayHostElement();
        component.attachHost(host);
        component.show();
        expect(component.isOpen()).toBe(true);

        // Same host again: without the guard the session would be recreated closed.
        component.attachHost(host);

        expect(component.isOpen()).toBe(true);
    });

    it("hide() without an open session is a no-op", () => {
        const component = make();

        expect(() => {
            component.hide();
        }).not.toThrow();

        expect(component.isOpen()).toBe(false);
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
