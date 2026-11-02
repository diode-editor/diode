import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import type { MenuEntry, MenuSubmenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { describe, expect, it } from "vitest";

import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { SIDEBAR_VIEWS_STATE, VIEWS_CUSTOMIZATIONS_STATE } from "../../../common/stateKeys.ts";

import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";
import { ViewWelcomeElement } from "./viewWelcomeElement.ts";

const TERMINAL = "workbench.panel.terminal";
const OUTPUT = "workbench.panel.output";
const EXPLORER = "workbench.view.explorer";
const SEARCH = "workbench.view.search";
const STORE = "workbench.view.extensions";

/**
 * An app-like layout: the sidebar (Explorer by default, Search, and a marketplace that
 * rejects foreign views) and the panel (Output, Terminal). All views except the
 * marketplace are movable.
 */
function workbench(stored?: ReadonlyMap<string, unknown>): IViewsHarness {
    const h = makeViewsHarness();
    for (const [key, value] of stored ?? []) h.stored.set(key, value);
    h.service.registerContainer({ id: EXPLORER, title: "EXPLORER", location: "sidebar", order: 0, isDefault: true });
    h.service.registerContainer({ id: SEARCH, title: "SEARCH", location: "sidebar", order: 1 });
    h.service.registerContainer({
        id: STORE,
        title: "EXTENSIONS",
        location: "sidebar",
        order: 3,
        rejectAddedViews: true,
    });
    h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel", order: 1 });
    h.service.registerContainer({ id: TERMINAL, title: "TERMINAL", location: "panel", order: 2 });
    h.service.registerView(testView("explorer", EXPLORER, 10, { canMoveView: true }));
    h.service.registerView(testView("search", SEARCH, 10, { canMoveView: true }));
    h.service.registerView(testView("extensions", STORE, 10));
    h.service.registerView(testView("output", OUTPUT, 10, { canMoveView: true }));
    h.service.registerView(testView("terminal", TERMINAL, 10, { canMoveView: true }));
    h.service.attachRegisteredContainers();
    return h;
}

function tabs(h: IViewsHarness, part: "panel" | "auxiliarybar"): string[] {
    const service = part === "panel" ? h.panelService : h.auxiliaryBarService;
    return service.getViews().map((view) => view.title);
}

function body(viewId: string) {
    return (h: IViewsHarness) =>
        h.paneView(h.service.getViewContainerByViewId(viewId)!).querySelector(`#${viewId}-body`);
}

function customizations(h: IViewsHarness) {
    return h.stored.get(VIEWS_CUSTOMIZATIONS_STATE.key) as typeof VIEWS_CUSTOMIZATIONS_STATE.default | undefined;
}

describe("ViewsService — moving a view into a new container (moveViewToLocation)", () => {
    it("TERMINAL moves into the secondary side bar as its own tab with its title", () => {
        const h = workbench();
        const terminalBody = body("terminal")(h);
        h.service.moveViewToLocation("terminal", "auxiliarybar");

        expect(tabs(h, "auxiliarybar")).toEqual(["TERMINAL"]);
        expect(tabs(h, "panel")).toEqual(["OUTPUT"]);
        const container = h.service.getViewContainerByViewId("terminal")!;
        expect(container).toMatch(/^workbench\.views\.service\.auxiliarybar\.[0-9a-f-]{36}$/);
        expect(h.service.getViewContainerLocation(container)).toBe("auxiliarybar");
        // The very same body moved over — the live widget is not recreated.
        expect(body("terminal")(h)).toBe(terminalBody);
        expect(terminalBody?.getAncestorPath()).toContain(h.auxiliaryBarService.getViews()[0].content);
    });

    it("the only section of the new container is merged: the tab serves as the header", () => {
        const h = workbench();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        const container = h.service.getViewContainerByViewId("terminal")!;
        expect(h.paneView(container).querySelector("#paneHeader-terminal")!.hidden).toBe(true);
    });

    it("into the sidebar as a new viewlet titled with the view name", () => {
        const h = workbench();
        h.service.moveViewToLocation("output", "sidebar");
        const container = h.service.getViewContainerByViewId("output")!;
        expect(h.viewlets).toContain(container);
        expect(h.header(container)).toBeNull();
        expect(tabs(h, "panel")).toEqual(["TERMINAL"]);
    });

    it("an immovable view stays in place, no stray container is left", () => {
        const h = workbench();
        h.service.moveViewToLocation("extensions", "auxiliarybar");
        expect(h.service.getViewContainerByViewId("extensions")).toBe(STORE);
        expect(tabs(h, "auxiliarybar")).toEqual([]);
        expect(h.service.getViewContainers().map((c) => c.id)).not.toContainEqual(
            expect.stringMatching(/^workbench\.views\.service/),
        );
    });

    it("an unknown view is a no-op", () => {
        const h = workbench();
        h.service.moveViewToLocation("ghost", "panel");
        expect(tabs(h, "panel")).toEqual(["OUTPUT", "TERMINAL"]);
    });
});

describe("ViewsService — moving into an existing container (moveViewsToContainer)", () => {
    it("the view becomes a section of the container, the emptied source leaves its location", () => {
        const h = workbench();
        h.service.moveViewsToContainer(["terminal"], OUTPUT);
        expect(h.service.getContainerViews(OUTPUT).map((v) => v.id)).toEqual(["output", "terminal"]);
        expect(tabs(h, "panel")).toEqual(["OUTPUT"]);
        expect(h.paneView(OUTPUT).querySelector("#paneHeader-terminal")!.hidden).toBe(false);
    });

    it("a generated container whose last view left disappears together with its section state", () => {
        const h = workbench();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        const generated = h.service.getViewContainerByViewId("terminal")!;
        h.stored.set(SIDEBAR_VIEWS_STATE.key, {
            [generated]: { collapsed: {}, weights: {} },
            other: { collapsed: {}, weights: {} },
        });
        h.service.moveViewsToContainer(["terminal"], TERMINAL);
        expect(h.service.getViewContainerLocation(generated)).toBeNull();
        expect(tabs(h, "auxiliarybar")).toEqual([]);
        expect(Object.keys(h.stored.get(SIDEBAR_VIEWS_STATE.key) as object)).toEqual(["other"]);
    });

    it("a view returning to its container puts the tab back at its order position", () => {
        const h = workbench();
        h.service.moveViewToLocation("output", "auxiliarybar");
        expect(tabs(h, "panel")).toEqual(["TERMINAL"]);
        h.service.resetViewLocation("output");
        expect(tabs(h, "panel")).toEqual(["OUTPUT", "TERMINAL"]);
    });

    it("a container rejecting foreign views does not accept them; its own view it takes back", () => {
        const h = workbench();
        h.service.moveViewsToContainer(["search"], STORE);
        expect(h.service.getViewContainerByViewId("search")).toBe(SEARCH);
    });

    it("moving into an unregistered container or the same one is a no-op", () => {
        const h = workbench();
        h.service.moveViewsToContainer(["terminal"], "ghost");
        h.service.moveViewsToContainer(["terminal"], TERMINAL);
        expect(tabs(h, "panel")).toEqual(["OUTPUT", "TERMINAL"]);
        expect(customizations(h)).toBeUndefined();
    });

    it("a hidden section moved out of the container does not leave all others hidden", () => {
        const h = workbench();
        h.service.moveViewsToContainer(["terminal"], OUTPUT);
        h.service.setViewVisible("output", false);
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        expect(h.service.isViewVisible("output")).toBe(true);
    });
});

describe("ViewsService — moving a whole container (moveViewContainerToLocation)", () => {
    it("a panel tab becomes a secondary side bar tab", () => {
        const h = workbench();
        h.service.moveViewContainerToLocation(TERMINAL, "auxiliarybar");
        expect(tabs(h, "auxiliarybar")).toEqual(["TERMINAL"]);
        expect(tabs(h, "panel")).toEqual(["OUTPUT"]);
        expect(h.service.getViewContainerLocation(TERMINAL)).toBe("auxiliarybar");
        expect(h.service.getDefaultViewContainerLocation(TERMINAL)).toBe("panel");
    });

    it("an active viewlet moved out of the sidebar gives way to the default one", () => {
        const h = workbench();
        h.showViewlet(SEARCH);
        h.service.moveViewContainerToLocation(SEARCH, "panel");
        expect(h.viewlets).not.toContain(SEARCH);
        expect(h.shownViewlets.at(-1)).toEqual({ id: EXPLORER, reveal: false });
        expect(tabs(h, "panel")).toEqual(["OUTPUT", "TERMINAL", "SEARCH"]);
    });

    it("if the default moved too, the first remaining viewlet is shown", () => {
        const h = workbench();
        h.service.moveViewContainerToLocation(EXPLORER, "auxiliarybar");
        expect(h.shownViewlets.at(-1)).toEqual({ id: SEARCH, reveal: false });
    });

    it("moving to the same location and moving an unregistered container is a no-op", () => {
        const h = workbench();
        h.service.moveViewContainerToLocation(TERMINAL, "panel");
        h.service.moveViewContainerToLocation("ghost", "panel");
        h.service.resetViewContainerLocation("ghost");
        expect(customizations(h)).toBeUndefined();
    });
});

describe("ViewsService — persisting moves (views.customizations)", () => {
    it("writes only differences from the default", () => {
        const h = workbench();
        h.service.moveViewContainerToLocation(SEARCH, "auxiliarybar");
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        const generated = h.service.getViewContainerByViewId("terminal")!;
        expect(customizations(h)).toEqual({
            viewContainerLocations: { [SEARCH]: "auxiliarybar", [generated]: "auxiliarybar" },
            viewLocations: { terminal: generated },
        });

        h.service.resetViewLocation("terminal");
        h.service.resetViewContainerLocation(SEARCH);
        expect(customizations(h)).toEqual({ viewContainerLocations: {}, viewLocations: {} });
    });

    it("the next launch builds containers directly in their locations", () => {
        const first = workbench();
        first.service.moveViewContainerToLocation(SEARCH, "panel");
        first.service.moveViewToLocation("terminal", "auxiliarybar");
        const generated = first.service.getViewContainerByViewId("terminal")!;

        const second = workbench(first.stored);
        expect(second.service.getViewContainerLocation(SEARCH)).toBe("panel");
        expect(second.service.getViewContainerByViewId("terminal")).toBe(generated);
        expect(tabs(second, "auxiliarybar")).toEqual(["TERMINAL"]);
        expect(tabs(second, "panel")).toEqual(["OUTPUT", "SEARCH"]);
        expect(second.viewlets).not.toContain(SEARCH);
    });

    it("the location of a generated container without a record comes from its id", () => {
        const id = "workbench.views.service.sidebar.0000";
        const h = workbench(
            new Map([[VIEWS_CUSTOMIZATIONS_STATE.key, { viewContainerLocations: {}, viewLocations: { output: id } }]]),
        );
        expect(h.service.getViewContainerLocation(id)).toBe("sidebar");
        expect(h.viewlets).toContain(id);
    });

    it("garbage in storage is silently skipped", () => {
        const h = workbench(
            new Map([
                [
                    VIEWS_CUSTOMIZATIONS_STATE.key,
                    {
                        viewContainerLocations: { [SEARCH]: "nowhere", ghost: "panel" },
                        viewLocations: {
                            ghost: OUTPUT,
                            extensions: OUTPUT,
                            search: "unknown.container",
                            // A generated container id whose location part is garbage.
                            output: "workbench.views.service.nowhere.0000",
                        },
                    },
                ],
            ]),
        );
        expect(h.service.getViewContainerLocation(SEARCH)).toBe("sidebar");
        expect(h.service.getViewContainerByViewId("extensions")).toBe(STORE);
        expect(h.service.getViewContainerByViewId("search")).toBe(SEARCH);
        expect(h.service.getViewContainerByViewId("output")).toBe(OUTPUT);
        expect(h.service.getViewContainerLocation("workbench.views.service.nowhere.0000")).toBeNull();
    });

    it("a stale entry that points a view to its own container (a default that moved) changes nothing", () => {
        const h = workbench(
            new Map([
                [VIEWS_CUSTOMIZATIONS_STATE.key, { viewContainerLocations: {}, viewLocations: { terminal: TERMINAL } }],
            ]),
        );
        expect(h.service.getViewContainerByViewId("terminal")).toBe(TERMINAL);
        expect(h.service.getContainerViews(TERMINAL).map((v) => v.id)).toEqual(["terminal"]);
        expect(tabs(h, "panel")).toEqual(["OUTPUT", "TERMINAL"]);
    });

    it("restoring moves does not rewrite storage", () => {
        const stored = new Map([
            [VIEWS_CUSTOMIZATIONS_STATE.key, { viewContainerLocations: { [SEARCH]: "panel" }, viewLocations: {} }],
        ]);
        const h = workbench(stored);
        expect(customizations(h)).toEqual({ viewContainerLocations: { [SEARCH]: "panel" }, viewLocations: {} });
    });

    it("a view registered after restore goes where it was", () => {
        const h = workbench(
            new Map([
                [VIEWS_CUSTOMIZATIONS_STATE.key, { viewContainerLocations: {}, viewLocations: { late: OUTPUT } }],
            ]),
        );
        h.service.registerView(testView("late", SEARCH, 20, { canMoveView: true }));
        expect(h.service.getViewContainerByViewId("late")).toBe(OUTPUT);
        expect(h.service.getDefaultContainerById("late")).toBe(SEARCH);
    });

    it("switching the workspace reads moves from its storage", () => {
        const h = workbench();
        h.service.moveViewContainerToLocation(SEARCH, "panel");
        h.stored.set(VIEWS_CUSTOMIZATIONS_STATE.key, {
            viewContainerLocations: {},
            viewLocations: { terminal: OUTPUT },
        });
        let changes = 0;
        h.service.onDidChangeLocations(() => changes++);
        h.openWorkspace();
        expect(h.service.getViewContainerLocation(SEARCH)).toBe("sidebar");
        expect(h.service.getViewContainerByViewId("terminal")).toBe(OUTPUT);
        expect(changes).toBe(1);
        // Switching projects is not a user action: the project's store is not rewritten.
        expect(customizations(h)).toEqual({ viewContainerLocations: {}, viewLocations: { terminal: OUTPUT } });
    });

    it("switching the workspace before the first restore touches nothing", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
        h.service.registerView(testView("output", OUTPUT, 10, { canMoveView: true }));
        let changes = 0;
        h.service.onDidChangeLocations(() => changes++);
        h.openWorkspace();
        expect(changes).toBe(0);
    });
});

