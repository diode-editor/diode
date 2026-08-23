import { describe, expect, it, vi } from "vitest";

import { SIDEBAR_VIEWS_STATE } from "../../../common/stateKeys.ts";

import { makeViewsHarness, testView as view } from "./viewsService.testUtils.ts";

/** Контейнер из двух секций — минимум, при котором они сворачиваются. */
function makeScm(): ReturnType<typeof makeViewsHarness> {
    const h = makeViewsHarness();
    h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
    h.service.registerView(view("scm.changes", "scm", 10));
    h.service.registerView(view("scm.graph", "scm", 20));
    return h;
}

describe("ViewsService: раскрытость секций", () => {
    it("до attachContainer секция не раскрыта — её тела ещё нет ни в одном дереве", () => {
        const h = makeScm();
        expect(h.service.isViewExpanded("scm.graph")).toBe(false);

        h.service.attachContainer("scm");
        expect(h.service.isViewExpanded("scm.graph")).toBe(true);
    });

    it("свёрнутая шевроном секция не раскрыта, соседняя — раскрыта", () => {
        const h = makeScm();
        h.service.attachContainer("scm");

        h.paneView("scm").toggleCollapsed("scm.graph");
        expect(h.service.isViewExpanded("scm.graph")).toBe(false);
        expect(h.service.isViewExpanded("scm.changes")).toBe(true);
    });

    it("скрытая через «Views» секция не раскрыта", () => {
        const h = makeScm();
        h.service.attachContainer("scm");

        h.service.setViewVisible("scm.graph", false);
        expect(h.service.isViewExpanded("scm.graph")).toBe(false);
    });

    it("merged-секция раскрыта всегда: единственная видимая не сворачивается", () => {
        const h = makeScm();
        h.service.attachContainer("scm");
        h.paneView("scm").toggleCollapsed("scm.graph");
        expect(h.service.isViewExpanded("scm.graph")).toBe(false);

        // Скрыли соседа — GRAPH остался один и забрал заголовок контейнера.
        h.service.setViewVisible("scm.changes", false);
        expect(h.service.isViewExpanded("scm.graph")).toBe(true);
    });

    it("restoreViewsState извещает о восстановленной свёрнутости", () => {
        const h = makeScm();
        h.service.attachContainer("scm");
        const seen: [string, boolean][] = [];
        h.service.onDidChangeViewExpanded((id, expanded) => seen.push([id, expanded]));
        h.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: ["scm.graph"], weights: {}, hidden: [] },
        });

        h.service.restoreViewsState();
        expect(seen).toEqual([["scm.graph", false]]);
        expect(h.service.isViewExpanded("scm.graph")).toBe(false);
    });

    it("событие приходит на каждое изменение и только на него", () => {
        const h = makeScm();
        const seen: [string, boolean][] = [];
        h.service.onDidChangeViewExpanded((id, expanded) => seen.push([id, expanded]));

        h.service.attachContainer("scm");
        expect(seen).toEqual([
            ["scm.changes", true],
            ["scm.graph", true],
        ]);

        seen.length = 0;
        h.paneView("scm").toggleCollapsed("scm.graph");
        expect(seen).toEqual([["scm.graph", false]]);

        // Пересборка контейнера свёрнутость сохраняет — о ней не извещаем заново.
        seen.length = 0;
        h.service.registerView(view("scm.stashes", "scm", 30));
        expect(seen).toEqual([["scm.stashes", true]]);
    });

    it("подписку можно снять", () => {
        const h = makeScm();
        const listener = vi.fn();
        h.service.onDidChangeViewExpanded(listener).dispose();

        h.service.attachContainer("scm");
        expect(listener).not.toHaveBeenCalled();
    });
});
