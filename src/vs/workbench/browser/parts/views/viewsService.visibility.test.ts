import { describe, expect, it } from "vitest";

import { SIDEBAR_VIEWS_STATE } from "../../../common/stateKeys.ts";

import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";

function view(id: string, order: number, extra?: Parameters<typeof testView>[3]) {
    return testView(id, "scm", order, extra);
}

/** Контейнер из трёх секций — на двух не видно разницы «скрыли» и «стало merged». */
function threeSectionContainer(): IViewsHarness {
    const harness = makeViewsHarness();
    harness.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
    harness.service.registerView(view("scm.changes", 10));
    harness.service.registerView(view("scm.graph", 20));
    harness.service.registerView(view("scm.stashes", 30));
    harness.service.attachContainer("scm");
    return harness;
}

describe("ViewsService — видимость секций", () => {
    it("скрытая секция уходит из контейнера, показанная возвращается на своё место", () => {
        const h = threeSectionContainer();

        h.service.setViewVisible("scm.graph", false);
        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.stashes"]);
        expect(h.service.isViewVisible("scm.graph")).toBe(false);

        h.service.setViewVisible("scm.graph", true);
        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.graph", "scm.stashes"]);
        expect(h.service.isViewVisible("scm.graph")).toBe(true);
    });

    it("свёрнутость и веса соседей переживают скрытие и возврат секции", () => {
        const h = threeSectionContainer();
        h.paneView("scm").setCollapsed("scm.changes", true);
        h.paneView("scm").setWeights({ "scm.stashes": 6 });

        h.service.setViewVisible("scm.graph", false);
        h.service.setViewVisible("scm.graph", true);

        expect(h.paneView("scm").isCollapsed("scm.changes")).toBe(true);
        expect(h.paneView("scm").getWeights()["scm.stashes"]).toBe(6);
    });

    it("последняя видимая секция скрытию не поддаётся — пустой контейнер показывать нечем", () => {
        const h = threeSectionContainer();
        h.service.setViewVisible("scm.graph", false);
        h.service.setViewVisible("scm.stashes", false);

        h.service.setViewVisible("scm.changes", false);

        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.changes"]);
        expect(h.service.isViewVisible("scm.changes")).toBe(true);
    });

    it("скрытие предпоследней секции сливает заголовки, возврат — разъезжает", () => {
        const h = threeSectionContainer();
        h.service.setViewVisible("scm.stashes", false);
        h.service.setViewVisible("scm.graph", false);

        expect(h.header("scm")).toBeNull();
        expect(h.paneView("scm").querySelector("#paneHeader-scm-changes")!.inspectState()).toMatchObject({
            title: "SOURCE CONTROL",
            collapsible: false,
        });

        h.service.setViewVisible("scm.graph", true);
        expect(h.header("scm")!.inspectState()).toEqual({ title: "SOURCE CONTROL" });
        expect(h.paneView("scm").querySelector("#paneHeader-scm-changes")!.inspectState()).toMatchObject({
            title: "SCM.CHANGES",
            collapsible: true,
        });
    });

    it("canToggleVisibility: false — секция не скрывается", () => {
        const harness = makeViewsHarness();
        harness.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        harness.service.registerView(view("scm.changes", 10, { canToggleVisibility: false }));
        harness.service.registerView(view("scm.graph", 20));
        harness.service.attachContainer("scm");

        harness.service.setViewVisible("scm.changes", false);
        expect(harness.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });

    it("getContainerViews отдаёт снимок для переключателя", () => {
        const h = threeSectionContainer();
        h.service.setViewVisible("scm.graph", false);
        expect(h.service.getContainerViews("scm")).toEqual([
            { id: "scm.changes", title: "SCM.CHANGES", visible: true, canToggleVisibility: true },
            { id: "scm.graph", title: "SCM.GRAPH", visible: false, canToggleVisibility: true },
            { id: "scm.stashes", title: "SCM.STASHES", visible: true, canToggleVisibility: true },
        ]);
    });

    it("скрытие — действие пользователя: пишется в стор вместе со свёрнутостью", () => {
        const h = threeSectionContainer();
        h.service.setViewVisible("scm.graph", false);
        expect(h.stored.get(SIDEBAR_VIEWS_STATE.key)).toMatchObject({ scm: { hidden: ["scm.graph"] } });
    });

    it("повторное скрытие уже скрытой секции — no-op без записи в стор", () => {
        const h = threeSectionContainer();
        h.service.setViewVisible("scm.graph", false);
        h.stored.delete(SIDEBAR_VIEWS_STATE.key);
        h.service.setViewVisible("scm.graph", false);
        expect(h.stored.has(SIDEBAR_VIEWS_STATE.key)).toBe(false);
    });

    it("до attach скрытие только запоминается — контейнер построится уже без секции", () => {
        const harness = makeViewsHarness();
        harness.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        harness.service.registerView(view("scm.changes", 10));
        harness.service.registerView(view("scm.graph", 20));
        harness.service.setViewVisible("scm.graph", false);
        harness.service.attachContainer("scm");
        expect(harness.paneView("scm").getPaneIds()).toEqual(["scm.changes"]);
    });
});

describe("ViewsService — restore скрытости", () => {
    it("сохранённая скрытость применяется вместе с весами и свёрнутостью", () => {
        const harness = makeViewsHarness();
        harness.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: ["scm.stashes"], weights: { "scm.changes": 5 }, hidden: ["scm.graph"] },
        });
        harness.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        harness.service.registerView(view("scm.changes", 10));
        harness.service.registerView(view("scm.graph", 20));
        harness.service.registerView(view("scm.stashes", 30));
        harness.service.attachContainer("scm");

        harness.service.restoreViewsState();

        expect(harness.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.stashes"]);
        expect(harness.paneView("scm").isCollapsed("scm.stashes")).toBe(true);
        expect(harness.paneView("scm").getWeights()["scm.changes"]).toBe(5);
    });

    it("стор без поля hidden читается как «ничего не скрыто»", () => {
        const harness = makeViewsHarness();
        harness.stored.set(SIDEBAR_VIEWS_STATE.key, { scm: { collapsed: [], weights: {} } });
        harness.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        harness.service.registerView(view("scm.changes", 10));
        harness.service.registerView(view("scm.graph", 20));
        harness.service.attachContainer("scm");

        harness.service.restoreViewsState();
        expect(harness.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });

    it("протухший стор, скрывающий всё, оставляет первую секцию видимой", () => {
        const harness = makeViewsHarness();
        harness.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: [], weights: {}, hidden: ["scm.changes", "scm.graph"] },
        });
        harness.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        harness.service.registerView(view("scm.changes", 10));
        harness.service.registerView(view("scm.graph", 20));
        harness.service.attachContainer("scm");

        harness.service.restoreViewsState();
        expect(harness.paneView("scm").getPaneIds()).toEqual(["scm.changes"]);
    });

    it("стор не может скрыть секцию, которой это запрещено, и не знает чужих id", () => {
        const harness = makeViewsHarness();
        harness.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: [], weights: {}, hidden: ["scm.changes", "scm.ghost"] },
        });
        harness.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        harness.service.registerView(view("scm.changes", 10, { canToggleVisibility: false }));
        harness.service.registerView(view("scm.graph", 20));
        harness.service.attachContainer("scm");

        harness.service.restoreViewsState();
        expect(harness.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });
});
