import type { MenuEntry, MenuSubmenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { describe, expect, it } from "vitest";

import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { SIDEBAR_VIEWS_STATE, VIEWS_CUSTOMIZATIONS_STATE } from "../../../common/stateKeys.ts";

import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";

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

describe("ViewsService — перенос вида в новый контейнер (moveViewToLocation)", () => {
    it("TERMINAL уезжает во вторичную панель отдельной вкладкой со своим названием", () => {
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

    it("единственная секция нового контейнера — merged: заголовком служит таб", () => {
        const h = workbench();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        const container = h.service.getViewContainerByViewId("terminal")!;
        expect(h.paneView(container).querySelector("#paneHeader-terminal")!.hidden).toBe(true);
    });

    it("в сайдбар — новым вьюлетом с названием вида", () => {
        const h = workbench();
        h.service.moveViewToLocation("output", "sidebar");
        const container = h.service.getViewContainerByViewId("output")!;
        expect(h.viewlets).toContain(container);
        expect(h.header(container)).toBeNull();
        expect(tabs(h, "panel")).toEqual(["TERMINAL"]);
    });

    it("непереносимый вид остаётся на месте, лишнего контейнера не остаётся", () => {
        const h = workbench();
        h.service.moveViewToLocation("extensions", "auxiliarybar");
        expect(h.service.getViewContainerByViewId("extensions")).toBe(STORE);
        expect(tabs(h, "auxiliarybar")).toEqual([]);
        expect(h.service.getViewContainers().map((c) => c.id)).not.toContainEqual(
            expect.stringMatching(/^workbench\.views\.service/),
        );
    });

    it("неизвестный вид — no-op", () => {
        const h = workbench();
        h.service.moveViewToLocation("ghost", "panel");
        expect(tabs(h, "panel")).toEqual(["OUTPUT", "TERMINAL"]);
    });
});

describe("ViewsService — перенос в существующий контейнер (moveViewsToContainer)", () => {
    it("вид встаёт секцией контейнера, опустевший источник уходит с места", () => {
        const h = workbench();
        h.service.moveViewsToContainer(["terminal"], OUTPUT);
        expect(h.service.getContainerViews(OUTPUT).map((v) => v.id)).toEqual(["output", "terminal"]);
        expect(tabs(h, "panel")).toEqual(["OUTPUT"]);
        expect(h.paneView(OUTPUT).querySelector("#paneHeader-terminal")!.hidden).toBe(false);
    });

    it("сгенерированный контейнер, из которого ушёл последний вид, исчезает вместе с состоянием секций", () => {
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

    it("вид, вернувшийся в свой контейнер, ставит вкладку на её место по order", () => {
        const h = workbench();
        h.service.moveViewToLocation("output", "auxiliarybar");
        expect(tabs(h, "panel")).toEqual(["TERMINAL"]);
        h.service.resetViewLocation("output");
        expect(tabs(h, "panel")).toEqual(["OUTPUT", "TERMINAL"]);
    });

    it("контейнер, отвергающий чужие виды, их не принимает; свой вид — возвращает", () => {
        const h = workbench();
        h.service.moveViewsToContainer(["search"], STORE);
        expect(h.service.getViewContainerByViewId("search")).toBe(SEARCH);
    });

    it("перенос в незарегистрированный контейнер и в тот же — no-op", () => {
        const h = workbench();
        h.service.moveViewsToContainer(["terminal"], "ghost");
        h.service.moveViewsToContainer(["terminal"], TERMINAL);
        expect(tabs(h, "panel")).toEqual(["OUTPUT", "TERMINAL"]);
        expect(customizations(h)).toBeUndefined();
    });

    it("скрытая секция, уехавшая из контейнера, не оставляет все остальные скрытыми", () => {
        const h = workbench();
        h.service.moveViewsToContainer(["terminal"], OUTPUT);
        h.service.setViewVisible("output", false);
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        expect(h.service.isViewVisible("output")).toBe(true);
    });
});

describe("ViewsService — перенос контейнера целиком (moveViewContainerToLocation)", () => {
    it("вкладка панели становится вкладкой вторичной панели", () => {
        const h = workbench();
        h.service.moveViewContainerToLocation(TERMINAL, "auxiliarybar");
        expect(tabs(h, "auxiliarybar")).toEqual(["TERMINAL"]);
        expect(tabs(h, "panel")).toEqual(["OUTPUT"]);
        expect(h.service.getViewContainerLocation(TERMINAL)).toBe("auxiliarybar");
        expect(h.service.getDefaultViewContainerLocation(TERMINAL)).toBe("panel");
    });

    it("активный вьюлет, уехавший из сайдбара, уступает место дефолтному", () => {
        const h = workbench();
        h.showViewlet(SEARCH);
        h.service.moveViewContainerToLocation(SEARCH, "panel");
        expect(h.viewlets).not.toContain(SEARCH);
        expect(h.shownViewlets.at(-1)).toEqual({ id: EXPLORER, reveal: false });
        expect(tabs(h, "panel")).toEqual(["OUTPUT", "TERMINAL", "SEARCH"]);
    });

    it("уехал и дефолтный — показывается первый оставшийся вьюлет", () => {
        const h = workbench();
        h.service.moveViewContainerToLocation(EXPLORER, "auxiliarybar");
        expect(h.shownViewlets.at(-1)).toEqual({ id: SEARCH, reveal: false });
    });

    it("перенос на то же место и незарегистрированного контейнера — no-op", () => {
        const h = workbench();
        h.service.moveViewContainerToLocation(TERMINAL, "panel");
        h.service.moveViewContainerToLocation("ghost", "panel");
        expect(customizations(h)).toBeUndefined();
    });
});

describe("ViewsService — персист переносов (views.customizations)", () => {
    it("пишет только отличия от дефолта", () => {
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

    it("следующий запуск строит контейнеры сразу на их местах", () => {
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

    it("место сгенерированного контейнера без записи о нём берётся из его id", () => {
        const id = "workbench.views.service.sidebar.0000";
        const h = workbench(
            new Map([[VIEWS_CUSTOMIZATIONS_STATE.key, { viewContainerLocations: {}, viewLocations: { output: id } }]]),
        );
        expect(h.service.getViewContainerLocation(id)).toBe("sidebar");
        expect(h.viewlets).toContain(id);
    });

    it("мусор в сторе молча пропускается", () => {
        const h = workbench(
            new Map([
                [
                    VIEWS_CUSTOMIZATIONS_STATE.key,
                    {
                        viewContainerLocations: { [SEARCH]: "nowhere", ghost: "panel" },
                        viewLocations: { ghost: OUTPUT, extensions: OUTPUT, search: "unknown.container" },
                    },
                ],
            ]),
        );
        expect(h.service.getViewContainerLocation(SEARCH)).toBe("sidebar");
        expect(h.service.getViewContainerByViewId("extensions")).toBe(STORE);
        expect(h.service.getViewContainerByViewId("search")).toBe(SEARCH);
    });

    it("рестор переносов стор не переписывает", () => {
        const stored = new Map([
            [VIEWS_CUSTOMIZATIONS_STATE.key, { viewContainerLocations: { [SEARCH]: "panel" }, viewLocations: {} }],
        ]);
        const h = workbench(stored);
        expect(customizations(h)).toEqual({ viewContainerLocations: { [SEARCH]: "panel" }, viewLocations: {} });
    });

    it("вид, зарегистрированный после рестора, встаёт туда, где стоял", () => {
        const h = workbench(
            new Map([
                [VIEWS_CUSTOMIZATIONS_STATE.key, { viewContainerLocations: {}, viewLocations: { late: OUTPUT } }],
            ]),
        );
        h.service.registerView(testView("late", SEARCH, 20, { canMoveView: true }));
        expect(h.service.getViewContainerByViewId("late")).toBe(OUTPUT);
        expect(h.service.getDefaultContainerById("late")).toBe(SEARCH);
    });

    it("смена проекта читает переносы из его стора", () => {
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

    it("смена проекта до первого рестора ничего не трогает", () => {
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
    it("все виды и контейнеры — на места по умолчанию, сгенерированные исчезают", () => {
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

describe("ViewsService — открыть вид или контейнер на его месте", () => {
    it("openView активирует вкладку части как пользователь и показывает часть", () => {
        const h = workbench();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        const activated: string[] = [];
        h.auxiliaryBarService.onDidActivateView((id) => activated.push(id));
        h.service.openView("terminal");
        expect(h.auxiliaryBarService.visible).toBe(true);
        expect(activated).toEqual([h.service.getViewContainerByViewId("terminal")]);
    });

    it("openView с фокусом зовёт focus вида, скрытую секцию раскрывает", () => {
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

    it("вьюлет сайдбара показывается с раскрытием", () => {
        const h = workbench();
        h.service.openViewContainer(SEARCH, true);
        expect(h.shownViewlets.at(-1)).toEqual({ id: SEARCH, reveal: true });
    });

    it("неизвестное — no-op", () => {
        const h = workbench();
        h.service.openView("ghost", true);
        h.service.openViewContainer("ghost");
        expect(h.panelService.visible).toBe(false);
    });
});

describe("ViewsService — меню переноса", () => {
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

    it("вкладка панели: «Move To» — Primary Side Bar и Secondary Side Bar, якорь от вкладки", () => {
        const h = workbench();
        const entries = tabMenu(h, TERMINAL);
        expect(labels(entries)).toEqual(["Move To"]);
        expect(labels(moveTo(entries).entries)).toEqual(["Primary Side Bar", "Secondary Side Bar"]);
        expect(h.shown.at(-1)!.getAnchor()).toEqual({ screenX: 3, screenY: 4 });
        expect(h.shown.at(-1)!.getOwner()).toBe(h.root(TERMINAL));
    });

    it("пункт переносит контейнер и открывает его на новом месте", () => {
        const h = workbench();
        select(moveTo(tabMenu(h, TERMINAL)).entries, "Secondary Side Bar");
        expect(h.service.getViewContainerLocation(TERMINAL)).toBe("auxiliarybar");
        expect(h.auxiliaryBarService.visible).toBe(true);
        expect(h.auxiliaryBarService.getActiveViewId()).toBe(TERMINAL);
    });

    it("не на своём месте — «Reset Location» возвращает контейнер", () => {
        const h = workbench();
        h.service.moveViewContainerToLocation(TERMINAL, "auxiliarybar");
        const entries = tabMenu(h, TERMINAL, "auxiliarybar");
        expect(labels(entries)).toEqual(["Move To", "Reset Location"]);
        expect(labels(moveTo(entries).entries)).toEqual(["Primary Side Bar", "Panel"]);
        select(entries, "Reset Location");
        expect(h.service.getViewContainerLocation(TERMINAL)).toBe("panel");
        expect(h.panelService.visible).toBe(true);
    });

    it("сгенерированный контейнер с одним видом: «Reset Location» возвращает вид домой", () => {
        const h = workbench();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        const generated = h.service.getViewContainerByViewId("terminal")!;
        const entries = tabMenu(h, generated, "auxiliarybar");
        expect(labels(entries)).toEqual(["Move To", "Reset Location"]);
        select(entries, "Reset Location");
        expect(h.service.getViewContainerByViewId("terminal")).toBe(TERMINAL);
        expect(h.panelService.getActiveViewId()).toBe(TERMINAL);
    });

    it("сгенерированный с двумя видами — «Reset Location» не предлагается", () => {
        const h = workbench();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        const generated = h.service.getViewContainerByViewId("terminal")!;
        h.service.moveViewsToContainer(["output"], generated);
        expect(labels(tabMenu(h, generated, "auxiliarybar"))).toEqual(["Move To"]);
    });

    it("меню незнакомой вкладки не открывается", () => {
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

    it("пункты несут стабильные id, а выбор отдаёт фокус контейнеру на новом месте", () => {
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

    it("«Reset Location» вида из сгенерированного — id от вида и фокус на нём", () => {
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

    it("подменю сгенерированного вьюлета подписано названием его вида", () => {
        const h = workbench();
        h.service.moveViewToLocation("output", "sidebar");
        const generated = h.service.getViewContainerByViewId("output")!;
        h.paneView(generated).onDidRequestPaneMenu?.("output", { screenX: 0, screenY: 0 });
        const container = h.shown.at(-1)!.getEntries!().find((e) => e.type === "submenu")!;
        expect(container.label).toBe("OUTPUT");
    });

    it("«⋯» вьюлета сайдбара тоже несёт «Move To» — без Primary Side Bar", () => {
        const h = workbench();
        h.paneView(SEARCH).onDidRequestPaneMenu?.("search", { screenX: 0, screenY: 0 });
        const container = h.shown.at(-1)!.getEntries!().find((e) => e.type === "submenu")!;
        const own = typeof container.entries === "function" ? container.entries() : container.entries;
        expect(labels(moveTo(own).entries)).toEqual(["Secondary Side Bar", "Panel"]);
    });

    it("у вкладки части «⋯» не дублирует «Move To»", () => {
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

describe("ViewsService — справки о местах", () => {
    it("незнакомый вид или контейнер — null и false", () => {
        const h = workbench();
        // A view registered against an unregistered container.
        h.service.registerView(testView("orphan", "unregistered", 10));
        expect(h.service.getDefaultViewContainerLocation("ghost")).toBeNull();
        expect(h.service.getDefaultViewContainerLocation("unregistered")).toBeNull();
        expect(h.service.getDefaultContainerById("ghost")).toBeNull();
        expect(h.service.canMoveView("ghost")).toBe(false);
        expect(h.service.canMoveView("extensions")).toBe(false);
    });

    it("снимок контейнеров — только собранные, по местам, внутри места по order", () => {
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

describe("ViewsService — переносы: края", () => {
    it("непереносимый и незнакомый вид напрямую не едут", () => {
        const h = workbench();
        h.service.moveViewsToContainer(["extensions", "ghost"], OUTPUT);
        h.service.resetViewLocation("ghost");
        expect(h.service.getViewContainerByViewId("extensions")).toBe(STORE);
        expect(h.service.getContainerViews(OUTPUT).map((v) => v.id)).toEqual(["output"]);
        expect(customizations(h)).toBeUndefined();
    });

    it("свой вид отвергающий контейнер принимает обратно", () => {
        const h = workbench();
        h.service.registerView(testView("recommended", STORE, 20, { canMoveView: true }));
        h.service.moveViewsToContainer(["recommended"], OUTPUT);
        h.service.moveViewsToContainer(["recommended"], STORE);
        expect(h.service.getViewContainerByViewId("recommended")).toBe(STORE);
    });

    it("непереносимый вид в новое место — пустой сгенерированный не доживает даже до стора", () => {
        const h = workbench();
        h.service.moveViewToLocation("extensions", "auxiliarybar");
        h.service.moveViewContainerToLocation(SEARCH, "panel");
        expect(customizations(h)).toEqual({ viewContainerLocations: { [SEARCH]: "panel" }, viewLocations: {} });
    });

    it("перенос, в котором никто не уехал, приёмник не удаляет", () => {
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

    it("приехавший вид встаёт секцией по order, при равном order — по id", () => {
        const h = workbench();
        h.service.registerView(testView("zzz", OUTPUT, 5));
        h.service.registerView(testView("aaa", SEARCH, 10, { canMoveView: true }));
        h.service.moveViewsToContainer(["terminal"], OUTPUT);
        h.service.moveViewsToContainer(["aaa"], OUTPUT);
        expect(h.service.getContainerViews(OUTPUT).map((v) => v.id)).toEqual(["zzz", "aaa", "output", "terminal"]);
    });

    it("уехавшая скрытая секция не уносит скрытость соседей и не возвращается скрытой", () => {
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

    it("снятый контейнер отпускает секции старого PaneView", () => {
        const h = workbench();
        const old = h.paneView(TERMINAL);
        h.service.moveViewContainerToLocation(TERMINAL, "auxiliarybar");
        expect(old.getPaneIds()).toEqual([]);
        expect(h.paneView(TERMINAL)).not.toBe(old);
        expect(h.paneView(TERMINAL).getPaneIds()).toEqual(["terminal"]);
    });

    it("переезд: секция на время сборки свёрнута для подписчиков, потом снова раскрыта", () => {
        const h = workbench();
        const seen: [string, boolean][] = [];
        h.service.onDidChangeViewExpanded(({ viewId, expanded }) => seen.push([viewId, expanded]));
        h.service.moveViewContainerToLocation(TERMINAL, "auxiliarybar");
        expect(seen).toEqual([
            ["terminal", false],
            ["terminal", true],
        ]);
    });

    it("переехавший контейнер собирается со своим состоянием секций", () => {
        const h = makeViewsHarness();
        h.stored.set(SIDEBAR_VIEWS_STATE.key, { [OUTPUT]: { collapsed: { log: true }, weights: {} } });
        h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
        h.service.registerView(testView("output", OUTPUT, 10));
        h.service.registerView(testView("log", OUTPUT, 20));
        h.service.attachContainer(OUTPUT);
        h.service.moveViewContainerToLocation(OUTPUT, "auxiliarybar");
        expect(h.paneView(OUTPUT).isCollapsed("log")).toBe(true);
    });

    it("снятие неактивного вьюлета и вкладки части активный вьюлет не трогает", () => {
        const h = workbench();
        const before = h.shownViewlets.length;
        h.service.moveViewContainerToLocation(TERMINAL, "auxiliarybar");
        h.service.moveViewContainerToLocation(SEARCH, "panel");
        h.service.resetViewLocations();
        expect(h.shownViewlets.length).toBe(before);
    });

    it("сброс не пересобирает контейнеры, стоящие дома", () => {
        const h = workbench();
        h.showViewlet(SEARCH);
        const before = h.shownViewlets.length;
        h.service.resetViewLocations();
        expect(h.shownViewlets.length).toBe(before);
    });

    it("сброс не раскрывает скрытые секции, стоящие дома", () => {
        const h = workbench();
        h.service.registerView(testView("log", OUTPUT, 20));
        h.service.setViewVisible("log", false);
        h.service.moveViewContainerToLocation(SEARCH, "panel");
        h.service.resetViewLocations();
        expect(h.service.isViewVisible("log")).toBe(false);
    });

    it("на место уехавшего дефолтного встаёт вьюлет сайдбара, а не контейнер другого места", () => {
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

    it("без дефолтного на место уехавшего встаёт первый вьюлет по order, а не по регистрации", () => {
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

    it("вид в незарегистрированном контейнере переносам, сбросу и рестору не мешает", () => {
        const h = workbench();
        h.service.registerView(testView("orphan", "unregistered", 10, { canMoveView: true }));
        h.service.moveViewContainerToLocation(SEARCH, "panel");
        h.service.resetViewLocations();
        h.openWorkspace();
        expect(customizations(h)).toEqual({ viewContainerLocations: {}, viewLocations: {} });
        expect(h.service.getViewContainerLocation("unregistered")).toBeNull();
    });

    it("перенос туда и обратно без состояния секций стор секций не заводит", () => {
        const h = workbench();
        h.service.moveViewToLocation("terminal", "auxiliarybar");
        h.service.resetViewLocation("terminal");
        expect(h.stored.has(SIDEBAR_VIEWS_STATE.key)).toBe(false);
    });

    it("перенос до первого рестора тоже пишется в стор", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: OUTPUT, title: "OUTPUT", location: "panel" });
        h.service.registerView(testView("output", OUTPUT, 10, { canMoveView: true }));
        h.service.attachContainer(OUTPUT);
        h.service.moveViewContainerToLocation(OUTPUT, "auxiliarybar");
        expect(customizations(h)).toEqual({ viewContainerLocations: { [OUTPUT]: "auxiliarybar" }, viewLocations: {} });
    });
});

describe("ViewsService — рестор переносов: края", () => {
    it("id, лишь похожий на сгенерированный, и не-строка в сторе места не задают", () => {
        // Same length as the "workbench.views.service." prefix, but not it.
        const fake = "workbench.views.servicX.panel.0000";
        const h = workbench(storedLocations({ terminal: fake, output: null }));
        expect(h.service.getViewContainerByViewId("terminal")).toBe(TERMINAL);
        expect(h.service.getViewContainerByViewId("output")).toBe(OUTPUT);
        expect(h.service.getViewContainerLocation(fake)).toBeNull();
    });

    it("поздний вид: без записи, непереносимый и без места в сторе — встают в свой контейнер", () => {
        const h = workbench(storedLocations({ pinned: OUTPUT, lost: "unknown.container", odd: 42 }));
        h.service.registerView(testView("late", SEARCH, 20, { canMoveView: true }));
        h.service.registerView(testView("pinned", SEARCH, 30));
        h.service.registerView(testView("lost", SEARCH, 40, { canMoveView: true }));
        h.service.registerView(testView("odd", SEARCH, 50, { canMoveView: true }));
        expect(h.paneView(SEARCH).getPaneIds()).toEqual(["search", "late", "pinned", "lost", "odd"]);
    });

    it("смена проекта пересобирает и опустевший источник, и приёмник", () => {
        const h = workbench();
        h.stored.set(VIEWS_CUSTOMIZATIONS_STATE.key, {
            viewContainerLocations: {},
            viewLocations: { terminal: OUTPUT },
        });
        h.openWorkspace();
        expect(tabs(h, "panel")).toEqual(["OUTPUT"]);
        expect(h.paneView(OUTPUT).getPaneIds()).toEqual(["output", "terminal"]);
    });

    it("смена проекта: место из стора, совпавшее с текущим, контейнер не пересобирает", () => {
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

    it("сброс при смене проекта не стирает состояние секций сгенерированных, а переносы после — пишутся", () => {
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

describe("ViewsService — скрытость секций из стора", () => {
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

    it("несворачиваемую и незнакомую секцию стор не скрывает, остальные — скрывает", () => {
        expect(visibility(scene({ hidden: ["log", "ghost", "trace"] }))).toEqual([true, true, false]);
    });

    it("скрытость из нового стора заменяет прежнюю", () => {
        const h = scene({ hidden: ["trace"] });
        h.stored.set(SIDEBAR_VIEWS_STATE.key, { [OUTPUT]: { collapsed: {}, weights: {}, hidden: [] } });
        h.service.restoreViewsState();
        expect(visibility(h)).toEqual([true, true, true]);
    });

    it("скрытая первая секция остаётся скрытой, если видимые есть", () => {
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

describe("ViewsService — фокус при открытии", () => {
    it("без просьбы фокус не уходит; приветствие с кнопкой забирает фокус себе", () => {
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
});
