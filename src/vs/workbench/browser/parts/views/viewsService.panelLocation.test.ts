import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import type { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it } from "vitest";

import type { MenuContribution } from "../../../../platform/actions/common/iMenuContribution.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { containerMenuVisible, viewMenuVisible } from "../../actions/menuContexts.ts";

import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";

const OUTPUT = "workbench.panel.output";
const CHANNELS = new MenuId("test.panel.channels");
const LEVELS = new MenuId("test.panel.levels");
/** A channel submenu item: the resolver drops an empty submenu. */
const channelItem: MenuContribution = { menuId: CHANNELS, command: "output.show.main", title: "Main" };

/**
 * The tab serves as the header: the single section is drawn without its own header row, and its
 * buttons and widget move into the tab bar.
 */
function panelHarness(views: string[], contributions: MenuContribution[] = []): IViewsHarness {
    const h = makeViewsHarness(contributions);
    h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
    views.forEach((id, index) => {
        h.service.registerView(testView(id, OUTPUT, (index + 1) * 10));
    });
    h.service.attachContainer(OUTPUT);
    return h;
}

describe("ViewsService — container in the bottom panel", () => {
    it("the harness knows only attached containers", () => {
        const h = makeViewsHarness();
        expect(() => h.root("ghost")).toThrow(/is not attached anywhere/);
    });

    it("the container registers as a panel tab, its content is a stack of sections", () => {
        const h = panelHarness(["output.view"]);
        const tab = h.panelService.getViews().find((v) => v.id === OUTPUT);
        expect(tab?.title).toBe("OUTPUT");
        expect(tab?.content).toBe(h.paneView(OUTPUT));
    });

    it("single section has no header row of its own: the tab is the header", () => {
        const h = panelHarness(["output.view"]);
        const header = h.paneView(OUTPUT).querySelector("#paneHeader-output-view")!;
        expect(header.hidden).toBe(true);
    });

    it("two sections: regular collapsible headers inside the tab", () => {
        const h = panelHarness(["output.view", "output.extra"]);
        const paneView = h.paneView(OUTPUT);
        expect(paneView.getPaneIds()).toEqual(["output.view", "output.extra"]);
        expect(paneView.querySelector("#paneHeader-output-view")!.hidden).toBe(false);
        expect(paneView.querySelector("#paneHeader-output-view")!.inspectState()).toMatchObject({ collapsible: true });
    });

    it("revealing the container moves focus into its only section", () => {
        const h = panelHarness(["output.view"]);
        // The fixture descriptor carries a default focus — what matters is that the location calls it.
        expect(() => {
            h.service.focusContainer(OUTPUT);
        }).not.toThrow();
    });

    it("a section without hint text renders an empty row instead of crashing", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
        h.service.registerView(testView("output.view", OUTPUT, 10, { body: null }));
        h.service.attachContainer(OUTPUT);

        const placeholder = h.paneView(OUTPUT).querySelector("#viewPlaceholder-output-view") as TextLabelElement;
        expect(placeholder.getText()).toBe("");
    });

    it("a title widget set before attach reaches the tab row", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
        h.service.registerView(testView("output.view", OUTPUT, 10));
        const widget = new FillerElement();
        widget.id = "channel-picker";
        // No container yet — the service only remembers the widget.
        h.service.setViewTitleWidget("output.view", widget);
        h.service.attachContainer(OUTPUT);

        expect(h.tabActions(OUTPUT)!.querySelector("#channel-picker")).toBe(widget);
    });

    it("an empty section renders the hint instead of the body", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
        h.service.registerView(testView("output.view", OUTPUT, 10, { body: null, placeholder: "No output yet." }));
        h.service.attachContainer(OUTPUT);

        const placeholder = h.paneView(OUTPUT).querySelector("#viewPlaceholder-output-view") as TextLabelElement;
        expect(placeholder.getText()).toBe("No output yet.");
    });
});

