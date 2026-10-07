import { Size } from "@tuidom/core/common/geometryPromitives";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import { TerminalTabbedViewElement } from "./terminalTabbedViewElement.ts";

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
        view.setTerminal(second); // повтор — no-op
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
        // Терминал — сразу за чертой, на всю оставшуюся ширину.
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
        expect(view.getChildren()).toEqual([tabs]);
    });

    it("never gives the tabs more than half of a narrow panel", () => {
        const tabs = new TextLabelElement("tabs");
        const view = new TerminalTabbedViewElement(tabs, 30);
        view.setTerminal(new TextLabelElement("t"));
        view.setTabsVisible(true);
        view.setTabsVisible(true); // повтор — no-op
        view.setLocation("right");
        TestApp.createWithContent(view, new Size(40, 3)).render();
        expect(tabs.layoutSize.width).toBe(20);
        expect(tabs.globalPosition.x).toBe(20);
    });
});
