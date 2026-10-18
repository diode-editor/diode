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
 * Раскладка, как у приложения: сайдбар (Explorer по умолчанию, Search, магазин,
 * отвергающий чужие виды) и панель (Output, Terminal). Все виды, кроме
 * магазина, переносимые.
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
        // Тело переехало то же самое — живой виджет не пересоздаётся.
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
        // Две секции — у каждой свой заголовок.
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
        // Смена проекта — не действие пользователя: стор проекта не переписан.
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