describe("ViewsService — Reset View Locations", () => {
    it("all views and containers return to default locations, generated ones disappear", () => {
        const h = workbench();
        h.service.moveViewContainerToLocation(SEARCH, "auxiliarybar");
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        h.service.moveViewsToContainer(["output"], EXPLORER);
        let changes = 0;
        h.service.onDidChangeLocations(() => changes++);

        h.service.resetViewLocations();
        expect(tabs(h, "panel")).toEqual(["OUTPUT", "TERMINAL"]);
        expect(tabs(h, "auxiliarybar")).toEqual([]);
        expect(h.service.getViewContainerLocation(SEARCH)).toBe("sidebar");
        expect(h.service.getContainerViews(EXPLORER).map((v) => v.id)).toEqual(["explorer"]);
        expect(customizations(h)).toEqual({ viewContainerLocations: {}, viewLocations: {} });
        expect(changes).toBe(1);
    });
});

describe("ViewsService — opening a view or container in its location", () => {
    it("openView activates the part's tab as the user would and shows the part", () => {
        const h = workbench();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        const activated: string[] = [];
        h.auxiliaryBarService.onDidActivateView((id) => activated.push(id));
        h.service.openView("terminal");
        expect(h.auxiliaryBarService.visible).toBe(true);
        expect(activated).toEqual([h.service.getViewContainerByViewId("terminal")]);
    });

    it("openView with focus calls the view's focus, reveals a hidden section", () => {
        const h = makeViewsHarness();
        let focused = 0;
        h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
        h.service.registerView(testView("output", OUTPUT, 10));
        h.service.registerView(testView("log", OUTPUT, 20, { focus: () => focused++ }));
        h.service.attachContainer(OUTPUT);
        h.service.setViewVisible("log", false);
        h.service.openView("log", true);
        expect(h.service.isViewVisible("log")).toBe(true);
        expect(focused).toBe(1);
    });

    it("a sidebar viewlet is shown with reveal", () => {
        const h = workbench();
        h.service.openViewContainer(SEARCH, true);
        expect(h.shownViewlets.at(-1)).toEqual({ id: SEARCH, reveal: true, focus: true });
    });

    it("unknown ids are a no-op", () => {
        const h = workbench();
        h.service.openView("ghost", true);
        h.service.openViewContainer("ghost");
        expect(h.panelService.visible).toBe(false);
    });
});

