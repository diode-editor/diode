import type { MenuEntry, MenuSubmenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import type { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it, vi } from "vitest";

import type { MenuContribution } from "../../../../platform/actions/common/iMenuContribution.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CHECKED_ICON } from "../../../../platform/actions/common/menuRegistry.ts";
import { containerMenuVisible, viewMenuVisible } from "../../actions/menuContexts.ts";

import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";

const CHANGES = "scm.changes";
const GRAPH = "scm.graph";

/**
 * The SCM container's menus in miniature: CHANGES has an inline refresh and a popup
 * item, GRAPH has only inline, and the container itself has its own command.
 */
const CONTRIBUTIONS: MenuContribution[] = [
    {
        menuId: MenuId.ViewTitle,
        command: "scm.refreshChanges",
        title: "Refresh",
        icon: "R",
        group: "navigation",
        order: 10,
        visible: viewMenuVisible(CHANGES),
    },
    {
        menuId: MenuId.ViewTitle,
        command: "scm.commitAll",
        title: "Commit All",
        group: "2_commit",
        visible: viewMenuVisible(CHANGES),
    },
    // A navigation group item WITHOUT an icon can't be drawn as a button (labels won't fit
    // in the sidebar's 30 columns), so it must go into "⋯".
    {
        menuId: MenuId.ViewTitle,
        command: "scm.stageAll",
        title: "Stage All",
        group: "navigation",
        order: 20,
        visible: viewMenuVisible(CHANGES),
    },
    {
        menuId: MenuId.ViewTitle,
        command: "scm.loadMore",
        title: "Load More",
        icon: "L",
        group: "navigation",
        visible: viewMenuVisible(GRAPH),
    },
    {
        menuId: MenuId.ViewContainerTitle,
        command: "scm.checkout",
        title: "Checkout to…",
        group: "1_repo",
        visible: containerMenuVisible("scm"),
    },
];

function scmHarness(views = [CHANGES, GRAPH]): IViewsHarness {
    const h = makeViewsHarness(CONTRIBUTIONS);
    h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
    views.forEach((id, index) => {
        h.service.registerView(testView(id, "scm", (index + 1) * 10));
    });
    h.service.attachContainer("scm");
    h.showViewlet("scm");
    return h;
}

function lastEntries(h: IViewsHarness): MenuEntry[] {
    return h.shown.at(-1)!.getEntries!();
}

function labels(entries: readonly MenuEntry[]): string[] {
    return entries.map((entry) => (entry.type === "separator" ? "---" : entry.label));
}

function submenu(entries: readonly MenuEntry[], label: string): MenuSubmenuEntry {
    const found = entries.find((entry) => entry.type === "submenu" && entry.label === label);
    return found as MenuSubmenuEntry;
}

/** Icons of a section header's inline buttons: labels without the title, "⋯" and separators. */
function buttonIcons(h: IViewsHarness, viewId: string): string[] {
    const header = h.paneView("scm").querySelector(`#paneHeader-${viewId.replaceAll(".", "-")}`)!;
    const [, ...rest] = header.querySelectorAll("TextLabelElement");
    return rest
        .map((label) => (label as TextLabelElement).getText().trim())
        .filter((text) => text !== "\u2502" && text !== "⋯");
}

/** Color tokens of the inline buttons: they show which one is disabled. */
function buttonForegrounds(h: IViewsHarness, viewId: string): (string | number | undefined)[] {
    const header = h.paneView("scm").querySelector(`#paneHeader-${viewId.replaceAll(".", "-")}`)!;
    const [, ...rest] = header.querySelectorAll("TextLabelElement");
    return rest
        .filter((label) => {
            const text = (label as TextLabelElement).getText().trim();
            return text !== "│" && text !== "⋯";
        })
        .map((label) => label.style.fg);
}

function entriesOf(submenuEntry: MenuSubmenuEntry): MenuEntry[] {
    return typeof submenuEntry.entries === "function" ? submenuEntry.entries() : submenuEntry.entries;
}

describe("ViewsService — inline-кнопки заголовка", () => {
    it("группа navigation с иконкой едет в кнопки заголовка секции", () => {
        const h = scmHarness([CHANGES, GRAPH, "scm.stashes"]);
        expect(buttonIcons(h, CHANGES)).toEqual(["R"]);
        expect(buttonIcons(h, GRAPH)).toEqual(["L"]);
        expect(buttonIcons(h, "scm.stashes")).toEqual([]);
    });

    it("клик по inline-кнопке исполняет её команду", () => {
        const h = scmHarness();
        const run = vi.fn();
        h.commands.register("scm.refreshChanges", run, "Refresh");

        h.paneView("scm").onDidRequestPaneAction?.(CHANGES, "scm.refreshChanges");
        expect(run).toHaveBeenCalledOnce();
    });

    it("неизвестная кнопка — тихий no-op", () => {
        const h = scmHarness();
        expect(() => h.paneView("scm").onDidRequestPaneAction?.(CHANGES, "scm.ghost")).not.toThrow();
    });

    it("недоступная команда: кнопка гаснет по refreshTitleActions и не исполняется", () => {
        const h = makeViewsHarness([
            {
                menuId: MenuId.ViewTitle,
                command: "scm.refreshChanges",
                title: "Refresh",
                icon: "R",
                group: "navigation",
                enablement: "!gitOperationInProgress",
                visible: viewMenuVisible(CHANGES),
            },
        ]);
        h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
        h.service.registerView(testView(CHANGES, "scm", 10));
        h.service.registerView(testView(GRAPH, "scm", 20));
        h.service.attachContainer("scm");
        h.showViewlet("scm");
        const run = vi.fn();
        h.commands.register("scm.refreshChanges", run, "Refresh");
        expect(buttonForegrounds(h, CHANGES)).toEqual(["descriptionForeground"]);

        h.contextKeys.set("gitOperationInProgress", true);
        // Until someone re-resolves the header, the button looks the same —
        // that is exactly what ViewTitleActionsContribution fixes.
        h.service.refreshTitleActions();
        expect(buttonForegrounds(h, CHANGES)).toEqual(["disabledForeground"]);

        h.paneView("scm").onDidRequestPaneAction?.(CHANGES, "scm.refreshChanges");
        expect(run).not.toHaveBeenCalled();

        h.contextKeys.set("gitOperationInProgress", false);
        h.service.refreshTitleActions();
        expect(buttonForegrounds(h, CHANGES)).toEqual(["descriptionForeground"]);
        h.paneView("scm").onDidRequestPaneAction?.(CHANGES, "scm.refreshChanges");
        expect(run).toHaveBeenCalledOnce();
    });

    // `registerView` legitimately creates containers without a built control — the
    // context key pass must skip them rather than crash in attached().
    it("refreshTitleActions пропускает зарегистрированный, но не собранный контейнер", () => {
        const h = makeViewsHarness(CONTRIBUTIONS);
        h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
        h.service.registerView(testView(CHANGES, "scm", 10));
        // attachContainer is NOT called — paneView stays null.

        expect(() => {
            h.service.refreshTitleActions();
        }).not.toThrow();

        // And the container isn't stale: built later, it gets its buttons.
        h.service.attachContainer("scm");
        h.showViewlet("scm");
        expect(buttonForegrounds(h, CHANGES)).toEqual(["descriptionForeground"]);
    });

    it("команда контейнера исполняется из его заголовка", () => {
        const h = makeViewsHarness([
            {
                menuId: MenuId.ViewContainerTitle,
                command: "scm.newRepo",
                title: "New Repository",
                icon: "N",
                group: "navigation",
                visible: containerMenuVisible("scm"),
            },
        ]);
        const run = vi.fn();
        h.commands.register("scm.newRepo", run, "New Repository");
        h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
        h.service.registerView(testView(CHANGES, "scm", 10));
        h.service.registerView(testView(GRAPH, "scm", 20));
        h.service.attachContainer("scm");

        h.header("scm")!.onAction?.("scm.newRepo");
        expect(run).toHaveBeenCalledOnce();
    });
});

describe("ViewsService — попап «⋯» секции", () => {
    it("показывает только overflow — inline-пункты в попапе не дублируются", () => {
        const h = scmHarness();
        h.paneView("scm").onDidRequestPaneMenu?.(CHANGES, { screenX: 0, screenY: 0 });
        // Stage All is in the navigation group but has no icon, so it can't be a button
        // and lands here, while Refresh (with an icon) became a button and isn't duplicated.
        expect(labels(lastEntries(h))).toEqual(["Stage All", "---", "Commit All"]);
    });

    it("секция без overflow-пунктов даёт пустое меню — попап не откроется", () => {
        const h = scmHarness();
        h.paneView("scm").onDidRequestPaneMenu?.(GRAPH, { screenX: 0, screenY: 0 });
        expect(lastEntries(h)).toEqual([]);
    });

    it("якорь и владелец приходят от заголовка секции", () => {
        const h = scmHarness();
        h.paneView("scm").onDidRequestPaneMenu?.(CHANGES, { screenX: 5, screenY: 7 });
        expect(h.shown.at(-1)!.getAnchor()).toEqual({ screenX: 5, screenY: 7 });
        expect(h.shown.at(-1)!.getOwner()).toBe(h.paneView("scm"));
    });
});

describe("ViewsService — попап «⋯» контейнера", () => {
    it("команды контейнера и подменю-переключатель секций", () => {
        const h = scmHarness();
        h.header("scm")!.onMenu?.({ screenX: 1, screenY: 0 });
        expect(h.shown.at(-1)!.getAnchor()).toEqual({ screenX: 1, screenY: 0 });
        expect(h.shown.at(-1)!.getOwner()).toBe(h.header("scm"));
        const entries = lastEntries(h);
        expect(labels(entries)).toEqual(["Checkout to…", "---", "Views", "---", "Move To"]);
        expect(labels(entriesOf(submenu(entries, "Views")))).toEqual(["SCM.CHANGES", "SCM.GRAPH"]);
    });

    it("контейнер без своих команд показывает один переключатель секций", () => {
        const h = makeViewsHarness([]);
        h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
        h.service.registerView(testView(CHANGES, "scm", 10));
        h.service.registerView(testView(GRAPH, "scm", 20));
        h.service.attachContainer("scm");

        h.header("scm")!.onMenu?.({ screenX: 1, screenY: 0 });
        expect(labels(lastEntries(h))).toEqual(["Views", "---", "Move To"]);
    });

    it("видимые секции помечены галочкой, скрытые — нет", () => {
        const h = scmHarness();
        h.service.setViewVisible(GRAPH, false);
        h.header("scm")?.onMenu?.({ screenX: 1, screenY: 0 });
        // The container became merged — it has no header of its own, the section opens the menu.
        h.paneView("scm").onDidRequestPaneMenu?.(CHANGES, { screenX: 0, screenY: 0 });
        const views = submenu(entriesOf(submenu(lastEntries(h), "SOURCE CONTROL")), "Views");
        expect(entriesOf(views).map((e) => (e.type === "separator" ? null : e.icon))).toEqual([
            CHECKED_ICON,
            undefined,
        ]);
    });

    it("пункт подменю переключает видимость секции", () => {
        const h = scmHarness();
        h.header("scm")!.onMenu?.({ screenX: 1, screenY: 0 });
        const views = entriesOf(submenu(lastEntries(h), "Views"));
        const graphItem = views.find((entry) => entry.type !== "separator" && entry.label === "SCM.GRAPH")!;
        expect(graphItem.type).toBe(undefined);

        (graphItem as { onSelect?: () => void }).onSelect?.();
        expect(h.service.isViewVisible(GRAPH)).toBe(false);
        expect(h.paneView("scm").getPaneIds()).toEqual([CHANGES]);
    });

    it("контейнер с одной секцией: в «⋯» только его команды, без подменю Views", () => {
        const h = makeViewsHarness(CONTRIBUTIONS);
        h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
        h.service.registerView(testView(CHANGES, "scm", 10));
        h.service.registerView(testView(GRAPH, "scm", 20));
        h.service.attachContainer("scm");
        h.service.setViewVisible(GRAPH, false);
        // The section is hidden but registered — the toggle is needed to bring it back.
        h.paneView("scm").onDidRequestPaneMenu?.(CHANGES, { screenX: 0, screenY: 0 });
        expect(labels(entriesOf(submenu(lastEntries(h), "SOURCE CONTROL")))).toEqual([
            "Checkout to…",
            "---",
            "Views",
            "---",
            "Move To",
        ]);
    });

    it("merged без команд контейнера: в подменю только переключатель секций", () => {
        const h = makeViewsHarness([]);
        h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
        h.service.registerView(testView(CHANGES, "scm", 10));
        h.service.registerView(testView(GRAPH, "scm", 20));
        h.service.attachContainer("scm");
        h.service.setViewVisible(GRAPH, false);

        h.paneView("scm").onDidRequestPaneMenu?.(CHANGES, { screenX: 0, screenY: 0 });
        expect(labels(entriesOf(submenu(lastEntries(h), "SOURCE CONTROL")))).toEqual(["Views", "---", "Move To"]);
    });

    it("контейнер с одной зарегистрированной секцией переключателя не показывает", () => {
        const h = scmHarness([CHANGES]);
        h.paneView("scm").onDidRequestPaneMenu?.(CHANGES, { screenX: 0, screenY: 0 });
        const container = submenu(lastEntries(h), "SOURCE CONTROL");
        expect(labels(entriesOf(container))).toEqual(["Checkout to…", "---", "Move To"]);
    });
});

describe("ViewsService — merged: меню контейнера уезжает в подменю секции", () => {
    it("пункты секции, затем подменю с названием контейнера", () => {
        const h = scmHarness([CHANGES]);
        h.paneView("scm").onDidRequestPaneMenu?.(CHANGES, { screenX: 0, screenY: 0 });
        expect(labels(lastEntries(h))).toEqual(["Stage All", "---", "Commit All", "---", "SOURCE CONTROL"]);
    });

    it("inline-группа контейнера тоже уезжает в подменю — рисовать её негде", () => {
        const h = makeViewsHarness([
            {
                menuId: MenuId.ViewContainerTitle,
                command: "scm.newRepo",
                title: "New Repository",
                icon: "N",
                group: "navigation",
                visible: containerMenuVisible("scm"),
            },
        ]);
        h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
        h.service.registerView(testView(CHANGES, "scm", 10));
        h.service.attachContainer("scm");

        h.paneView("scm").onDidRequestPaneMenu?.(CHANGES, { screenX: 0, screenY: 0 });
        expect(labels(entriesOf(submenu(lastEntries(h), "SOURCE CONTROL")))).toEqual([
            "New Repository",
            "---",
            "Move To",
        ]);
    });

    it("контейнер без своих команд и без второй секции: в подменю только «Move To»", () => {
        const h = makeViewsHarness(CONTRIBUTIONS);
        h.service.registerContainer({ id: "search", title: "SEARCH", location: "sidebar" });
        h.service.registerView(testView("search.results", "search", 10));
        h.service.attachContainer("search");

        h.paneView("search").onDidRequestPaneMenu?.("search.results", { screenX: 0, screenY: 0 });
        expect(labels(lastEntries(h))).toEqual(["SEARCH"]);
        expect(labels(entriesOf(submenu(lastEntries(h), "SEARCH")))).toEqual(["Move To"]);
    });
});

// As upstream, a hidden container doesn't resolve its title buttons but catches up when shown:
// at startup all containers are built while two are visible, and menu resolution is expensive.
describe("ViewsService — кнопки заголовка скрытого контейнера", () => {
    function hiddenScm(contributions: MenuContribution[] = CONTRIBUTIONS): IViewsHarness {
        const h = makeViewsHarness(contributions);
        h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
        h.service.registerView(testView(CHANGES, "scm", 10));
        h.service.registerView(testView(GRAPH, "scm", 20));
        return h;
    }

    it("непоказанный вьюлет меню не резолвит, показанный получает кнопки", () => {
        const h = hiddenScm();
        const resolve = vi.spyOn(h.menuService, "getEntryGroups");
        h.service.attachContainer("scm");
        h.service.refreshTitleActions();

        expect(resolve).not.toHaveBeenCalled();
        expect(buttonIcons(h, CHANGES)).toEqual([]);

        h.showViewlet("scm");
        expect(buttonIcons(h, CHANGES)).toEqual(["R"]);
        expect(buttonIcons(h, GRAPH)).toEqual(["L"]);
    });

    it("смена ключей, пока вьюлет скрыт, видна сразу при показе", () => {
        const h = hiddenScm([
            {
                menuId: MenuId.ViewTitle,
                command: "scm.refreshChanges",
                title: "Refresh",
                icon: "R",
                group: "navigation",
                enablement: "!gitOperationInProgress",
                visible: viewMenuVisible(CHANGES),
            },
        ]);
        h.service.attachContainer("scm");
        h.showViewlet("scm");
        expect(buttonForegrounds(h, CHANGES)).toEqual(["descriptionForeground"]);

        h.service.registerContainer({ id: "explorer", title: "EXPLORER", location: "sidebar" });
        h.service.registerView(testView("explorer.files", "explorer", 10));
        h.service.attachContainer("explorer");
        h.showViewlet("explorer");
        h.contextKeys.set("gitOperationInProgress", true);
        h.service.refreshTitleActions();
        // The hidden header was not touched — it keeps the old state.
        expect(buttonForegrounds(h, CHANGES)).toEqual(["descriptionForeground"]);

        h.showViewlet("scm");
        expect(buttonForegrounds(h, CHANGES)).toEqual(["disabledForeground"]);
    });

    it("повторный показ без изменений меню заново не резолвит", () => {
        const h = hiddenScm();
        h.service.attachContainer("scm");
        h.showViewlet("scm");
        h.service.registerContainer({ id: "explorer", title: "EXPLORER", location: "sidebar" });
        h.service.registerView(testView("explorer.files", "explorer", 10));
        h.service.attachContainer("explorer");
        h.showViewlet("explorer");
        const resolve = vi.spyOn(h.menuService, "getEntryGroups");

        h.showViewlet("scm");
        expect(resolve).not.toHaveBeenCalled();
        expect(buttonIcons(h, CHANGES)).toEqual(["R"]);
    });

    it("неактивная вкладка панели получает полосу контролов, когда её делают активной", () => {
        const h = makeViewsHarness([
            {
                menuId: MenuId.ViewTitle,
                command: "output.clear",
                title: "Clear",
                icon: "C",
                group: "navigation",
                visible: viewMenuVisible("output.view"),
            },
        ]);
        h.service.registerContainer({ id: "problems", title: "PROBLEMS", location: "panel", order: 0 });
        h.service.registerView(testView("problems.view", "problems", 10));
        h.service.registerContainer({ id: "output", title: "OUTPUT", location: "panel", order: 1 });
        h.service.registerView(testView("output.view", "output", 10));
        h.service.attachRegisteredContainers();
        // The panel's first tab is active — the second is built but not shown.
        expect(h.panelService.getActiveViewId()).toBe("problems");
        expect(h.tabActions("output")).toBeNull();

        h.panelService.setActiveView("output");
        expect(h.tabActions("output")).not.toBeNull();
        const strip = h.tabActions("output")!;
        const texts = strip.querySelectorAll("TextLabelElement").map((l) => (l as TextLabelElement).getText().trim());
        expect(texts).toContain("C");
    });
});
