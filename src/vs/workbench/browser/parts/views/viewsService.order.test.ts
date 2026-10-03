import { describe, expect, it } from "vitest";

import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";
import type { IViewContainerDescriptor } from "./viewsService.ts";

/** Регистрирует контейнер с одной view — как это делает фича в конструкторе. */
function register(h: IViewsHarness, descriptor: Omit<IViewContainerDescriptor, "title">): void {
    h.service.registerContainer({ title: descriptor.id.toUpperCase(), ...descriptor });
    h.service.registerView(testView(`${descriptor.id}.view`, descriptor.id, 10));
}

function tabs(h: IViewsHarness): string[] {
    return h.panelService.getViews().map((v) => v.id);
}

/**
 * Порядок контейнеров задаёт `order` дескриптора, а не порядок, в котором фичи
 * создались и зарегистрировали их: перестановка резолва в корне workbench'а не
 * должна молча переставлять вкладки панели и вьюлеты сайдбара.
 */
describe("ViewsService — порядок контейнеров и дефолтный вьюлет", () => {
    it("attachRegisteredContainers строит вкладки панели по order, первая становится активной", () => {
        const h = makeViewsHarness();
        register(h, { id: "terminal", location: "panel", order: 2 });
        register(h, { id: "problems", location: "panel", order: 0 });
        register(h, { id: "output", location: "panel", order: 1 });

        h.service.attachRegisteredContainers();

        expect(tabs(h)).toEqual(["problems", "output", "terminal"]);
        expect(h.panelService.getActiveViewId()).toBe("problems");
    });

    it("вьюлеты сайдбара регистрируются по order", () => {
        const h = makeViewsHarness();
        register(h, { id: "search", location: "sidebar", order: 1 });
        register(h, { id: "explorer", location: "sidebar", order: 0 });

        h.service.attachRegisteredContainers();

        expect(h.viewlets).toEqual(["explorer", "search"]);
    });

    it("контейнер без order встаёт после упорядоченных, равный order сохраняет порядок регистрации", () => {
        const h = makeViewsHarness();
        register(h, { id: "late", location: "panel" });
        register(h, { id: "first", location: "panel", order: 1 });
        register(h, { id: "second", location: "panel", order: 1 });
        register(h, { id: "zero", location: "panel", order: 0 });

        h.service.attachRegisteredContainers();

        expect(tabs(h)).toEqual(["zero", "first", "second", "late"]);
    });

    it("поздний attachContainer вставляет вкладку в позицию по order", () => {
        const h = makeViewsHarness();
        register(h, { id: "a", location: "panel", order: 0 });
        register(h, { id: "c", location: "panel", order: 2 });
        h.service.attachRegisteredContainers();

        register(h, { id: "b", location: "panel", order: 1 });
        h.service.attachContainer("b");
        register(h, { id: "c2", location: "panel", order: 2 });
        h.service.attachContainer("c2");

        expect(tabs(h)).toEqual(["a", "b", "c", "c2"]);
    });

    it("позицию вкладки не сдвигают контейнеры сайдбара и ещё не построенные", () => {
        const h = makeViewsHarness();
        register(h, { id: "explorer", location: "sidebar", order: 0 });
        register(h, { id: "pending", location: "panel", order: 0 });
        register(h, { id: "y", location: "panel", order: 5 });
        h.service.attachContainer("explorer");
        h.service.attachContainer("y");

        register(h, { id: "x", location: "panel", order: 1 });
        h.service.attachContainer("x");

        expect(tabs(h)).toEqual(["x", "y"]);
    });

    it("показывает дефолтный вьюлет без reveal — видимость сайдбара не трогает", () => {
        const h = makeViewsHarness();
        register(h, { id: "search", location: "sidebar", order: 1 });
        register(h, { id: "explorer", location: "sidebar", order: 0, isDefault: true });

        h.service.attachRegisteredContainers();

        expect(h.shownViewlets).toEqual([{ id: "explorer", reveal: false }]);
    });

    it("без дефолтного контейнера вьюлет не показывается", () => {
        const h = makeViewsHarness();
        register(h, { id: "search", location: "sidebar", order: 1 });

        h.service.attachRegisteredContainers();

        expect(h.shownViewlets).toEqual([]);
    });

    it("пропускает контейнеры, в которые только записались view, и уже построенные", () => {
        const h = makeViewsHarness();
        h.service.registerView(testView("orphan.view", "orphan", 10));
        register(h, { id: "output", location: "panel", order: 1 });
        h.service.attachRegisteredContainers();

        h.service.attachRegisteredContainers();

        expect(tabs(h)).toEqual(["output"]);
        expect(() => h.root("orphan")).toThrow(/is not attached anywhere/);
    });
});
