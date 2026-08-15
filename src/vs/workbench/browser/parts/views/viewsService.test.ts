import { describe, expect, it, vi } from "vitest";

import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { SIDEBAR_VIEWS_STATE } from "../../../common/stateKeys.ts";

import { ViewContainerHeaderElement } from "./viewContainerHeaderElement.ts";
import { makeViewsHarness, paneTitles, testView as view } from "./viewsService.testUtils.ts";

describe("ViewsService", () => {
    it("attachContainer строит заголовок над секциями и регистрирует контейнер", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.attachContainer("scm");

        const header = h.header("scm");
        expect(header).toBeInstanceOf(ViewContainerHeaderElement);
        expect(header?.inspectState()).toEqual({ title: "SOURCE CONTROL" });
        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });

    it("секции идут по order, а не по порядку регистрации", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.attachContainer("scm");
        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });

    it("поздняя регистрация view пересобирает уже построенный контейнер", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.attachContainer("scm");
        h.service.registerView(view("scm.changes", "scm", 10));
        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });

    it("повторный attachContainer — no-op", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.attachContainer("scm");
        const first = h.root("scm");
        h.service.attachContainer("scm");
        expect(h.root("scm")).toBe(first);
    });

    it("действие пользователя write-through'ом сохраняет свёрнутость и веса", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.attachContainer("scm");

        h.paneView("scm").toggleCollapsed("scm.graph");
        expect(h.stored.get(SIDEBAR_VIEWS_STATE.key)).toEqual({
            scm: { collapsed: ["scm.graph"], weights: { "scm.changes": 1, "scm.graph": 1 }, hidden: [] },
        });
    });

    it("restoreViewsState применяет сохранённое без write-through", () => {
        const h = makeViewsHarness();
        h.stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: ["scm.graph"], weights: { "scm.changes": 7, "scm.graph": 3 } },
        });
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.attachContainer("scm");
        // Контейнер без сохранённого состояния и неприаттаченный — пропускаются.
        h.service.registerContainer({ id: "explorer", title: "EXPLORER", location: "sidebar" });
        h.service.registerView(view("files", "explorer", 10));
        h.service.attachContainer("explorer");
        h.service.registerContainer({ id: "detached", title: "DETACHED", location: "sidebar" });
        const before = h.stored.get(SIDEBAR_VIEWS_STATE.key);

        h.service.restoreViewsState();
        const paneView = h.paneView("scm");
        expect(paneView.isCollapsed("scm.graph")).toBe(true);
        expect(paneView.getWeights()).toEqual({ "scm.changes": 7, "scm.graph": 3 });
        expect(h.stored.get(SIDEBAR_VIEWS_STATE.key)).toBe(before);
    });

    it("reveal контейнера фокусирует первую развёрнутую view", () => {
        const h = makeViewsHarness();
        const focusChanges = vi.fn();
        const focusGraph = vi.fn();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10, { focus: focusChanges }));
        h.service.registerView(view("scm.graph", "scm", 20, { focus: focusGraph }));
        h.service.attachContainer("scm");
        h.paneView("scm").setCollapsed("scm.changes", true);

        h.focus("scm");
        expect(focusChanges).not.toHaveBeenCalled();
        expect(focusGraph).toHaveBeenCalledOnce();
    });

    it("view можно регистрировать раньше контейнера (компоненты создаются раньше workbench)", () => {
        const h = makeViewsHarness();
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.attachContainer("scm");
        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.changes"]);
    });

    it("повторная регистрация view заменяет дескриптор (идемпотентность setWorkspaceFolder)", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.attachContainer("scm");
        h.service.registerView(view("scm.changes", "scm", 10));
        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.changes"]);
    });

    it("при равном order секции идут по id", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.zeta", "scm", 10));
        h.service.registerView(view("scm.alpha", "scm", 10));
        h.service.attachContainer("scm");
        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.alpha", "scm.zeta"]);
    });

    it("focusContainer до attach и на контейнере без view — тихие no-op", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        expect(() => h.service.focusContainer("scm")).not.toThrow();
        h.service.attachContainer("scm");
        expect(() => h.service.focusContainer("scm")).not.toThrow();
    });

    it("все секции свёрнуты — фокус первой view контейнера", () => {
        const h = makeViewsHarness();
        const focusChanges = vi.fn();
        const focusGraph = vi.fn();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10, { focus: focusChanges }));
        h.service.registerView(view("scm.graph", "scm", 20, { focus: focusGraph }));
        h.service.attachContainer("scm");
        h.paneView("scm").setCollapsed("scm.changes", true);
        h.paneView("scm").setCollapsed("scm.graph", true);
        h.service.focusContainer("scm");
        expect(focusChanges).toHaveBeenCalledOnce();
        expect(focusGraph).not.toHaveBeenCalled();
    });

    it("attach незарегистрированного контейнера — ошибки", () => {
        const h = makeViewsHarness();
        h.service.registerView(view("x", "ghost", 1));
        expect(() => h.service.attachContainer("ghost")).toThrow(/is not registered/);
        expect(() => h.service.attachContainer("missing")).toThrow(/unknown container id/);
    });

    it("обращение к незнакомой view — ошибка", () => {
        const h = makeViewsHarness();
        expect(() => h.service.isViewVisible("nope")).toThrow(/unknown view id/);
    });
});