describe("ViewsService — move menu", () => {
    function tabMenu(h: IViewsHarness, containerId: string, part: "panel" | "auxiliarybar" = "panel"): MenuEntry[] {
        const service = part === "panel" ? h.panelService : h.auxiliaryBarService;
        service.requestTabContextMenu({
            id: containerId,
            anchor: { screenX: 3, screenY: 4 },
            owner: h.root(containerId),
        });
        return h.shown.at(-1)!.getEntries!();
    }

    function labels(entries: readonly MenuEntry[]): string[] {
        return entries.map((entry) => (entry.type === "separator" ? "---" : entry.label));
    }

    function moveTo(entries: readonly MenuEntry[]): { readonly entries: readonly MenuEntry[] } {
        const found = entries.find(
            (entry) => entry.type === "submenu" && entry.label === "Move To",
        ) as MenuSubmenuEntry;
        return { ...found, entries: typeof found.entries === "function" ? found.entries() : found.entries };
    }

    function select(entries: readonly MenuEntry[], label: string): void {
        const entry = entries.find((e) => e.type !== "separator" && e.label === label);
        if (entry === undefined || entry.type === "separator" || entry.type === "submenu") throw new Error(label);
        entry.onSelect?.();
    }

    it("panel tab: 'Move To' offers Primary Side Bar and Secondary Side Bar, anchored at the tab", () => {
        const h = workbench();
        const entries = tabMenu(h, TERMINAL);
        expect(labels(entries)).toEqual(["Move To"]);
        expect(labels(moveTo(entries).entries)).toEqual(["Primary Side Bar", "Secondary Side Bar"]);
        expect(h.shown.at(-1)!.getAnchor()).toEqual({ screenX: 3, screenY: 4 });
        expect(h.shown.at(-1)!.getOwner()).toBe(h.root(TERMINAL));
    });

    it("an item moves the container and opens it in the new location", () => {
        const h = workbench();
        select(moveTo(tabMenu(h, TERMINAL)).entries, "Secondary Side Bar");
        expect(h.service.getViewContainerLocation(TERMINAL)).toBe("auxiliarybar");
        expect(h.auxiliaryBarService.visible).toBe(true);
        expect(h.auxiliaryBarService.getActiveViewId()).toBe(TERMINAL);
    });

    it("out of place: 'Reset Location' returns the container", () => {
        const h = workbench();
        h.service.moveViewContainerToLocation(TERMINAL, "auxiliarybar");
        const entries = tabMenu(h, TERMINAL, "auxiliarybar");
        expect(labels(entries)).toEqual(["Move To", "Reset Location"]);
        expect(labels(moveTo(entries).entries)).toEqual(["Primary Side Bar", "Panel"]);
        select(entries, "Reset Location");
        expect(h.service.getViewContainerLocation(TERMINAL)).toBe("panel");
        expect(h.panelService.visible).toBe(true);
    });

    it("generated container with one view: 'Reset Location' returns the view home", () => {
        const h = workbench();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        const generated = h.service.getViewContainerByViewId("terminal")!;
        const entries = tabMenu(h, generated, "auxiliarybar");
        expect(labels(entries)).toEqual(["Move To", "Reset Location"]);
        select(entries, "Reset Location");
        expect(h.service.getViewContainerByViewId("terminal")).toBe(TERMINAL);
        expect(h.panelService.getActiveViewId()).toBe(TERMINAL);
    });

    it("generated with two views: 'Reset Location' is not offered", () => {
        const h = workbench();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        const generated = h.service.getViewContainerByViewId("terminal")!;
        h.service.moveViewsToContainer(["output"], generated);
        expect(labels(tabMenu(h, generated, "auxiliarybar"))).toEqual(["Move To"]);
    });

    it("the menu of an unknown tab does not open", () => {
        const h = workbench();
        h.panelService.requestTabContextMenu({
            id: "ghost",
            anchor: { screenX: 0, screenY: 0 },
            owner: h.root(OUTPUT),
        });
        expect(h.shown).toEqual([]);
    });

    function ids(entries: readonly MenuEntry[]): (string | undefined)[] {
        return entries.map((entry) => (entry.type === "separator" || entry.type === "submenu" ? undefined : entry.id));
    }

    it("items carry stable ids, and choosing one focuses the container in its new location", () => {
        const h = workbench();
        const focused: string[] = [];
        const focus = () => focused.push("terminal");
        h.service.registerView(testView("terminal", TERMINAL, 10, { canMoveView: true, focus }));
        const moves = moveTo(tabMenu(h, TERMINAL)).entries;
        expect(ids(moves)).toEqual([
            `${TERMINAL}.moveViewContainerTo.sidebar`,
            `${TERMINAL}.moveViewContainerTo.auxiliarybar`,
        ]);
        select(moves, "Secondary Side Bar");
        expect(focused).toEqual(["terminal"]);

        const entries = tabMenu(h, TERMINAL, "auxiliarybar");
        expect(ids(entries)).toEqual([undefined, `${TERMINAL}.resetViewContainerLocation`]);
        select(entries, "Reset Location");
        expect(focused).toEqual(["terminal", "terminal"]);
    });

    it("'Reset Location' of a view from a generated container: id from the view and focus on it", () => {
        const h = workbench();
        const focused: string[] = [];
        const focus = () => focused.push("terminal");
        h.service.registerView(testView("terminal", TERMINAL, 10, { canMoveView: true, focus }));
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        const entries = tabMenu(h, h.service.getViewContainerByViewId("terminal")!, "auxiliarybar");
        expect(ids(entries)).toEqual([undefined, "terminal.resetViewLocation"]);
        select(entries, "Reset Location");
        expect(focused).toEqual(["terminal"]);
    });

    it("the submenu of a generated viewlet is labeled with its view name", () => {
        const h = workbench();
        h.service.moveViewToLocation("output", "sidebar");
        const generated = h.service.getViewContainerByViewId("output")!;
        h.paneView(generated).onDidRequestPaneMenu?.("output", { screenX: 0, screenY: 0 });
        const container = h.shown.at(-1)!.getEntries!().find((e) => e.type === "submenu")!;
        expect(container.label).toBe("OUTPUT");
    });

    it("a sidebar viewlet's ⋯ also has 'Move To', without Primary Side Bar", () => {
        const h = workbench();
        h.paneView(SEARCH).onDidRequestPaneMenu?.("search", { screenX: 0, screenY: 0 });
        const container = h.shown.at(-1)!.getEntries!().find((e) => e.type === "submenu")!;
        const own = typeof container.entries === "function" ? container.entries() : container.entries;
        expect(labels(moveTo(own).entries)).toEqual(["Secondary Side Bar", "Panel"]);
    });

    it("for a part tab ⋯ does not duplicate 'Move To'", () => {
        const h = makeViewsHarness([
            { menuId: MenuId.ViewTitle, command: "output.clear", title: "Clear", group: "1_x" },
        ]);
        h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
        h.service.registerView(testView("output", OUTPUT, 10));
        h.service.attachContainer(OUTPUT);
        h.header(OUTPUT)!.onMenu?.({ screenX: 0, screenY: 0 });
        expect(labels(h.shown.at(-1)!.getEntries!())).toEqual(["Clear"]);
    });
});

