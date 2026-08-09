import { describe, expect, it, vi } from "vitest";

import type { MenuEntry, MenuSubmenuEntry } from "../../../../../../tuidom/ui/menu/popupMenuElement.ts";
import type { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import type { MenuContribution } from "../../../../platform/actions/common/iMenuContribution.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CHECKED_ICON } from "../../../../platform/actions/common/menuRegistry.ts";
import { containerMenuVisible, viewMenuVisible } from "../../actions/menuContexts.ts";

import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";

const CHANGES = "scm.changes";
const GRAPH = "scm.graph";

/**
 * Меню SCM-контейнера в миниатюре: у CHANGES — inline-обновление и пункт в
 * попапе, у GRAPH — только inline, у самого контейнера — своя команда.
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
    views.forEach((id, index) => h.service.registerView(testView(id, "scm", (index + 1) * 10)));
    h.service.attachContainer("scm");
    return h;
}

/** Пункты, с которыми открыли последнее контекст-меню. */
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

/** Иконки inline-кнопок заголовка секции: лейблы без названия, «⋯» и разделителей. */
function buttonIcons(h: IViewsHarness, viewId: string): string[] {
    const header = h.paneView("scm").querySelector(`#paneHeader-${viewId.replaceAll(".", "-")}`)!;
    const [, ...rest] = header.querySelectorAll("TextLabelElement");
    return rest
        .map((label) => (label as TextLabelElement).getText().trim())
        .filter((text) => text !== "\u2502" && text !== "⋯");
}

function entriesOf(submenuEntry: MenuSubmenuEntry): MenuEntry[] {
    return typeof submenuEntry.entries === "function" ? submenuEntry.entries() : submenuEntry.entries;
}

describe("ViewsService — inline-кнопки заголовка", () => {
    it("группа navigation с иконкой едет в кнопки заголовка секции", () => {
        const h = scmHarness([CHANGES, GRAPH, "scm.stashes"]);
        // Лейблы заголовка: название + по кнопке на inline-пункт + «⋯».
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
        expect(labels(lastEntries(h))).toEqual(["Commit All"]);
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
        expect(labels(entries)).toEqual(["Checkout to…", "---", "Views"]);
        expect(labels(entriesOf(submenu(entries, "Views")))).toEqual(["SCM.CHANGES", "SCM.GRAPH"]);
    });

    it("контейнер без своих команд показывает один переключатель секций", () => {
        const h = makeViewsHarness([]);
        h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
        h.service.registerView(testView(CHANGES, "scm", 10));
        h.service.registerView(testView(GRAPH, "scm", 20));
        h.service.attachContainer("scm");

        h.header("scm")!.onMenu?.({ screenX: 1, screenY: 0 });
        expect(labels(lastEntries(h))).toEqual(["Views"]);
    });

    it("видимые секции помечены галочкой, скрытые — нет", () => {
        const h = scmHarness();
        h.service.setViewVisible(GRAPH, false);
        h.header("scm")?.onMenu?.({ screenX: 1, screenY: 0 });
        // Контейнер стал merged — своего заголовка нет, меню открывает секция.
        h.paneView("scm").onDidRequestPaneMenu?.(CHANGES, { screenX: 0, screenY: 0 });
        const views = submenu(entriesOf(submenu(lastEntries(h), "SOURCE CONTROL")), "Views");
        expect(entriesOf(views).map((e) => (e.type === "separator" ? null : e.icon))).toEqual([CHECKED_ICON, undefined]);
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
        // Секция скрыта, но зарегистрирована — переключатель нужен, чтобы её вернуть.
        h.paneView("scm").onDidRequestPaneMenu?.(CHANGES, { screenX: 0, screenY: 0 });
        expect(labels(entriesOf(submenu(lastEntries(h), "SOURCE CONTROL")))).toEqual([
            "Checkout to…",
            "---",
            "Views",
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
        expect(labels(entriesOf(submenu(lastEntries(h), "SOURCE CONTROL")))).toEqual(["Views"]);
    });

    it("контейнер с одной зарегистрированной секцией переключателя не показывает", () => {
        const h = scmHarness([CHANGES]);
        h.paneView("scm").onDidRequestPaneMenu?.(CHANGES, { screenX: 0, screenY: 0 });
        const container = submenu(lastEntries(h), "SOURCE CONTROL");
        expect(labels(entriesOf(container))).toEqual(["Checkout to…"]);
    });
});

describe("ViewsService — merged: меню контейнера уезжает в подменю секции", () => {
    it("пункты секции, затем подменю с названием контейнера", () => {
        const h = scmHarness([CHANGES]);
        h.paneView("scm").onDidRequestPaneMenu?.(CHANGES, { screenX: 0, screenY: 0 });
        expect(labels(lastEntries(h))).toEqual(["Commit All", "---", "SOURCE CONTROL"]);
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
        expect(labels(entriesOf(submenu(lastEntries(h), "SOURCE CONTROL")))).toEqual(["New Repository"]);
    });

    it("контейнер без своих команд и без второй секции подменю не добавляет", () => {
        const h = makeViewsHarness(CONTRIBUTIONS);
        h.service.registerContainer({ id: "search", title: "SEARCH", location: "sidebar" });
        h.service.registerView(testView("search.results", "search", 10));
        h.service.attachContainer("search");

        h.paneView("search").onDidRequestPaneMenu?.("search.results", { screenX: 0, screenY: 0 });
        expect(lastEntries(h)).toEqual([]);
    });
});
