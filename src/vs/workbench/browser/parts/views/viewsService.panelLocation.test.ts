import { describe, expect, it } from "vitest";

import { FillerElement } from "../../../../../../tuidom/ui/layout/fillerElement.ts";
import type { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import type { MenuContribution } from "../../../../platform/actions/common/iMenuContribution.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { containerMenuVisible, viewMenuVisible } from "../../actions/menuContexts.ts";

import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";

const OUTPUT = "workbench.panel.output";

/**
 * Контейнер в нижней панели — та же модель, что вьюлет сайдбара, только место
 * другое: заголовком служит таб, поэтому единственная секция рисуется без своей
 * строки заголовка, а её кнопки и виджет уезжают в таб-строку.
 */
function panelHarness(views: string[], contributions: MenuContribution[] = []): IViewsHarness {
    const h = makeViewsHarness(contributions);
    h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
    views.forEach((id, index) => h.service.registerView(testView(id, OUTPUT, (index + 1) * 10)));
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
        // Дескриптор стенда несёт focus по умолчанию — важно, что место зовёт его.
        expect(() => h.service.focusContainer(OUTPUT)).not.toThrow();
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
        // Контейнера ещё нет — сервис только запоминает виджет.
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
        // Полоса всё равно есть: у контейнера с двумя секциями в «⋯» лежит переключатель.
        expect(h.tabActions(OUTPUT)!.querySelector("#channel-picker")).toBeNull();
    });

    it("полоса несёт кнопки единственной секции, а «⋯» — её overflow", () => {
        const h = panelHarness(["output.view"], [
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
        ]);

        const actions = h.tabActions(OUTPUT)!;
        const labels = actions.querySelectorAll("TextLabelElement").map((l) => (l as TextLabelElement).getText().trim());
        // Пустое название, кнопка, разделитель, «⋯».
        expect(labels).toEqual(["", "C", "\u2502", "⋯"]);

        h.header(OUTPUT)!.onMenu?.({ screenX: 0, screenY: 0 });
        expect(h.shown.at(-1)!.getEntries!().map((e) => (e.type === "separator" ? "---" : e.label))).toEqual([
            "Open Output in Editor",
        ]);
    });

    it("при двух секциях полоса несёт команды контейнера и переключатель секций", () => {
        const h = panelHarness(["output.view", "output.extra"], [
            {
                menuId: MenuId.ViewContainerTitle,
                command: "output.maximize",
                title: "Maximize Panel",
                group: "1_panel",
                visible: containerMenuVisible(OUTPUT),
            },
        ]);

        h.header(OUTPUT)!.onMenu?.({ screenX: 0, screenY: 0 });
        expect(h.shown.at(-1)!.getEntries!().map((e) => (e.type === "separator" ? "---" : e.label))).toEqual([
            "Maximize Panel",
            "---",
            "Views",
        ]);
        expect(h.tabActions(OUTPUT)).not.toBeNull();
    });
});