function storedLocations(viewLocations: Record<string, unknown>, viewContainerLocations: Record<string, unknown> = {}) {
    return new Map([[VIEWS_CUSTOMIZATIONS_STATE.key, { viewContainerLocations, viewLocations }]]);
}

describe("ViewsService — location queries", () => {
    it("an unknown view or container yields null and false", () => {
        const h = workbench();
        // A view registered against an unregistered container.
        h.service.registerView(testView("orphan", "unregistered", 10));
        expect(h.service.getDefaultViewContainerLocation("ghost")).toBeNull();
        expect(h.service.getDefaultViewContainerLocation("unregistered")).toBeNull();
        expect(h.service.getDefaultContainerById("ghost")).toBeNull();
        expect(h.service.canMoveView("ghost")).toBe(false);
        expect(h.service.canMoveView("extensions")).toBe(false);
    });

    it("the container snapshot has only built ones, by location, by order within a location", () => {
        const h = makeViewsHarness();
        const add = (id: string, location: "sidebar" | "panel" | "auxiliarybar", order?: number) => {
            h.service.registerContainer({ id, title: id, location, order });
            h.service.registerView(testView(`${id}View`, id, 10));
        };
        add("aux0", "auxiliarybar", 0);
        add("panel2", "panel", 2);
        add("side5", "sidebar", 5);
        add("panel1", "panel", 1);
        add("sideAny", "sidebar");
        add("side1", "sidebar", 1);
        h.service.registerContainer({ id: "empty", title: "empty", location: "sidebar", order: 0 });
        h.service.attachRegisteredContainers();
        expect(h.service.getViewContainers().map((c) => c.id)).toEqual([
            "side1",
            "side5",
            "sideAny",
            "panel1",
            "panel2",
            "aux0",
        ]);
    });
});

