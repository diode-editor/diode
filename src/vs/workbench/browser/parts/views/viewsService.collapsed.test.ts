import { describe, expect, it } from "vitest";

import { SIDEBAR_VIEWS_STATE } from "../../../common/stateKeys.ts";

import { makeViewsHarness, testView as view } from "./viewsService.testUtils.ts";

/**
 * Контейнер Source Control в миниатюре: CHANGES развёрнут по дефолту, GRAPH —
 * свёрнут (ровно как в живом редакторе).
 */
function makeScm(): ReturnType<typeof makeViewsHarness> {
    const h = makeViewsHarness();
    h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
    h.service.registerView(view("scm.changes", "scm", 10));
    h.service.registerView(view("scm.graph", "scm", 20, { collapsed: true }));
    return h;
}

/** Свёрнутость секций контейнера по id — то, что видит пользователь. */
function collapsedMap(h: ReturnType<typeof makeViewsHarness>): Record<string, boolean> {
    const paneView = h.paneView("scm");
    return Object.fromEntries(paneView.getPaneIds().map((id) => [id, paneView.isCollapsed(id)]));
}

describe("ViewsService: дефолт свёрнутости дескриптора", () => {
    it("collapsed: true — секция появляется свёрнутой, соседняя развёрнута", () => {
        const h = makeScm();
        h.service.attachContainer("scm");

        expect(collapsedMap(h)).toEqual({ "scm.changes": false, "scm.graph": true });
        expect(h.service.isViewExpanded("scm.graph")).toBe(false);
        expect(h.service.isViewExpanded("scm.changes")).toBe(true);
    });

    it("без collapsed секция развёрнута — дефолт дефолта не изменился", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.attachContainer("scm");

        expect(collapsedMap(h)).toEqual({ "scm.changes": false, "scm.graph": false });
    });

    it("сохранённая развёрнутость ПЕРЕБИВАЕТ дефолт: развернул — осталось развёрнутым", () => {
        const h = makeScm();
        h.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: { "scm.changes": false, "scm.graph": false }, weights: {}, hidden: [] },
        });
        h.service.attachContainer("scm");
        h.service.restoreViewsState();

        expect(collapsedMap(h)).toEqual({ "scm.changes": false, "scm.graph": false });
    });

    it("сохранённая свёрнутость применяется и к секции без дефолта", () => {
        const h = makeScm();
        h.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: { "scm.changes": true, "scm.graph": false }, weights: {}, hidden: [] },
        });
        h.service.attachContainer("scm");
        h.service.restoreViewsState();

        expect(collapsedMap(h)).toEqual({ "scm.changes": true, "scm.graph": false });
    });

    it("секции, которой в сторе нет, достаётся дефолт — а не состояние соседей", () => {
        const h = makeScm();
        // Стор знает только про CHANGES: GRAPH появился в новой версии редактора.
        h.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: { "scm.changes": false }, weights: {}, hidden: [] },
        });
        h.service.attachContainer("scm");
        h.service.restoreViewsState();

        expect(collapsedMap(h)).toEqual({ "scm.changes": false, "scm.graph": true });
    });

    it("стор прошлых версий (массив id) читается: перечисленные свёрнуты, остальным дефолт", () => {
        const h = makeScm();
        h.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: ["scm.changes"], weights: {}, hidden: [] },
        });
        h.service.attachContainer("scm");
        h.service.restoreViewsState();

        expect(collapsedMap(h)).toEqual({ "scm.changes": true, "scm.graph": true });
    });

    it("пустой массив прошлого стора ничего не сворачивает — у всех свой дефолт", () => {
        const h = makeScm();
        h.stored.set(SIDEBAR_VIEWS_STATE.key, { scm: { collapsed: [], weights: {}, hidden: [] } });
        h.service.attachContainer("scm");
        h.service.restoreViewsState();

        expect(collapsedMap(h)).toEqual({ "scm.changes": false, "scm.graph": true });
    });

    it("разворот дефолтно свёрнутой секции уезжает в стор как явное false", () => {
        const h = makeScm();
        h.service.attachContainer("scm");

        h.paneView("scm").toggleCollapsed("scm.graph");
        expect(h.stored.get(SIDEBAR_VIEWS_STATE.key)).toMatchObject({
            scm: { collapsed: { "scm.changes": false, "scm.graph": false } },
        });
    });

    it("пересборка контейнера не возвращает дефолт секции, развёрнутой пользователем", () => {
        const h = makeScm();
        h.service.attachContainer("scm");
        h.paneView("scm").toggleCollapsed("scm.graph");

        h.service.registerView(view("scm.stashes", "scm", 30, { collapsed: true }));
        expect(collapsedMap(h)).toEqual({
            "scm.changes": false,
            "scm.graph": false,
            "scm.stashes": true,
        });
    });

    it("merged-контейнер игнорирует дефолт: единственная видимая секция не сворачивается", () => {
        const h = makeScm();
        h.service.attachContainer("scm");

        h.service.setViewVisible("scm.changes", false);
        expect(collapsedMap(h)).toEqual({ "scm.graph": false });
        expect(h.service.isViewExpanded("scm.graph")).toBe(true);
    });

    it("возвращённая из скрытия секция снова встаёт по дефолту", () => {
        const h = makeScm();
        h.service.attachContainer("scm");

        h.service.setViewVisible("scm.graph", false);
        h.service.setViewVisible("scm.graph", true);
        expect(collapsedMap(h)).toEqual({ "scm.changes": false, "scm.graph": true });
    });
});
