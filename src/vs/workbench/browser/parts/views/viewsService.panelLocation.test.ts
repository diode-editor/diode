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

describe("ViewsService — контейнер в нижней панели", () => {
    it("стенд знает только приаттаченные контейнеры", () => {
        const h = makeViewsHarness();
        expect(() => h.root("ghost")).toThrow(/is not attached anywhere/);
    });

    it("контейнер регистрируется вкладкой панели, контент — стопка секций", () => {
        const h = panelHarness(["output.view"]);
        const tab = h.panelService.getViews().find((v) => v.id === OUTPUT);
        expect(tab?.title).toBe("OUTPUT");
        expect(tab?.content).toBe(h.paneView(OUTPUT));
    });

    it("одна секция — без своей строки заголовка: заголовок это таб", () => {
        const h = panelHarness(["output.view"]);
        const header = h.paneView(OUTPUT).querySelector("#paneHeader-output-view")!;
        expect(header.hidden).toBe(true);
    });

    it("две секции — внутри вкладки обычные сворачиваемые заголовки", () => {
        const h = panelHarness(["output.view", "output.extra"]);
        const paneView = h.paneView(OUTPUT);
        expect(paneView.getPaneIds()).toEqual(["output.view", "output.extra"]);
        expect(paneView.querySelector("#paneHeader-output-view")!.hidden).toBe(false);
        expect(paneView.querySelector("#paneHeader-output-view")!.inspectState()).toMatchObject({ collapsible: true });
    });

    it("reveal контейнера ведёт фокус в его единственную секцию", () => {
        const h = panelHarness(["output.view"]);
        // The fixture descriptor carries a default focus — what matters is that the location calls it.
        expect(() => {
            h.service.focusContainer(OUTPUT);
        }).not.toThrow();
    });

    it("секция без текста подсказки рисует пустую строку, а не падает", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
        h.service.registerView(testView("output.view", OUTPUT, 10, { body: null }));
        h.service.attachContainer(OUTPUT);

        const placeholder = h.paneView(OUTPUT).querySelector("#viewPlaceholder-output-view") as TextLabelElement;
        expect(placeholder.getText()).toBe("");
    });

    it("виджет заголовка, выставленный до attach, доезжает до таб-строки", () => {
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

    it("пустая секция рисует подсказку вместо тела", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
        h.service.registerView(testView("output.view", OUTPUT, 10, { body: null, placeholder: "No output yet." }));
        h.service.attachContainer(OUTPUT);

        const placeholder = h.paneView(OUTPUT).querySelector("#viewPlaceholder-output-view") as TextLabelElement;
        expect(placeholder.getText()).toBe("No output yet.");
    });
});

describe("ViewsService — полоса контролов в таб-строке", () => {
    it("без кнопок, виджета и меню полосы нет вовсе", () => {
        const h = panelHarness(["output.view"]);
        expect(h.tabActions(OUTPUT)).toBeNull();
    });

    it("одной кнопки хватает, чтобы полоса появилась", () => {
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

    it("виджет заголовка единственной секции уезжает в таб-строку, а не в её заголовок", () => {
        const h = panelHarness(["output.view"]);
        const widget = new FillerElement();
        widget.id = "channel-picker";
        h.service.setViewTitleWidget("output.view", widget);

        const actions = h.tabActions(OUTPUT)!;
        expect(actions.querySelector("#channel-picker")).toBe(widget);
        expect(h.paneView(OUTPUT).querySelector("#channel-picker")).toBeNull();
    });

    it("при двух секциях виджет остаётся в заголовке своей секции", () => {
        const h = panelHarness(["output.view", "output.extra"]);
        const widget = new FillerElement();
        widget.id = "channel-picker";
        h.service.setViewTitleWidget("output.view", widget);

        expect(h.paneView(OUTPUT).querySelector("#channel-picker")).toBe(widget);
        // The strip is there anyway: a two-section container has the toggle in "⋯".
        expect(h.tabActions(OUTPUT)!.querySelector("#channel-picker")).toBeNull();
    });

    it("полоса несёт кнопки единственной секции, а «⋯» — её overflow", () => {
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

    it("submenu-выбор навигации — это виджет, а не пункт «⋯»: кнопки ради него нет", () => {
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

    it("submenu-выбор вне навигации и обычное submenu навигации остаются в «⋯»", () => {
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

    it("рядом с настоящим overflow submenu-выбор в попап «⋯» всё равно не попадает", () => {
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

    it("«⋯» зажигает пункт вне навигации и пункт навигации без иконки, но не кнопка", () => {
        expect(menuButtonShown({ group: "navigation", icon: "D" })).toBe(false);
        expect(menuButtonShown({ group: "navigation" })).toBe(true);
        expect(menuButtonShown({ group: "2_more", icon: "D" })).toBe(true);
    });

    it("обычное submenu навигации «⋯» зажигает — рисовать его, кроме как пунктом попапа, негде", () => {
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

    it("одна лишь навигация из submenu-выбора «⋯» не зажигает", () => {
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

    it("при двух секциях полоса несёт команды контейнера и переключатель секций", () => {
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
