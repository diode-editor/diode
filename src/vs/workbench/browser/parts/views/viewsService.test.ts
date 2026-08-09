import { describe, expect, it, vi } from "vitest";

import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { FillerElement } from "../../../../../../tuidom/ui/layout/fillerElement.ts";
import { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { IContextMenuMenuDelegate } from "../../../../platform/contextview/common/contextMenuDelegate.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import { SIDEBAR_VIEWS_STATE } from "../../../common/stateKeys.ts";
import type { SidebarService } from "../sidebar/sidebarService.ts";

import type { PaneViewElement } from "./paneViewElement.ts";
import { ViewContainerHeaderElement } from "./viewContainerHeaderElement.ts";
import type { IViewDescriptor } from "./viewsService.ts";
import { ViewsService } from "./viewsService.ts";

function fakeSidebar(): { service: SidebarService; registered: Map<string, { view: TUIElement; focus: () => void }> } {
    const registered = new Map<string, { view: TUIElement; focus: () => void }>();
    const service = {
        registerViewlet: (id: string, view: TUIElement, focus: () => void) => {
            registered.set(id, { view, focus });
        },
    } as unknown as SidebarService;
    return { service, registered };
}

function fakeContextMenu(): { service: ContextMenuService; shown: IContextMenuMenuDelegate[] } {
    const shown: IContextMenuMenuDelegate[] = [];
    const service = {
        showContextMenu: (delegate: IContextMenuMenuDelegate) => {
            shown.push(delegate);
        },
    } as unknown as ContextMenuService;
    return { service, shown };
}

function fakeState(): { service: IStateService; stored: Map<string, unknown> } {
    const stored = new Map<string, unknown>();
    const service: IStateService = {
        get<T>(descriptor: IStateDescriptor<T>): T {
            return stored.has(descriptor.key) ? (stored.get(descriptor.key) as T) : descriptor.default;
        },
        store<T>(descriptor: IStateDescriptor<T>, value: T): void {
            stored.set(descriptor.key, value);
        },
        openWorkspace: () => {},
        flushSync: () => {},
    };
    return { service, stored };
}

function view(id: string, containerId: string, order: number, focus: () => void = () => {}): IViewDescriptor {
    const body = new FillerElement();
    body.id = `${id}-body`;
    return { id, containerId, title: id.toUpperCase(), order, body, focus };
}

function makeHarness(): {
    service: ViewsService;
    registered: ReturnType<typeof fakeSidebar>["registered"];
    shown: IContextMenuMenuDelegate[];
    stored: Map<string, unknown>;
} {
    const sidebar = fakeSidebar();
    const contextMenu = fakeContextMenu();
    const state = fakeState();
    const service = new ViewsService(sidebar.service, contextMenu.service, state.service);
    return { service, registered: sidebar.registered, shown: contextMenu.shown, stored: state.stored };
}

function paneViewOf(registered: ReturnType<typeof fakeSidebar>["registered"], containerId: string): PaneViewElement {
    const root = registered.get(containerId)!.view;
    return root.querySelector(`#viewContainer-${containerId}`) as PaneViewElement;
}

function headerOf(
    registered: ReturnType<typeof fakeSidebar>["registered"],
    containerId: string,
): ViewContainerHeaderElement | null {
    const root = registered.get(containerId)!.view;
    return (root.querySelector(`#viewContainerHeader-${containerId}`) as ViewContainerHeaderElement | null) ?? null;
}

function paneTitles(paneView: PaneViewElement): string[] {
    return paneView.getPaneIds().map((id) => {
        const header = paneView.querySelector(`#paneHeader-${id.replaceAll(".", "-")}`);
        return String(header?.inspectState()?.title);
    });
}

describe("ViewsService", () => {
    it("attachContainer строит заголовок над секциями и регистрирует контейнер", () => {
        const { service, registered } = makeHarness();
        service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
        service.registerView(view("scm.changes", "scm", 10));
        service.registerView(view("scm.graph", "scm", 20));
        service.attachContainer("scm");

        const header = headerOf(registered, "scm");
        expect(header).toBeInstanceOf(ViewContainerHeaderElement);
        expect(header?.inspectState()).toEqual({ title: "SOURCE CONTROL" });
        expect(paneViewOf(registered, "scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });

    it("секции идут по order, а не по порядку регистрации", () => {
        const { service, registered } = makeHarness();
        service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        service.registerView(view("scm.graph", "scm", 20));
        service.registerView(view("scm.changes", "scm", 10));
        service.attachContainer("scm");
        expect(paneViewOf(registered, "scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });

    it("поздняя регистрация view пересобирает уже построенный контейнер", () => {
        const { service, registered } = makeHarness();
        service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        service.registerView(view("scm.graph", "scm", 20));
        service.attachContainer("scm");
        service.registerView(view("scm.changes", "scm", 10));
        expect(paneViewOf(registered, "scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });

    it("повторный attachContainer — no-op", () => {
        const { service, registered } = makeHarness();
        service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        service.registerView(view("scm.changes", "scm", 10));
        service.attachContainer("scm");
        const first = registered.get("scm")!.view;
        service.attachContainer("scm");
        expect(registered.get("scm")!.view).toBe(first);
    });

    it("действие пользователя write-through'ом сохраняет свёрнутость и веса", () => {
        const { service, registered, stored } = makeHarness();
        service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        service.registerView(view("scm.changes", "scm", 10));
        service.registerView(view("scm.graph", "scm", 20));
        service.attachContainer("scm");

        paneViewOf(registered, "scm").toggleCollapsed("scm.graph");
        expect(stored.get(SIDEBAR_VIEWS_STATE.key)).toEqual({
            scm: { collapsed: ["scm.graph"], weights: { "scm.changes": 1, "scm.graph": 1 }, hidden: [] },
        });
    });

    it("restoreViewsState применяет сохранённое без write-through", () => {
        const { service, registered, stored } = makeHarness();
        stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: ["scm.graph"], weights: { "scm.changes": 7, "scm.graph": 3 } },
        });
        service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        service.registerView(view("scm.changes", "scm", 10));
        service.registerView(view("scm.graph", "scm", 20));
        service.attachContainer("scm");
        // Контейнер без сохранённого состояния и неприаттаченный — пропускаются.
        service.registerContainer({ id: "explorer", title: "EXPLORER", location: "sidebar" });
        service.registerView(view("files", "explorer", 10));
        service.attachContainer("explorer");
        service.registerContainer({ id: "detached", title: "DETACHED", location: "sidebar" });
        const before = stored.get(SIDEBAR_VIEWS_STATE.key);

        service.restoreViewsState();
        const paneView = paneViewOf(registered, "scm");
        expect(paneView.isCollapsed("scm.graph")).toBe(true);
        expect(paneView.getWeights()).toEqual({ "scm.changes": 7, "scm.graph": 3 });
        expect(stored.get(SIDEBAR_VIEWS_STATE.key)).toBe(before);
    });

    it("запрос меню секции открывает ViewMoreActions с контекстом {view}", () => {
        const { service, registered, shown } = makeHarness();
        service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        service.registerView(view("scm.changes", "scm", 10));
        service.registerView(view("scm.graph", "scm", 20));
        service.attachContainer("scm");

        const paneView = paneViewOf(registered, "scm");
        paneView.onDidRequestPaneMenu?.("scm.graph", { screenX: 5, screenY: 7 });
        expect(shown).toHaveLength(1);
        expect(shown[0].menuId).toBe(MenuId.ViewMoreActions);
        expect(shown[0].menuContext).toEqual({ view: "scm.graph" });
        expect(shown[0].getAnchor()).toEqual({ screenX: 5, screenY: 7 });
        expect(shown[0].getOwner()).toBe(paneView);
    });

    it("запрос меню контейнера открывает ViewContainerTitle с контекстом {container}", () => {
        const { service, registered, shown } = makeHarness();
        service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        service.registerView(view("scm.changes", "scm", 10));
        service.registerView(view("scm.graph", "scm", 20));
        service.attachContainer("scm");

        const header = headerOf(registered, "scm")!;
        header.onMenu?.({ screenX: 2, screenY: 0 });
        expect(shown).toHaveLength(1);
        expect(shown[0].menuId).toBe(MenuId.ViewContainerTitle);
        expect(shown[0].menuContext).toEqual({ container: "scm" });
        expect(shown[0].getOwner()).toBe(header);
    });

    it("reveal контейнера фокусирует первую развёрнутую view", () => {
        const { service, registered } = makeHarness();
        const focusChanges = vi.fn();
        const focusGraph = vi.fn();
        service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        service.registerView(view("scm.changes", "scm", 10, focusChanges));
        service.registerView(view("scm.graph", "scm", 20, focusGraph));
        service.attachContainer("scm");
        paneViewOf(registered, "scm").setCollapsed("scm.changes", true);

        registered.get("scm")!.focus();
        expect(focusChanges).not.toHaveBeenCalled();
        expect(focusGraph).toHaveBeenCalledOnce();
    });

    it("view можно регистрировать раньше контейнера (компоненты создаются раньше workbench)", () => {
        const { service, registered } = makeHarness();
        service.registerView(view("scm.changes", "scm", 10));
        service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        service.attachContainer("scm");
        expect(paneViewOf(registered, "scm").getPaneIds()).toEqual(["scm.changes"]);
    });

    it("повторная регистрация view заменяет дескриптор (идемпотентность setWorkspaceFolder)", () => {
        const { service, registered } = makeHarness();
        service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        service.registerView(view("scm.changes", "scm", 10));
        service.attachContainer("scm");
        service.registerView(view("scm.changes", "scm", 10));
        expect(paneViewOf(registered, "scm").getPaneIds()).toEqual(["scm.changes"]);
    });

    it("при равном order секции идут по id", () => {
        const { service, registered } = makeHarness();
        service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        service.registerView(view("scm.zeta", "scm", 10));
        service.registerView(view("scm.alpha", "scm", 10));
        service.attachContainer("scm");
        expect(paneViewOf(registered, "scm").getPaneIds()).toEqual(["scm.alpha", "scm.zeta"]);
    });

    it("focusContainer до attach и на контейнере без view — тихие no-op", () => {
        const { service } = makeHarness();
        service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        expect(() => service.focusContainer("scm")).not.toThrow();
        service.attachContainer("scm");
        expect(() => service.focusContainer("scm")).not.toThrow();
    });

    it("все секции свёрнуты — фокус первой view контейнера", () => {
        const { service, registered } = makeHarness();
        const focusChanges = vi.fn();
        const focusGraph = vi.fn();
        service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        service.registerView(view("scm.changes", "scm", 10, focusChanges));
        service.registerView(view("scm.graph", "scm", 20, focusGraph));
        service.attachContainer("scm");
        const paneView = paneViewOf(registered, "scm");
        paneView.setCollapsed("scm.changes", true);
        paneView.setCollapsed("scm.graph", true);
        service.focusContainer("scm");
        expect(focusChanges).toHaveBeenCalledOnce();
        expect(focusGraph).not.toHaveBeenCalled();
    });

    it("attach незарегистрированного контейнера — ошибки", () => {
        const { service } = makeHarness();
        service.registerView(view("x", "ghost", 1));
        expect(() => service.attachContainer("ghost")).toThrow(/is not registered/);
        expect(() => service.attachContainer("missing")).toThrow(/unknown container id/);
    });

    it("обращение к незнакомой view — ошибка", () => {
        const { service } = makeHarness();
        expect(() => service.isViewVisible("nope")).toThrow(/unknown view id/);
    });
});

describe("ViewsService — merged контейнер выводится из числа видимых секций", () => {
    it("одна view: без заголовка контейнера, секция несёт его название и не сворачивается", () => {
        const { service, registered } = makeHarness();
        service.registerContainer({ id: "search", title: "SEARCH", location: "sidebar" });
        service.registerView(view("search.results", "search", 10));
        service.attachContainer("search");

        expect(headerOf(registered, "search")).toBeNull();
        const paneView = paneViewOf(registered, "search");
        expect(paneView.getPaneIds()).toEqual(["search.results"]);

        const header = paneView.querySelector("#paneHeader-search-results")!;
        expect(header.inspectState()).toMatchObject({ title: "SEARCH", collapsible: false });

        // Несворачиваемость: и протухший персист, и программный путь — no-op.
        paneView.setCollapsed("search.results", true);
        expect(paneView.isCollapsed("search.results")).toBe(false);
    });

    it("вторая view разъезжает заголовки: появляется заголовок контейнера, секции сворачиваемые", () => {
        const { service, registered } = makeHarness();
        service.registerContainer({ id: "search", title: "SEARCH", location: "sidebar" });
        service.registerView(view("search.results", "search", 10));
        service.attachContainer("search");
        const rootBefore = registered.get("search")!.view;

        service.registerView(view("search.extra", "search", 20));

        // Корень контейнера стабилен — место держит ту же ссылку.
        expect(registered.get("search")!.view).toBe(rootBefore);
        expect(headerOf(registered, "search")!.inspectState()).toEqual({ title: "SEARCH" });
        const paneView = paneViewOf(registered, "search");
        expect(paneTitles(paneView)).toEqual(["SEARCH.RESULTS", "SEARCH.EXTRA"]);
        expect(paneView.querySelector("#paneHeader-search-results")!.inspectState()).toMatchObject({
            collapsible: true,
        });
    });

    it("заголовок контейнера с ведущими пробелами не тащит их в merged-секцию", () => {
        const { service, registered } = makeHarness();
        service.registerContainer({ id: "scm", title: "  SOURCE CONTROL", location: "sidebar" });
        service.registerView(view("scm.changes", "scm", 10));
        service.attachContainer("scm");
        expect(paneTitles(paneViewOf(registered, "scm"))).toEqual(["SOURCE CONTROL"]);
    });

    it("меню ⋯ merged-секции открывает ViewMoreActions с {view: paneId}", () => {
        const { service, registered, shown } = makeHarness();
        service.registerContainer({ id: "search", title: "SEARCH", location: "sidebar" });
        service.registerView(view("search.results", "search", 10));
        service.attachContainer("search");

        const paneView = paneViewOf(registered, "search");
        paneView.onDidRequestPaneMenu?.("search.results", { screenX: 3, screenY: 1 });
        expect(shown).toHaveLength(1);
        expect(shown[0].menuId).toBe(MenuId.ViewMoreActions);
        expect(shown[0].menuContext).toEqual({ view: "search.results" });
    });

    it("restoreViewsState с протухшей свёрнутостью не сворачивает merged-секцию", () => {
        const { service, registered, stored } = makeHarness();
        stored.set(SIDEBAR_VIEWS_STATE.key, {
            search: { collapsed: ["search.results"], weights: { "search.results": 5 } },
        });
        service.registerContainer({ id: "search", title: "SEARCH", location: "sidebar" });
        service.registerView(view("search.results", "search", 10));
        service.attachContainer("search");

        service.restoreViewsState();
        expect(paneViewOf(registered, "search").isCollapsed("search.results")).toBe(false);
    });
});

describe("ViewsService — тело и виджет заголовка view", () => {
    it("setViewBody меняет тело на месте, сохраняя свёрнутость и вес", () => {
        const { service, registered } = makeHarness();
        service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        service.registerView(view("scm.changes", "scm", 10));
        service.registerView(view("scm.graph", "scm", 20));
        service.attachContainer("scm");
        const paneView = paneViewOf(registered, "scm");
        paneView.setCollapsed("scm.graph", true);
        paneView.setWeights({ "scm.changes": 4 });

        const next = new FillerElement();
        next.id = "changes-next";
        service.setViewBody("scm.changes", next);

        expect(paneView.querySelector("#changes-next")).toBe(next);
        expect(paneView.querySelector("#scm.changes-body")).toBeNull();
        expect(paneView.isCollapsed("scm.graph")).toBe(true);
        expect(paneView.getWeights()["scm.changes"]).toBe(4);
    });

    it("body === null рисует placeholder, а возврат тела его убирает", () => {
        const { service, registered } = makeHarness();
        service.registerContainer({ id: "panelish", title: "PROBLEMS", location: "sidebar" });
        service.registerView({
            id: "problems.view",
            containerId: "panelish",
            title: "PROBLEMS",
            order: 10,
            body: null,
            placeholder: "No problems have been detected.",
            focus: () => {},
        });
        service.attachContainer("panelish");

        const paneView = paneViewOf(registered, "panelish");
        const placeholder = paneView.querySelector("#viewPlaceholder-problems-view")!;
        expect((placeholder.querySelector("TextLabelElement") as TextLabelElement).getText()).toBe(
            "No problems have been detected.",
        );

        const tree = new FillerElement();
        tree.id = "problems-tree";
        service.setViewBody("problems.view", tree);
        expect(paneView.querySelector("#problems-tree")).toBe(tree);
        expect(paneView.querySelector("#viewPlaceholder-problems-view")).toBeNull();
    });

    it("setViewBody тем же телом — no-op; на скрытой секции только запоминает", () => {
        const { service, registered } = makeHarness();
        const body = new FillerElement();
        body.id = "graph-body";
        service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        service.registerView(view("scm.changes", "scm", 10));
        service.registerView({ id: "scm.graph", containerId: "scm", title: "GRAPH", order: 20, body, focus: () => {} });
        service.attachContainer("scm");
        service.setViewVisible("scm.graph", false);

        const next = new FillerElement();
        next.id = "graph-next";
        service.setViewBody("scm.graph", next);
        expect(paneViewOf(registered, "scm").querySelector("#graph-next")).toBeNull();

        service.setViewVisible("scm.graph", true);
        expect(paneViewOf(registered, "scm").querySelector("#graph-next")).toBe(next);
        expect(() => service.setViewBody("scm.graph", next)).not.toThrow();
    });

    it("виджет заголовка хранится в реестре и отдаётся отрисовке", () => {
        const { service } = makeHarness();
        service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        service.registerView(view("scm.changes", "scm", 10));
        expect(service.getViewTitleWidget("scm.changes")).toBeNull();

        const widget = new FillerElement();
        service.setViewTitleWidget("scm.changes", widget);
        expect(service.getViewTitleWidget("scm.changes")).toBe(widget);
    });
});