describe("ViewsService — moves: edge cases", () => {
    it("immovable and unknown views do not move directly", () => {
        const h = workbench();
        h.service.moveViewsToContainer(["extensions", "ghost"], OUTPUT);
        h.service.resetViewLocation("ghost");
        expect(h.service.getViewContainerByViewId("extensions")).toBe(STORE);
        expect(h.service.getContainerViews(OUTPUT).map((v) => v.id)).toEqual(["output"]);
        expect(customizations(h)).toBeUndefined();
    });

    it("a rejecting container takes its own view back", () => {
        const h = workbench();
        h.service.registerView(testView("recommended", STORE, 20, { canMoveView: true }));
        h.service.moveViewsToContainer(["recommended"], OUTPUT);
        h.service.moveViewsToContainer(["recommended"], STORE);
        expect(h.service.getViewContainerByViewId("recommended")).toBe(STORE);
    });

    it("an immovable view to a new location: the empty generated container never reaches storage", () => {
        const h = workbench();
        h.service.moveViewToLocation("extensions", "auxiliarybar");
        h.service.moveViewContainerToLocation(SEARCH, "panel");
        expect(customizations(h)).toEqual({ viewContainerLocations: { [SEARCH]: "panel" }, viewLocations: {} });
    });

    it("a move in which nothing moved does not remove the target", () => {
        const h = workbench();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        const generated = h.service.getViewContainerByViewId("terminal")!;
        // TERMINAL is now empty but not generated; the generated one is not empty.
        h.service.moveViewsToContainer(["extensions"], TERMINAL);
        h.service.moveViewsToContainer(["extensions"], generated);
        h.service.moveViewsToContainer(["terminal"], generated);
        expect(h.service.getViewContainerLocation(TERMINAL)).toBe("panel");
        expect(h.service.getViewContainerLocation(generated)).toBe("auxiliarybar");
    });

    it("an arriving view becomes a section by order, by id on equal order", () => {
        const h = workbench();
        h.service.registerView(testView("zzz", OUTPUT, 5));
        h.service.registerView(testView("aaa", SEARCH, 10, { canMoveView: true }));
        h.service.moveViewsToContainer(["terminal"], OUTPUT);
        h.service.moveViewsToContainer(["aaa"], OUTPUT);
        expect(h.service.getContainerViews(OUTPUT).map((v) => v.id)).toEqual(["zzz", "aaa", "output", "terminal"]);
    });

    it("a moved hidden section does not take its neighbors' hidden state and does not come back hidden", () => {
        const h = workbench();
        h.service.registerView(testView("log", OUTPUT, 20));
        h.service.moveViewsToContainer(["terminal"], OUTPUT);
        // OUTPUT: output, terminal, log — the first and second are hidden.
        h.service.setViewVisible("output", false);
        h.service.setViewVisible("terminal", false);
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        expect(h.service.isViewVisible("output")).toBe(false);
        h.service.moveViewsToContainer(["terminal"], OUTPUT);
        expect(h.service.isViewVisible("terminal")).toBe(true);
        expect(h.service.isViewVisible("output")).toBe(false);
    });

    it("a removed container releases the sections of the old PaneView", () => {
        const h = workbench();
        const old = h.paneView(TERMINAL);
        h.service.moveViewContainerToLocation(TERMINAL, "auxiliarybar");
        expect(old.getPaneIds()).toEqual([]);
        expect(h.paneView(TERMINAL)).not.toBe(old);
        expect(h.paneView(TERMINAL).getPaneIds()).toEqual(["terminal"]);
    });

    it("move: the section is collapsed for subscribers during the build, then expanded again", () => {
        const h = workbench();
        const seen: [string, boolean][] = [];
        h.service.onDidChangeViewExpanded(({ viewId, expanded }) => seen.push([viewId, expanded]));
        h.service.moveViewContainerToLocation(TERMINAL, "auxiliarybar");
        expect(seen).toEqual([
            ["terminal", false],
            ["terminal", true],
        ]);
    });

    it("a moved container builds with its own section state", () => {
        const h = makeViewsHarness();
        h.stored.set(SIDEBAR_VIEWS_STATE.key, { [OUTPUT]: { collapsed: { log: true }, weights: {} } });
        h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
        h.service.registerView(testView("output", OUTPUT, 10));
        h.service.registerView(testView("log", OUTPUT, 20));
        h.service.attachContainer(OUTPUT);
        h.service.moveViewContainerToLocation(OUTPUT, "auxiliarybar");
        expect(h.paneView(OUTPUT).isCollapsed("log")).toBe(true);
    });

    it("removing an inactive viewlet and a part tab leaves the active viewlet alone", () => {
        const h = workbench();
        const before = h.shownViewlets.length;
        h.service.moveViewContainerToLocation(TERMINAL, "auxiliarybar");
        h.service.moveViewContainerToLocation(SEARCH, "panel");
        h.service.resetViewLocations();
        expect(h.shownViewlets.length).toBe(before);
    });

    it("reset does not rebuild containers that are at home", () => {
        const h = workbench();
        h.showViewlet(SEARCH);
        const before = h.shownViewlets.length;
        h.service.resetViewLocations();
        expect(h.shownViewlets.length).toBe(before);
    });

    it("reset does not reveal hidden sections that are at home", () => {
        const h = workbench();
        h.service.registerView(testView("log", OUTPUT, 20));
        h.service.setViewVisible("log", false);
        h.service.moveViewContainerToLocation(SEARCH, "panel");
        h.service.resetViewLocations();
        expect(h.service.isViewVisible("log")).toBe(false);
    });

    it("a moved default is replaced by a sidebar viewlet, not a container of another location", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: EXPLORER, title: "E", location: "sidebar", order: 0, isDefault: true });
        h.service.registerContainer({ id: OUTPUT, title: "O", location: "panel", order: 1 });
        h.service.registerContainer({ id: SEARCH, title: "S", location: "sidebar", order: 2 });
        h.service.registerView(testView("explorer", EXPLORER, 10));
        h.service.registerView(testView("output", OUTPUT, 10));
        h.service.registerView(testView("search", SEARCH, 10));
        h.service.attachRegisteredContainers();
        h.service.moveViewContainerToLocation(EXPLORER, "auxiliarybar");
        expect(h.shownViewlets.at(-1)).toEqual({ id: SEARCH, reveal: false });
    });

    it("without a default, the moved one is replaced by the first viewlet by order, not by registration", () => {
        const h = makeViewsHarness();
        for (const [id, order] of [
            ["s3", 3],
            ["s1", 1],
            ["s2", 2],
        ] as const) {
            h.service.registerContainer({ id, title: id, location: "sidebar", order });
            h.service.registerView(testView(`${id}View`, id, 10));
        }
        h.service.attachRegisteredContainers();
        h.showViewlet("s2");
        h.service.moveViewContainerToLocation("s2", "panel");
        expect(h.shownViewlets.at(-1)).toEqual({ id: "s1", reveal: false });
    });

    it("a view in an unregistered container does not interfere with moves, reset and restore", () => {
        const h = workbench();
        h.service.registerView(testView("orphan", "unregistered", 10, { canMoveView: true }));
        h.service.moveViewContainerToLocation(SEARCH, "panel");
        h.service.resetViewLocations();
        h.openWorkspace();
        expect(customizations(h)).toEqual({ viewContainerLocations: {}, viewLocations: {} });
        expect(h.service.getViewContainerLocation("unregistered")).toBeNull();
    });

    it("moving there and back without section state creates no section storage", () => {
        const h = workbench();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        h.service.resetViewLocation("terminal");
        expect(h.stored.has(SIDEBAR_VIEWS_STATE.key)).toBe(false);
    });

    it("a move before the first restore is also stored", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
        h.service.registerView(testView("output", OUTPUT, 10, { canMoveView: true }));
        h.service.attachContainer(OUTPUT);
        h.service.moveViewContainerToLocation(OUTPUT, "auxiliarybar");
        expect(customizations(h)).toEqual({ viewContainerLocations: { [OUTPUT]: "auxiliarybar" }, viewLocations: {} });
    });
});

