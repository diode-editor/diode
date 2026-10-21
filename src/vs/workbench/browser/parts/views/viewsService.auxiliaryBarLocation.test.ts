import { describe, expect, it } from "vitest";

import type { MenuContribution } from "../../../../platform/actions/common/iMenuContribution.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";

import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";

const AUX = "test.auxiliary.container";
const PANEL = "test.panel.container";
const REFRESH: MenuContribution = {
    menuId: MenuId.ViewTitle,
    command: "aux.refresh",
    title: "Refresh",
    icon: "R",
    group: "navigation",
};

/** Та же модель, что у нижней панели (у эталона обе — `AbstractPaneCompositePart`), реестр — `AuxiliaryBarService`. */
function auxiliaryHarness(views: string[], contributions: MenuContribution[] = []): IViewsHarness {
    const h = makeViewsHarness(contributions);
    h.service.registerContainer({ id: AUX, title: "AUX", location: "auxiliarybar" });
    views.forEach((id, index) => {
        h.service.registerView(testView(id, AUX, (index + 1) * 10));
    });
    h.service.attachContainer(AUX);
    return h;
}

describe("ViewsService — контейнер во вторичной боковой панели", () => {
    it("регистрируется вкладкой вторичной панели, а не нижней и не вьюлетом", () => {
        const h = auxiliaryHarness(["aux.view"]);
        const tab = h.auxiliaryBarService.getViews().find((v) => v.id === AUX);
        expect(tab?.title).toBe("AUX");
        expect(tab?.content).toBe(h.paneView(AUX));
        expect(h.panelService.getViews()).toEqual([]);
        expect(h.viewlets).toEqual([]);
    });

    it("одна секция — без своей строки заголовка: заголовок это таб", () => {
        const h = auxiliaryHarness(["aux.view"]);
        expect(h.paneView(AUX).querySelector("#paneHeader-aux-view")!.hidden).toBe(true);
    });

    it("порядок вкладок — по order и только среди контейнеров этой части", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: PANEL, title: "P", location: "panel", order: 0 });
        h.service.registerContainer({ id: "aux.b", title: "B", location: "auxiliarybar", order: 2 });
        h.service.registerContainer({ id: "aux.a", title: "A", location: "auxiliarybar", order: 1 });
        for (const id of [PANEL, "aux.b", "aux.a"]) h.service.registerView(testView(`${id}.view`, id, 10));
        h.service.attachContainer(PANEL);
        h.service.attachContainer("aux.b");
        h.service.attachContainer("aux.a");
        expect(h.auxiliaryBarService.getViews().map((v) => v.id)).toEqual(["aux.a", "aux.b"]);
        expect(h.panelService.getViews().map((v) => v.id)).toEqual([PANEL]);
    });

    it("кнопки единственной секции уезжают в таб-строку вторичной панели", () => {
        const h = auxiliaryHarness(["aux.view"], [REFRESH]);
        expect(h.tabActions(AUX)).not.toBeNull();
    });

    it("без кнопок полосы в таб-строке нет", () => {
        const h = auxiliaryHarness(["aux.view"]);
        expect(h.tabActions(AUX)).toBeNull();
    });

    it("контейнер, ставший активной вкладкой вторичной панели, досчитывает кнопки", () => {
        const h = makeViewsHarness([REFRESH]);
        h.service.registerContainer({ id: "aux.a", title: "A", location: "auxiliarybar", order: 1 });
        h.service.registerContainer({ id: "aux.b", title: "B", location: "auxiliarybar", order: 2 });
        h.service.registerView(testView("aux.a.view", "aux.a", 10));
        h.service.registerView(testView("aux.b.view", "aux.b", 10));
        h.service.attachContainer("aux.a");
        h.service.attachContainer("aux.b");
        // Скрытая вкладка B досчитывается при показе (как вкладка нижней панели).
        h.auxiliaryBarService.setActiveView("aux.b");
        expect(h.tabActions("aux.b")).not.toBeNull();
    });
});
