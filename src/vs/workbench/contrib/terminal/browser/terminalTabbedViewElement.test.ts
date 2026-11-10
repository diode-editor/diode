import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import { TerminalTabbedViewElement, terminalTabsColumns } from "./terminalTabbedViewElement.ts";

function mouse(app: TestApp, button: MouseToken["button"], action: MouseToken["action"], x: number, y = 1): void {
    app.backend.simulateMouse({
        kind: "mouse",
        button,
        action,
        x: x + 1,
        y: y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    });
    app.render();
}

function build(tabsWidth: number, width: number, location: "left" | "right" = "right") {
    const tabs = new TextLabelElement("tabs");
    const terminal = new TextLabelElement("t");
    const view = new TerminalTabbedViewElement(tabs, tabsWidth);
    view.setTerminal(terminal);
    view.setTabsVisible(true);
    view.setLocation(location);
    const app = TestApp.createWithContent(view, new Size(width, 3));
    app.render();
    const cell = (x: number) => {
        const position = new Point(x, 1);
        return {
            text: app.backend.getTextAt(position, 1),
            fg: app.backend.getFgAt(position),
            bg: app.backend.getBgAt(position),
        };
    };
    return { tabs, terminal, view, app, cell };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("TerminalTabbedViewElement", () => {
    it("lays out the tabs alone while no terminal is set", () => {
        const tabs = new TextLabelElement("tabs");
        const view = new TerminalTabbedViewElement(tabs, 10);
        view.setTabsVisible(true);
        view.setLocation("left");
        const app = TestApp.createWithContent(view, new Size(40, 3));
        app.render();

        expect(tabs.globalPosition.x).toBe(0);
        expect(tabs.layoutSize.width).toBe(10);
        expect(app.backend.screenToString().split("\n")[0]).toContain("tabs      │");
    });

    it("gives the terminal the whole width while the tabs are hidden, and swaps terminals in place", () => {
        const tabs = new TextLabelElement("tabs");
        const view = new TerminalTabbedViewElement(tabs, 10);
        const first = new TextLabelElement("first");
        const second = new TextLabelElement("second");
        view.setTerminal(first);
        const app = TestApp.createWithContent(view, new Size(40, 3));
        app.render();
        expect(first.layoutSize.width).toBe(40);
        expect(view.isTabsVisible).toBe(false);

        view.setTerminal(second);
        view.setTerminal(second); // repeat is a no-op
        app.render();
        expect(first.getParent()).toBeNull();
        expect(second.layoutSize.width).toBe(40);
        expect(app.backend.screenToString()).not.toContain("│");
    });

    it("puts the tabs on the right by default and moves them live with setLocation", () => {
        const tabs = new TextLabelElement("tabs");
        const view = new TerminalTabbedViewElement(tabs, 10);
        const terminal = new TextLabelElement("t");
        view.setTerminal(terminal);
        view.setTabsVisible(true);
        const app = TestApp.createWithContent(view, new Size(40, 3));
        app.render();
        expect(view.id).toBe("terminalTabbedView");
        expect(tabs.globalPosition.x).toBe(30);
        expect(app.backend.screenToString().split("\n")[0][29]).toBe("│");

        view.setLocation("left");
        app.render();
        expect(tabs.globalPosition.x).toBe(0);
        expect(app.backend.screenToString().split("\n")[0][10]).toBe("│");
        expect(terminal.globalPosition.x).toBe(11);
        expect(terminal.layoutSize.width).toBe(29);

        view.setLocation("right");
        app.render();
        expect(tabs.globalPosition.x).toBe(30);
    });

    it("keeps the tabs when the terminal is taken away", () => {
        const tabs = new TextLabelElement("tabs");
        const view = new TerminalTabbedViewElement(tabs, 10);
        view.setTabsVisible(true);
        view.setTerminal(new TextLabelElement("t"));
        view.setTerminal(null);
        expect(view.getChildren()[0]).toBe(tabs);
        expect(view.getChildren()).toHaveLength(2);
    });

    it("never gives the tabs more than half of a narrow panel", () => {
        // 24 columns: the 10-column list, the divider and the 15-column terminal don't fit.
        const { tabs, view } = build(30, 24);
        view.setTabsVisible(true); // repeat is a no-op
        expect(tabs.layoutSize.width).toBe(12);
        expect(tabs.globalPosition.x).toBe(12);
    });

    it("clamps the width to [10, 62] and leaves the terminal at least 15 columns", () => {
        expect(terminalTabsColumns(20, 200)).toBe(20);
        expect(terminalTabsColumns(3, 200)).toBe(10);
        expect(terminalTabsColumns(100, 200)).toBe(62);
        expect(terminalTabsColumns(62, 78)).toBe(62);
        expect(terminalTabsColumns(62, 77)).toBe(61);
        expect(terminalTabsColumns(40, 40)).toBe(24);
        expect(terminalTabsColumns(40, 26)).toBe(10);
        expect(terminalTabsColumns(40, 25)).toBe(12);
        expect(terminalTabsColumns(4, 25)).toBe(10);
        expect(terminalTabsColumns(4, 8)).toBe(4);
    });

    it("keeps the list width when the panel resizes; the terminal takes the rest", () => {
        const { tabs, terminal, app } = build(20, 80);
        expect(tabs.layoutSize.width).toBe(20);
        expect(terminal.layoutSize.width).toBe(59);

        app.backend.resize(new Size(120, 3));
        app.render();
        expect(tabs.layoutSize.width).toBe(20);
        expect(terminal.layoutSize.width).toBe(99);

        app.backend.resize(new Size(30, 3));
        app.render();
        expect(tabs.layoutSize.width).toBe(14);
        expect(terminal.layoutSize.width).toBe(15);

        app.backend.resize(new Size(80, 3));
        app.render();
        expect(tabs.layoutSize.width).toBe(20);
    });

    it("draws the divider at rest in panel.border, and lights it in sash.hoverBorder after the hover delay", () => {
        const { view, app, cell } = build(10, 40);
        vi.useFakeTimers();
        view.setSashHoverDelay(500);
        const rest = cell(29);
        expect(rest.text).toBe("│");
        expect(rest.fg).toBe(view.styleVar("panel.border"));

        mouse(app, "none", "move", 29);
        expect(cell(29)).toEqual(rest);
        vi.advanceTimersByTime(499);
        app.render();
        expect(cell(29)).toEqual(rest);
        vi.advanceTimersByTime(1);
        app.render();
        expect(cell(29)).toEqual({ ...rest, fg: view.styleVar("sash.hoverBorder") });
        expect(app.backend.pointerShape).toBe("ew-resize");

        mouse(app, "none", "move", 5);
        expect(cell(29)).toEqual(rest);
    });

    it("dragging with the tabs on the right: left widens the list, past the panel edge it stops at the clamp", () => {
        const { view, tabs, terminal, app, cell } = build(10, 40);
        const widths: number[] = [];
        view.onDidChangeTabsWidth = (width) => widths.push(width);

        mouse(app, "left", "press", 29);
        mouse(app, "left", "move", 22);
        expect(tabs.layoutSize.width).toBe(17);
        expect(tabs.globalPosition.x).toBe(23);
        expect(terminal.layoutSize.width).toBe(22);
        expect(cell(22)).toMatchObject({ text: "│", fg: view.styleVar("sash.hoverBorder") });

        mouse(app, "left", "move", -30);
        expect(tabs.layoutSize.width).toBe(24);
        mouse(app, "left", "move", 60);
        expect(tabs.layoutSize.width).toBe(10);
        mouse(app, "left", "release", 60);
        expect(widths).toEqual([17, 24, 10]);
        expect(view.tabsColumns).toBe(10);

        // The release ends the drag: a plain move no longer resizes.
        mouse(app, "none", "move", 20);
        expect(tabs.layoutSize.width).toBe(10);
    });

    it("dragging with the tabs on the left: right widens the list", () => {
        const { view, tabs, terminal, app } = build(10, 40, "left");
        const widths: number[] = [];
        view.onDidChangeTabsWidth = (width) => widths.push(width);

        mouse(app, "left", "press", 10);
        mouse(app, "left", "move", 16);
        expect(tabs.layoutSize.width).toBe(16);
        expect(terminal.globalPosition.x).toBe(17);
        mouse(app, "left", "move", 100);
        mouse(app, "left", "release", 100);
        expect(widths).toEqual([16, 24]);
        expect(tabs.layoutSize.width).toBe(24);
    });

    it("the right button doesn't drag", () => {
        const { view, tabs, app } = build(10, 40);
        const onDrag = vi.fn();
        view.onDidChangeTabsWidth = onDrag;
        mouse(app, "right", "press", 29);
        mouse(app, "right", "move", 20);
        expect(tabs.layoutSize.width).toBe(10);
        expect(onDrag).not.toHaveBeenCalled();
    });

    it("a hidden list hides the sash too: the column is the terminal's and takes no clicks", () => {
        const { view, terminal, app } = build(10, 40);
        const onReset = vi.fn();
        view.onDidResetTabsWidth = onReset;
        view.setTabsVisible(false);
        app.render();
        expect(terminal.layoutSize.width).toBe(40);
        mouse(app, "left", "press", 29);
        mouse(app, "left", "release", 29);
        mouse(app, "left", "press", 29);
        mouse(app, "left", "release", 29);
        expect(onReset).not.toHaveBeenCalled();
        expect(app.backend.screenToString()).not.toContain("│");
    });

    it("double-click on the sash requests a reset", () => {
        const { view, app } = build(10, 40);
        const onReset = vi.fn();
        view.onDidResetTabsWidth = onReset;
        mouse(app, "left", "press", 29);
        mouse(app, "left", "release", 29);
        expect(onReset).not.toHaveBeenCalled();
        mouse(app, "left", "press", 29);
        mouse(app, "left", "release", 29);
        expect(onReset).toHaveBeenCalledTimes(1);
    });
});