describe("ViewsService — restoring moves: edge cases", () => {
    it("an id that only looks generated and a non-string in storage set no location", () => {
        // Same length as the "workbench.views.service." prefix, but not it.
        const fake = "workbench.views.servicX.panel.0000";
        const h = workbench(storedLocations({ terminal: fake, output: null }));
        expect(h.service.getViewContainerByViewId("terminal")).toBe(TERMINAL);
        expect(h.service.getViewContainerByViewId("output")).toBe(OUTPUT);
        expect(h.service.getViewContainerLocation(fake)).toBeNull();
    });

    it("late view: without a record, immovable, or without a stored location, they go into their own container", () => {
        const h = workbench(storedLocations({ pinned: OUTPUT, lost: "unknown.container", odd: 42 }));
        h.service.registerView(testView("late", SEARCH, 20, { canMoveView: true }));
        h.service.registerView(testView("pinned", SEARCH, 30));
        h.service.registerView(testView("lost", SEARCH, 40, { canMoveView: true }));
        h.service.registerView(testView("odd", SEARCH, 50, { canMoveView: true }));
        expect(h.paneView(SEARCH).getPaneIds()).toEqual(["search", "late", "pinned", "lost", "odd"]);
    });

    it("switching the workspace rebuilds both the emptied source and the target", () => {
        const h = workbench();
        h.stored.set(VIEWS_CUSTOMIZATIONS_STATE.key, {
            viewContainerLocations: {},
            viewLocations: { terminal: OUTPUT },
        });
        h.openWorkspace();
        expect(tabs(h, "panel")).toEqual(["OUTPUT"]);
        expect(h.paneView(OUTPUT).getPaneIds()).toEqual(["output", "terminal"]);
    });

    it("switching the workspace: a stored location equal to the current one does not rebuild the container", () => {
        const h = workbench();
        h.stored.set(VIEWS_CUSTOMIZATIONS_STATE.key, {
            viewContainerLocations: { [SEARCH]: "sidebar" },
            viewLocations: {},
        });
        h.showViewlet(SEARCH);
        const before = h.shownViewlets.length;
        h.openWorkspace();
        expect(h.shownViewlets.length).toBe(before);
    });

    it("reset on workspace switch keeps generated containers' section state, and later moves are stored", () => {
        const h = workbench();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        const generated = h.service.getViewContainerByViewId("terminal")!;
        h.stored.set(SIDEBAR_VIEWS_STATE.key, { [generated]: { collapsed: {}, weights: {} } });
        h.openWorkspace();
        expect(Object.keys(h.stored.get(SIDEBAR_VIEWS_STATE.key) as object)).toEqual([generated]);
        h.service.moveViewContainerToLocation(SEARCH, "panel");
        expect(customizations(h)?.viewContainerLocations).toEqual({ [generated]: "auxiliarybar", [SEARCH]: "panel" });
    });
});