describe("ViewsService — merged контейнер выводится из числа видимых секций", () => {
    it("одна view: без заголовка контейнера, секция несёт его название и не сворачивается", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "search", title: "SEARCH", location: "sidebar" });
        h.service.registerView(view("search.results", "search", 10));
        h.service.attachContainer("search");

        expect(h.header("search")).toBeNull();
        const paneView = h.paneView("search");
        expect(paneView.getPaneIds()).toEqual(["search.results"]);

        const header = paneView.querySelector("#paneHeader-search-results")!;
        expect(header.inspectState()).toMatchObject({ title: "SEARCH", collapsible: false });

        // Несворачиваемость: и протухший персист, и программный путь — no-op.
        paneView.setCollapsed("search.results", true);
        expect(paneView.isCollapsed("search.results")).toBe(false);
    });

    it("вторая view разъезжает заголовки: появляется заголовок контейнера, секции сворачиваемые", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "search", title: "SEARCH", location: "sidebar" });
        h.service.registerView(view("search.results", "search", 10));
        h.service.attachContainer("search");
        const rootBefore = h.root("search");

        h.service.registerView(view("search.extra", "search", 20));

        // Корень контейнера стабилен — место держит ту же ссылку.
        expect(h.root("search")).toBe(rootBefore);
        expect(h.header("search")?.inspectState()).toEqual({ title: "SEARCH" });
        expect(paneTitles(h.paneView("search"))).toEqual(["SEARCH.RESULTS", "SEARCH.EXTRA"]);
        expect(h.paneView("search").querySelector("#paneHeader-search-results")!.inspectState()).toMatchObject({
            collapsible: true,
        });
    });

    it("заголовок контейнера с ведущими пробелами не тащит их в merged-секцию", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "  SOURCE CONTROL", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.attachContainer("scm");
        expect(paneTitles(h.paneView("scm"))).toEqual(["SOURCE CONTROL"]);
    });

    it("restoreViewsState с протухшей свёрнутостью не сворачивает merged-секцию", () => {
        const h = makeViewsHarness();
        h.stored.set(SIDEBAR_VIEWS_STATE.key, {
            search: { collapsed: ["search.results"], weights: { "search.results": 5 } },
        });
        h.service.registerContainer({ id: "search", title: "SEARCH", location: "sidebar" });
        h.service.registerView(view("search.results", "search", 10));
        h.service.attachContainer("search");

        h.service.restoreViewsState();
        expect(h.paneView("search").isCollapsed("search.results")).toBe(false);
    });
});

describe("ViewsService — тело и виджет заголовка view", () => {
    it("setViewBody меняет тело на месте, сохраняя свёрнутость и вес", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.attachContainer("scm");
        const paneView = h.paneView("scm");
        paneView.setCollapsed("scm.graph", true);
        paneView.setWeights({ "scm.changes": 4 });

        const next = new FillerElement();
        next.id = "changes-next";
        h.service.setViewBody("scm.changes", next);

        expect(paneView.querySelector("#changes-next")).toBe(next);
        expect(paneView.querySelector("#scm.changes-body")).toBeNull();
        expect(paneView.isCollapsed("scm.graph")).toBe(true);
        expect(paneView.getWeights()["scm.changes"]).toBe(4);
    });

    it("body === null рисует placeholder, а возврат тела его убирает", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "panelish", title: "PROBLEMS", location: "sidebar" });
        h.service.registerView(
            view("problems.view", "panelish", 10, { body: null, placeholder: "No problems have been detected." }),
        );
        h.service.attachContainer("panelish");

        const paneView = h.paneView("panelish");
        const placeholder = paneView.querySelector("#viewPlaceholder-problems-view") as TextLabelElement;
        expect(placeholder.getText()).toBe("No problems have been detected.");

        const tree = new FillerElement();
        tree.id = "problems-tree";
        h.service.setViewBody("problems.view", tree);
        expect(paneView.querySelector("#problems-tree")).toBe(tree);
        expect(paneView.querySelector("#viewPlaceholder-problems-view")).toBeNull();
    });

    it("setViewBody тем же телом — no-op; на скрытой секции только запоминает", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.attachContainer("scm");
        h.service.setViewVisible("scm.graph", false);

        const next = new FillerElement();
        next.id = "graph-next";
        h.service.setViewBody("scm.graph", next);
        expect(h.paneView("scm").querySelector("#graph-next")).toBeNull();

        h.service.setViewVisible("scm.graph", true);
        expect(h.paneView("scm").querySelector("#graph-next")).toBe(next);
        expect(() => h.service.setViewBody("scm.graph", next)).not.toThrow();
    });

    it("виджет заголовка едет в заголовок секции", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(view("scm.changes", "scm", 10));
        h.service.registerView(view("scm.graph", "scm", 20));
        h.service.attachContainer("scm");
        expect(h.service.getViewTitleWidget("scm.changes")).toBeNull();

        const widget = new FillerElement();
        widget.id = "channel-picker";
        h.service.setViewTitleWidget("scm.changes", widget);
        expect(h.service.getViewTitleWidget("scm.changes")).toBe(widget);
        expect(h.paneView("scm").querySelector("#channel-picker")).toBe(widget);
    });
});