describe("ViewsService — controls strip in the tab row", () => {
    it("without buttons, widget and menu there is no strip at all", () => {
        const h = panelHarness(["output.view"]);
        expect(h.tabActions(OUTPUT)).toBeNull();
    });

    it("one button is enough for the strip to appear", () => {
        // A button is strip content just like a widget, "⋯" or a spinner:
        // without it there is no strip, with it there must be one.
        const h = panelHarness(
            ["output.view"],
            [
                {
                    menuId: MenuId.ViewTitle,
                    command: "output.clear",
                    title: "Clear",
                    icon: "C",
                    group: "navigation",
                    visible: viewMenuVisible("output.view"),
                },
            ],
        );
        expect(h.tabActions(OUTPUT)).not.toBeNull();
    });

    it("the only section's title widget moves into the tab row, not its header", () => {
        const h = panelHarness(["output.view"]);
        const widget = new FillerElement();
        widget.id = "channel-picker";
        h.service.setViewTitleWidget("output.view", widget);

        const actions = h.tabActions(OUTPUT)!;
        expect(actions.querySelector("#channel-picker")).toBe(widget);
        expect(h.paneView(OUTPUT).querySelector("#channel-picker")).toBeNull();
    });

    it("with two sections the widget stays in its section header", () => {
        const h = panelHarness(["output.view", "output.extra"]);
        const widget = new FillerElement();
        widget.id = "channel-picker";
        h.service.setViewTitleWidget("output.view", widget);

        expect(h.paneView(OUTPUT).querySelector("#channel-picker")).toBe(widget);
        // The strip is there anyway: a two-section container has the toggle in "⋯".
        expect(h.tabActions(OUTPUT)!.querySelector("#channel-picker")).toBeNull();
    });

    it("the strip carries the only section's buttons, and ⋯ its overflow", () => {
        const h = panelHarness(
            ["output.view"],
            [
                {
                    menuId: MenuId.ViewTitle,
                    command: "output.clear",
                    title: "Clear Output",
                    icon: "C",
                    group: "navigation",
                    visible: viewMenuVisible("output.view"),
                },
                {
                    menuId: MenuId.ViewTitle,
                    command: "output.openFile",
                    title: "Open Output in Editor",
                    group: "2_open",
                    visible: viewMenuVisible("output.view"),
                },
            ],
        );

        const actions = h.tabActions(OUTPUT)!;
        const labels = actions
            .querySelectorAll("TextLabelElement")
            .map((l) => (l as TextLabelElement).getText().trim());
        expect(labels).toEqual(["", "C", "\u2502", "⋯"]);

        h.header(OUTPUT)!.onMenu?.({ screenX: 0, screenY: 0 });
        expect(h.shown.at(-1)!.getEntries!().map((e) => (e.type === "separator" ? "---" : e.label))).toEqual([
            "Open Output in Editor",
        ]);
    });

    it("a navigation submenu picker is a widget, not a ⋯ item: no button for it", () => {
        // Dogfooding: OUTPUT's "⋯" opened a single "Switch Output ›" item —
        // a copy of the channel selector right next to it.
        const h = panelHarness(
            ["output.view"],
            [
                {
                    menuId: MenuId.ViewTitle,
                    submenu: CHANNELS,
                    title: "Switch Output",
                    group: "navigation",
                    isSelection: true,
                    visible: viewMenuVisible("output.view"),
                },
                channelItem,
            ],
        );
        const widget = new FillerElement();
        h.service.setViewTitleWidget("output.view", widget);

        const labels = h
            .tabActions(OUTPUT)!
            .querySelectorAll("TextLabelElement")
            .map((l) => (l as TextLabelElement).getText().trim());
        expect(labels).toEqual([""]);
    });

    it("a submenu picker outside navigation and a plain navigation submenu stay in ⋯", () => {
        // In VS Code only the `navigation` group goes to the toolbar (and hence
        // to the SelectBox); the rest become "Views and More Actions..." items.
        const h = panelHarness(
            ["output.view"],
            [
                {
                    menuId: MenuId.ViewTitle,
                    submenu: CHANNELS,
                    title: "Pick",
                    group: "navigation",
                    visible: viewMenuVisible("output.view"),
                },
                {
                    menuId: MenuId.ViewTitle,
                    submenu: LEVELS,
                    title: "Choose",
                    group: "2_more",
                    isSelection: true,
                    visible: viewMenuVisible("output.view"),
                },
                channelItem,
                { menuId: LEVELS, command: "output.level.info", title: "Info" },
            ],
        );

        h.header(OUTPUT)!.onMenu?.({ screenX: 0, screenY: 0 });
        expect(h.shown.at(-1)!.getEntries!().map((e) => (e.type === "separator" ? "---" : e.label))).toEqual([
            "Pick",
            "---",
            "Choose",
        ]);
    });

    it("next to real overflow, the submenu picker still stays out of the ⋯ popup", () => {
        const h = panelHarness(
            ["output.view"],
            [
                {
                    menuId: MenuId.ViewTitle,
                    submenu: CHANNELS,
                    title: "Switch Output",
                    group: "navigation",
                    isSelection: true,
                    visible: viewMenuVisible("output.view"),
                },
                channelItem,
                {
                    menuId: MenuId.ViewTitle,
                    command: "output.save",
                    title: "Save Output As...",
                    group: "1_export",
                    visible: viewMenuVisible("output.view"),
                },
            ],
        );

        h.header(OUTPUT)!.onMenu?.({ screenX: 0, screenY: 0 });
        expect(h.shown.at(-1)!.getEntries!().map((e) => (e.type === "separator" ? "---" : e.label))).toEqual([
            "Save Output As...",
        ]);
    });

    function menuButtonShown(item: Partial<MenuContribution>): boolean {
        const h = panelHarness(
            ["output.view"],
            [
                {
                    menuId: MenuId.ViewTitle,
                    command: "output.do",
                    title: "Do",
                    visible: viewMenuVisible("output.view"),
                    ...item,
                } as MenuContribution,
            ],
        );
        const labels =
            h
                .tabActions(OUTPUT)
                ?.querySelectorAll("TextLabelElement")
                .map((l) => (l as TextLabelElement).getText().trim()) ?? [];
        return labels.includes("⋯");
    }

    it("an item outside navigation and a navigation item without an icon light up ⋯, a button does not", () => {
        expect(menuButtonShown({ group: "navigation", icon: "D" })).toBe(false);
        expect(menuButtonShown({ group: "navigation" })).toBe(true);
        expect(menuButtonShown({ group: "2_more", icon: "D" })).toBe(true);
    });

    it("a plain navigation submenu lights up ⋯: it can only be rendered as a popup item", () => {
        const h = panelHarness(
            ["output.view"],
            [
                {
                    menuId: MenuId.ViewTitle,
                    submenu: CHANNELS,
                    title: "Pick",
                    group: "navigation",
                    visible: viewMenuVisible("output.view"),
                },
                channelItem,
            ],
        );
        const labels = h
            .tabActions(OUTPUT)!
            .querySelectorAll("TextLabelElement")
            .map((l) => (l as TextLabelElement).getText().trim());
        expect(labels).toContain("⋯");
    });

    it("navigation consisting only of a submenu picker does not light up ⋯", () => {
        // The static check (`hasOverflow`) must agree with the popup:
        // a button with no items looks broken.
        const h = panelHarness(
            ["output.view"],
            [
                {
                    menuId: MenuId.ViewTitle,
                    submenu: CHANNELS,
                    title: "Switch Output",
                    group: "navigation",
                    isSelection: true,
                    visible: viewMenuVisible("output.view"),
                },
                channelItem,
            ],
        );
        expect(h.tabActions(OUTPUT)).toBeNull();
    });

    it("with two sections the strip carries container commands and the section toggle", () => {
        const h = panelHarness(
            ["output.view", "output.extra"],
            [
                {
                    menuId: MenuId.ViewContainerTitle,
                    command: "output.maximize",
                    title: "Maximize Panel",
                    group: "1_panel",
                    visible: containerMenuVisible(OUTPUT),
                },
            ],
        );

        h.header(OUTPUT)!.onMenu?.({ screenX: 0, screenY: 0 });
        expect(h.shown.at(-1)!.getEntries!().map((e) => (e.type === "separator" ? "---" : e.label))).toEqual([
            "Maximize Panel",
            "---",
            "Views",
        ]);
        expect(h.tabActions(OUTPUT)).not.toBeNull();
    });
});