describe("ViewsService — section hidden state from storage", () => {
    function scene(stored: { hidden: string[] }) {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
        h.service.registerView(testView("output", OUTPUT, 10));
        h.service.registerView(testView("log", OUTPUT, 20, { canToggleVisibility: false }));
        h.service.registerView(testView("trace", OUTPUT, 30));
        h.service.attachContainer(OUTPUT);
        h.stored.set(SIDEBAR_VIEWS_STATE.key, { [OUTPUT]: { collapsed: {}, weights: {}, ...stored } });
        h.service.restoreViewsState();
        return h;
    }

    const visibility = (h: IViewsHarness) => ["output", "log", "trace"].map((id) => h.service.isViewVisible(id));

    it("storage does not hide a non-toggleable or unknown section, but hides the rest", () => {
        expect(visibility(scene({ hidden: ["log", "ghost", "trace"] }))).toEqual([true, true, false]);
    });

    it("hidden state from new storage replaces the previous one", () => {
        const h = scene({ hidden: ["trace"] });
        h.stored.set(SIDEBAR_VIEWS_STATE.key, { [OUTPUT]: { collapsed: {}, weights: {}, hidden: [] } });
        h.service.restoreViewsState();
        expect(visibility(h)).toEqual([true, true, true]);
    });

    it("a hidden first section stays hidden if visible ones exist", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
        h.service.registerView(testView("output", OUTPUT, 10));
        h.service.registerView(testView("log", OUTPUT, 20));
        h.service.attachContainer(OUTPUT);
        h.stored.set(SIDEBAR_VIEWS_STATE.key, { [OUTPUT]: { collapsed: {}, weights: {}, hidden: ["output"] } });
        h.service.restoreViewsState();
        expect(h.service.isViewVisible("output")).toBe(false);
    });
});

