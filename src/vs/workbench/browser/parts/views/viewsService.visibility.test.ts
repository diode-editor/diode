import { describe, expect, it } from "vitest";

import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { FillerElement } from "../../../../../../tuidom/ui/layout/fillerElement.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import { SIDEBAR_VIEWS_STATE } from "../../../common/stateKeys.ts";
import type { SidebarService } from "../sidebar/sidebarService.ts";

import type { PaneViewElement } from "./paneViewElement.ts";
import type { ViewContainerHeaderElement } from "./viewContainerHeaderElement.ts";
import type { IViewDescriptor } from "./viewsService.ts";
import { ViewsService } from "./viewsService.ts";

interface Harness {
    readonly service: ViewsService;
    readonly stored: Map<string, unknown>;
    paneView(containerId: string): PaneViewElement;
    header(containerId: string): ViewContainerHeaderElement | null;
}

function makeHarness(): Harness {
    const registered = new Map<string, TUIElement>();
    const sidebar = {
        registerViewlet: (id: string, view: TUIElement) => {
            registered.set(id, view);
        },
    } as unknown as SidebarService;
    const contextMenu = { showContextMenu: () => {} } as unknown as ContextMenuService;
    const stored = new Map<string, unknown>();
    const state: IStateService = {
        get<T>(descriptor: IStateDescriptor<T>): T {
            return stored.has(descriptor.key) ? (stored.get(descriptor.key) as T) : descriptor.default;
        },
        store<T>(descriptor: IStateDescriptor<T>, value: T): void {
            stored.set(descriptor.key, value);
        },
        openWorkspace: () => {},
        flushSync: () => {},
    };
    return {
        service: new ViewsService(sidebar, contextMenu, state),
        stored,
        paneView: (containerId) => registered.get(containerId)!.querySelector(`#viewContainer-${containerId}`) as PaneViewElement,
        header: (containerId) =>
            (registered
                .get(containerId)!
                .querySelector(`#viewContainerHeader-${containerId}`) as ViewContainerHeaderElement | null) ?? null,
    };
}

function view(id: string, order: number, extra?: Partial<IViewDescriptor>): IViewDescriptor {
    const body = new FillerElement();
    body.id = `${id}-body`;
    return { id, containerId: "scm", title: id.toUpperCase(), order, body, focus: () => {}, ...extra };
}

/** Контейнер из трёх секций — на двух не видно разницы «скрыли» и «стало merged». */
function threeSectionContainer(): Harness {
    const harness = makeHarness();
    harness.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
    harness.service.registerView(view("scm.changes", 10));
    harness.service.registerView(view("scm.graph", 20));
    harness.service.registerView(view("scm.stashes", 30));
    harness.service.attachContainer("scm");
    return harness;
}

describe("ViewsService — видимость секций", () => {
    it("скрытая секция уходит из контейнера, показанная возвращается на своё место", () => {
        const { service, paneView } = threeSectionContainer();

        service.setViewVisible("scm.graph", false);
        expect(paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.stashes"]);
        expect(service.isViewVisible("scm.graph")).toBe(false);

        service.setViewVisible("scm.graph", true);
        expect(paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.graph", "scm.stashes"]);
        expect(service.isViewVisible("scm.graph")).toBe(true);
    });

    it("свёрнутость и веса соседей переживают скрытие и возврат секции", () => {
        const { service, paneView } = threeSectionContainer();
        paneView("scm").setCollapsed("scm.changes", true);
        paneView("scm").setWeights({ "scm.stashes": 6 });

        service.setViewVisible("scm.graph", false);
        service.setViewVisible("scm.graph", true);

        expect(paneView("scm").isCollapsed("scm.changes")).toBe(true);
        expect(paneView("scm").getWeights()["scm.stashes"]).toBe(6);
    });

    it("последняя видимая секция скрытию не поддаётся — пустой контейнер показывать нечем", () => {
        const { service, paneView } = threeSectionContainer();
        service.setViewVisible("scm.graph", false);
        service.setViewVisible("scm.stashes", false);

        service.setViewVisible("scm.changes", false);

        expect(paneView("scm").getPaneIds()).toEqual(["scm.changes"]);
        expect(service.isViewVisible("scm.changes")).toBe(true);
    });

    it("скрытие предпоследней секции сливает заголовки, возврат — разъезжает", () => {
        const { service, paneView, header } = threeSectionContainer();
        service.setViewVisible("scm.stashes", false);
        service.setViewVisible("scm.graph", false);

        expect(header("scm")).toBeNull();
        expect(paneView("scm").querySelector("#paneHeader-scm-changes")!.inspectState()).toMatchObject({
            title: "SOURCE CONTROL",
            collapsible: false,
        });

        service.setViewVisible("scm.graph", true);
        expect(header("scm")!.inspectState()).toEqual({ title: "SOURCE CONTROL" });
        expect(paneView("scm").querySelector("#paneHeader-scm-changes")!.inspectState()).toMatchObject({
            title: "SCM.CHANGES",
            collapsible: true,
        });
    });

    it("canToggleVisibility: false — секция не скрывается", () => {
        const harness = makeHarness();
        harness.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        harness.service.registerView(view("scm.changes", 10, { canToggleVisibility: false }));
        harness.service.registerView(view("scm.graph", 20));
        harness.service.attachContainer("scm");

        harness.service.setViewVisible("scm.changes", false);
        expect(harness.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });

    it("getContainerViews отдаёт снимок для переключателя", () => {
        const { service } = threeSectionContainer();
        service.setViewVisible("scm.graph", false);
        expect(service.getContainerViews("scm")).toEqual([
            { id: "scm.changes", title: "SCM.CHANGES", visible: true, canToggleVisibility: true },
            { id: "scm.graph", title: "SCM.GRAPH", visible: false, canToggleVisibility: true },
            { id: "scm.stashes", title: "SCM.STASHES", visible: true, canToggleVisibility: true },
        ]);
    });

    it("скрытие — действие пользователя: пишется в стор вместе со свёрнутостью", () => {
        const { service, stored } = threeSectionContainer();
        service.setViewVisible("scm.graph", false);
        expect(stored.get(SIDEBAR_VIEWS_STATE.key)).toMatchObject({ scm: { hidden: ["scm.graph"] } });
    });

    it("повторное скрытие уже скрытой секции — no-op без записи в стор", () => {
        const { service, stored } = threeSectionContainer();
        service.setViewVisible("scm.graph", false);
        stored.delete(SIDEBAR_VIEWS_STATE.key);
        service.setViewVisible("scm.graph", false);
        expect(stored.has(SIDEBAR_VIEWS_STATE.key)).toBe(false);
    });

    it("до attach скрытие только запоминается — контейнер построится уже без секции", () => {
        const harness = makeHarness();
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
        const harness = makeHarness();
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
        const harness = makeHarness();
        harness.stored.set(SIDEBAR_VIEWS_STATE.key, { scm: { collapsed: [], weights: {} } });
        harness.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        harness.service.registerView(view("scm.changes", 10));
        harness.service.registerView(view("scm.graph", 20));
        harness.service.attachContainer("scm");

        harness.service.restoreViewsState();
        expect(harness.paneView("scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });

    it("протухший стор, скрывающий всё, оставляет первую секцию видимой", () => {
        const harness = makeHarness();
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
        const harness = makeHarness();
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
