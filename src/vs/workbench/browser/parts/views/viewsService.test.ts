import { describe, expect, it, vi } from "vitest";

import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { FillerElement } from "../../../../../../tuidom/ui/layout/fillerElement.ts";
import { TitledPanelElement } from "../../../../../../tuidom/ui/titledpanel/titledPanelElement.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { IContextMenuMenuDelegate } from "../../../../platform/contextview/common/contextMenuDelegate.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import { SIDEBAR_VIEWS_STATE } from "../../../common/stateKeys.ts";
import type { SidebarService } from "../sidebar/sidebarService.ts";

import { PaneViewElement } from "./paneViewElement.ts";
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
    const viewlet = registered.get(containerId)!.view as TitledPanelElement;
    return viewlet.querySelector(`#viewContainer-${containerId}`) as PaneViewElement;
}

describe("ViewsService", () => {
    it("attachContainer строит TitledPanel(PaneView) и регистрирует вьюлет", () => {
        const { service, registered } = makeHarness();
        service.registerContainer({ id: "scm", title: "  SOURCE CONTROL" });
        service.registerView(view("scm.changes", "scm", 10));
        service.attachContainer("scm");

        const viewlet = registered.get("scm")!.view;
        expect(viewlet).toBeInstanceOf(TitledPanelElement);
        expect((viewlet as TitledPanelElement).getTitle()).toBe("  SOURCE CONTROL");
        expect(paneViewOf(registered, "scm").getPaneIds()).toEqual(["scm.changes"]);
    });

    it("секции идут по order, а не по порядку регистрации", () => {
        const { service, registered } = makeHarness();
        service.registerContainer({ id: "scm", title: "SCM" });
        service.registerView(view("scm.graph", "scm", 20));
        service.registerView(view("scm.changes", "scm", 10));
        service.attachContainer("scm");
        expect(paneViewOf(registered, "scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });

    it("поздняя регистрация view пересобирает уже построенный контейнер", () => {
        const { service, registered } = makeHarness();
        service.registerContainer({ id: "scm", title: "SCM" });
        service.registerView(view("scm.graph", "scm", 20));
        service.attachContainer("scm");
        service.registerView(view("scm.changes", "scm", 10));
        expect(paneViewOf(registered, "scm").getPaneIds()).toEqual(["scm.changes", "scm.graph"]);
    });

    it("повторный attachContainer — no-op", () => {
        const { service, registered } = makeHarness();
        service.registerContainer({ id: "scm", title: "SCM" });
        service.registerView(view("scm.changes", "scm", 10));
        service.attachContainer("scm");
        const first = registered.get("scm")!.view;
        service.attachContainer("scm");
        expect(registered.get("scm")!.view).toBe(first);
    });

    it("действие пользователя write-through'ом сохраняет свёрнутость и веса", () => {
        const { service, registered, stored } = makeHarness();
        service.registerContainer({ id: "scm", title: "SCM" });
        service.registerView(view("scm.changes", "scm", 10));
        service.registerView(view("scm.graph", "scm", 20));
        service.attachContainer("scm");

        paneViewOf(registered, "scm").toggleCollapsed("scm.graph");
        expect(stored.get(SIDEBAR_VIEWS_STATE.key)).toEqual({
            scm: { collapsed: ["scm.graph"], weights: { "scm.changes": 1, "scm.graph": 1 } },
        });
    });

    it("restoreViewsState применяет сохранённое без write-through", () => {
        const { service, registered, stored } = makeHarness();
        stored.set(SIDEBAR_VIEWS_STATE.key, {
            scm: { collapsed: ["scm.graph"], weights: { "scm.changes": 7, "scm.graph": 3 } },
        });
        service.registerContainer({ id: "scm", title: "SCM" });
        service.registerView(view("scm.changes", "scm", 10));
        service.registerView(view("scm.graph", "scm", 20));
        service.attachContainer("scm");
        const before = stored.get(SIDEBAR_VIEWS_STATE.key);

        service.restoreViewsState();
        const paneView = paneViewOf(registered, "scm");
        expect(paneView.isCollapsed("scm.graph")).toBe(true);
        expect(paneView.getWeights()).toEqual({ "scm.changes": 7, "scm.graph": 3 });
        expect(stored.get(SIDEBAR_VIEWS_STATE.key)).toBe(before);
    });

    it("запрос меню секции открывает ViewMoreActions с контекстом {view}", () => {
        const { service, registered, shown } = makeHarness();
        service.registerContainer({ id: "scm", title: "SCM" });
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

    it("reveal вьюлета фокусирует первую развёрнутую view", () => {
        const { service, registered } = makeHarness();
        const focusChanges = vi.fn();
        const focusGraph = vi.fn();
        service.registerContainer({ id: "scm", title: "SCM" });
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
        service.registerContainer({ id: "scm", title: "SCM" });
        service.attachContainer("scm");
        expect(paneViewOf(registered, "scm").getPaneIds()).toEqual(["scm.changes"]);
    });

    it("повторная регистрация view заменяет дескриптор (идемпотентность setWorkspaceFolder)", () => {
        const { service, registered } = makeHarness();
        service.registerContainer({ id: "scm", title: "SCM" });
        service.registerView(view("scm.changes", "scm", 10));
        service.attachContainer("scm");
        service.registerView(view("scm.changes", "scm", 10));
        expect(paneViewOf(registered, "scm").getPaneIds()).toEqual(["scm.changes"]);
    });

    it("attach незарегистрированного контейнера — ошибки", () => {
        const { service } = makeHarness();
        service.registerView(view("x", "ghost", 1));
        expect(() => service.attachContainer("ghost")).toThrow(/is not registered/);
        expect(() => service.attachContainer("missing")).toThrow(/unknown container id/);
    });
});