describe("ViewsService — focus on open", () => {
    it("focus does not move unless asked; a welcome with a button takes focus", () => {
        const h = makeViewsHarness();
        const focused: string[] = [];
        h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
        h.service.registerView(testView("output", OUTPUT, 10, { focus: () => focused.push("output") }));
        h.service.registerView(
            testView("welcome", OUTPUT, 20, {
                body: null,
                placeholder: [{ kind: "button", label: "Open Folder", command: "openFolder" }],
                focus: () => focused.push("welcome"),
            }),
        );
        h.service.attachContainer(OUTPUT);
        h.service.openViewContainer(OUTPUT);
        h.service.openView("output");
        expect(focused).toEqual([]);
        h.service.openView("welcome", true);
        expect(focused).toEqual([]);
        h.service.openView("output", true);
        expect(focused).toEqual(["output"]);
    });

    it("a built-in welcome runs its command buttons; a URL target is not a command", () => {
        const h = makeViewsHarness();
        const ran: unknown[][] = [];
        h.commands.register("openFolder", (...args: unknown[]) => ran.push(args));
        const execute = h.commands.execute.bind(h.commands);
        const executed: string[] = [];
        h.commands.execute = (id, ...args) => {
            executed.push(id);
            return execute(id, ...args);
        };
        h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
        h.service.registerView(
            testView("welcome", OUTPUT, 20, {
                body: null,
                placeholder: [
                    { kind: "button", label: "Docs", url: "https://example.invalid" },
                    { kind: "button", label: "Open Folder", command: "openFolder", args: ["x"] },
                ],
            }),
        );
        h.service.attachContainer(OUTPUT);
        h.service.openViewContainer(OUTPUT);

        const find = (element: TUIElement): ViewWelcomeElement | undefined =>
            element instanceof ViewWelcomeElement
                ? element
                : element
                      .getChildren()
                      .reduce<ViewWelcomeElement | undefined>((found, child) => found ?? find(child), undefined);
        const welcome = find(h.root(OUTPUT))!;
        for (const child of welcome.getChildren()) if (child instanceof ButtonElement) child.onActivate?.();

        expect(executed).toEqual(["openFolder"]);
        expect(ran).toEqual([["x"]]);
    });
});
