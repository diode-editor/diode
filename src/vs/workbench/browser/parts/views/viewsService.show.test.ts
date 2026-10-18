import { describe, expect, it } from "vitest";

import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";

const PROBLEMS = "workbench.panel.markers";
const TERMINAL = "workbench.panel.terminal";
const SEARCH = "workbench.view.search";

/** Панель (PROBLEMS, TERMINAL) и сайдбар (SEARCH); события показа и активации — в журналы. */
function scene(): { h: IViewsHarness; shown: string[]; activated: string[] } {
    const h = makeViewsHarness();
    h.service.registerContainer({ id: SEARCH, title: "SEARCH", location: "sidebar", order: 0 });
    h.service.registerContainer({ id: PROBLEMS, title: "PROBLEMS", location: "panel", order: 0 });
    h.service.registerContainer({ id: TERMINAL, title: "TERMINAL", location: "panel", order: 1 });
    h.service.registerView(testView("search", SEARCH, 10, { canMoveView: true }));
    h.service.registerView(testView("problems", PROBLEMS, 10, { canMoveView: true }));
    h.service.registerView(testView("terminal", TERMINAL, 10, { canMoveView: true }));
    const shown: string[] = [];
    const activated: string[] = [];
    h.service.onDidShowView((id) => shown.push(id));
    h.service.onDidActivateView((id) => activated.push(id));
    h.service.attachRegisteredContainers();
    return { h, shown, activated };
}

describe("ViewsService — вид на экране (isViewShown / closeView)", () => {
    it("вид на экране: контейнер активен в своей части и часть видна", () => {
        const { h } = scene();
        expect(h.service.isViewShown("problems")).toBe(false);
        h.panelService.setVisible(true);
        expect(h.service.isViewShown("problems")).toBe(true);
        expect(h.service.isViewShown("terminal")).toBe(false);
    });

    it("после переноса — на новом месте", () => {
        const { h } = scene();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        h.auxiliaryBarService.setVisible(true);
        expect(h.service.isViewShown("terminal")).toBe(true);
        expect(h.panelService.visible).toBe(false);
    });

    it("вьюлет сайдбара на экране, пока он активен", () => {
        const { h } = scene();
        expect(h.service.isViewShown("search")).toBe(false);
        h.showViewlet(SEARCH);
        expect(h.service.isViewShown("search")).toBe(true);
    });

    it("скрытая секция и неизвестный вид — не на экране", () => {
        const { h } = scene();
        h.service.registerView(testView("extra", PROBLEMS, 20));
        h.panelService.setVisible(true);
        h.service.setViewVisible("extra", false);
        expect(h.service.isViewShown("extra")).toBe(false);
        expect(h.service.isViewShown("ghost")).toBe(false);
    });

    it("closeView прячет часть, если вид в ней активен, и не трогает её, если вид в фоне", () => {
        const { h } = scene();
        h.panelService.setVisible(true);
        h.service.closeView("terminal");
        expect(h.panelService.visible).toBe(true);
        h.service.closeView("problems");
        expect(h.panelService.visible).toBe(false);
    });

    it("closeView вьюлета прячет сайдбар; неизвестный вид — no-op", () => {
        const { h } = scene();
        h.showViewlet(SEARCH);
        h.service.closeView("search");
        h.service.closeView("ghost");
        expect(h.hiddenViewlets).toEqual([SEARCH]);
    });
});

describe("ViewsService — openView без активации", () => {
    it("показывает вкладку и часть, но ленивые фичи не будит", () => {
        const { h, activated, shown } = scene();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        activated.length = 0;
        shown.length = 0;
        h.service.openView("terminal", false, false);
        expect(h.auxiliaryBarService.visible).toBe(true);
        expect(activated).toEqual([]);
    });

    it("с активацией — будит", () => {
        const { h, activated } = scene();
        h.service.openView("terminal");
        expect(activated).toEqual(["terminal"]);
        expect(h.panelService.getActiveViewId()).toBe(TERMINAL);
    });

    it("вьюлет сайдбара показывается и без активации", () => {
        const { h } = scene();
        h.service.openView("search", false, false);
        expect(h.shownViewlets.at(-1)).toEqual({ id: SEARCH, reveal: true });
    });
});

describe("ViewsService — события показа и активации видов", () => {
    it("первая вкладка части при сборке — «показан»", () => {
        const { shown } = scene();
        expect(shown).toContain("problems");
        expect(shown).not.toContain("terminal");
    });

    it("смена активной вкладки — «показан», клик — ещё и «активирован»", () => {
        const { h, shown, activated } = scene();
        shown.length = 0;
        h.panelService.setActiveView(TERMINAL);
        expect(shown).toEqual(["terminal"]);
        expect(activated).toEqual([]);
        h.panelService.activateView(PROBLEMS);
        expect(activated).toEqual(["problems"]);
    });

    it("переехавший вид шлёт события из новой части", () => {
        const { h, shown, activated } = scene();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        // Единственная вкладка вторичной панели стала активной при сборке.
        expect(shown.at(-1)).toBe("terminal");
        const container = h.service.getViewContainerByViewId("terminal")!;
        h.auxiliaryBarService.activateView(container);
        expect(activated).toEqual(["terminal"]);
    });

    it("показ вьюлета сайдбара — «показан»", () => {
        const { h, shown } = scene();
        shown.length = 0;
        h.showViewlet(SEARCH);
        expect(shown).toEqual(["search"]);
    });

    it("скрытая секция событий не получает", () => {
        const { h, shown } = scene();
        h.service.registerView(testView("extra", TERMINAL, 20));
        h.service.setViewVisible("extra", false);
        shown.length = 0;
        h.panelService.setActiveView(TERMINAL);
        expect(shown).toEqual(["terminal"]);
    });

    it("событие о незнакомой вкладке — тишина", () => {
        const { h, shown } = scene();
        shown.length = 0;
        h.panelService.addView({ id: "foreign", title: "FOREIGN" });
        h.panelService.setActiveView("foreign");
        expect(shown).toEqual([]);
    });
});
