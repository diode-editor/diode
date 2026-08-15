import { describe, expect, it } from "vitest";

import type { MenuEntry, MenuItemEntry } from "@tuidom/elements/menu/popupMenuElement";
import { CommandRegistry } from "../../commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";
import { KeybindingRegistry, parseKeybinding } from "../../keybinding/common/keybindingRegistry.ts";

import type { IMenuContribution } from "./iMenuContribution.ts";
import { MenuId } from "./menuId.ts";
import { MenuRegistry } from "./menuRegistry.ts";

interface Harness {
    registry: MenuRegistry;
    commands: CommandRegistry;
    keybindings: KeybindingRegistry;
    contextKeys: ContextKeyService;
    executed: { id: string; args: unknown[] }[];
}

function setup(items: IMenuContribution[]): Harness {
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    const contextKeys = new ContextKeyService();
    const executed: { id: string; args: unknown[] }[] = [];
    // Регистрируем команды пунктов, чтобы execute был наблюдаем и getTitle работал.
    const seen = new Set<string>();
    for (const item of items) {
        if (seen.has(item.command)) continue;
        seen.add(item.command);
        commands.register(
            item.command,
            (...args) => executed.push({ id: item.command, args }),
            `Title:${item.command}`,
        );
    }
    const registry = new MenuRegistry(commands, keybindings, contextKeys, items);
    return { registry, commands, keybindings, contextKeys, executed };
}

function labels(entries: MenuEntry[]): (string | "─")[] {
    return entries.map((e) => (e.type === "separator" ? "─" : e.label));
}

function items(entries: MenuEntry[]): MenuItemEntry[] {
    return entries.filter((e): e is MenuItemEntry => e.type !== "separator");
}

describe("MenuRegistry", () => {
    it("возвращает только пункты запрошенного меню", () => {
        const h = setup([
            { menuId: MenuId.EditorContext, command: "a" },
            { menuId: MenuId.ExplorerContext, command: "b" },
        ]);
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:a"]);
        expect(labels(h.registry.getMenuItems(MenuId.ExplorerContext))).toEqual(["Title:b"]);
    });

    it("пустое меню → []", () => {
        const h = setup([{ menuId: MenuId.ExplorerContext, command: "b" }]);
        expect(h.registry.getMenuItems(MenuId.EditorContext)).toEqual([]);
    });

    it("when: скрывает пункт при непроходящем условии, показывает при проходящем", () => {
        const h = setup([
            { menuId: MenuId.EditorContext, command: "always" },
            { menuId: MenuId.EditorContext, command: "gated", when: "textInputFocus" },
        ]);
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:always"]);
        h.contextKeys.set("textInputFocus", true);
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:always", "Title:gated"]);
    });

    it("visible: предикат получает контекст и фильтрует пункт", () => {
        const seenContexts: unknown[] = [];
        const h = setup([
            {
                menuId: MenuId.ExplorerContext,
                command: "paste",
                visible: (ctx) => {
                    seenContexts.push(ctx);
                    return (ctx as { canPaste: boolean }).canPaste;
                },
            },
        ]);
        expect(labels(h.registry.getMenuItems(MenuId.ExplorerContext, { canPaste: false }))).toEqual([]);
        expect(labels(h.registry.getMenuItems(MenuId.ExplorerContext, { canPaste: true }))).toEqual(["Title:paste"]);
        expect(seenContexts).toEqual([{ canPaste: false }, { canPaste: true }]);
    });

    it("сортирует группы по ключу и вставляет разделитель между непустыми группами", () => {
        const h = setup([
            { menuId: MenuId.EditorContext, command: "z", group: "2_second" },
            { menuId: MenuId.EditorContext, command: "a", group: "1_first" },
        ]);
        // группы 1_first перед 2_second, разделитель между; нет ведущих/хвостовых.
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:a", "─", "Title:z"]);
    });

    it("сортирует внутри группы по order, при равенстве — стабильно по вставке", () => {
        const h = setup([
            { menuId: MenuId.EditorContext, command: "third", group: "g", order: 30 },
            { menuId: MenuId.EditorContext, command: "first", group: "g", order: 10 },
            { menuId: MenuId.EditorContext, command: "second-a", group: "g", order: 20 },
            { menuId: MenuId.EditorContext, command: "second-b", group: "g", order: 20 },
        ]);
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual([
            "Title:first",
            "Title:second-a",
            "Title:second-b",
            "Title:third",
        ]);
    });

    it("группа navigation всегда первая, независимо от строкового порядка", () => {
        const h = setup([
            { menuId: MenuId.EditorContext, command: "first", group: "1_first" },
            { menuId: MenuId.EditorContext, command: "nav", group: "navigation" },
            { menuId: MenuId.EditorContext, command: "second", group: "2_second" },
        ]);
        // navigation впереди (спец-группа vscode), дальше — 1_first < 2_second.
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual([
            "Title:nav",
            "─",
            "Title:first",
            "─",
            "Title:second",
        ]);

        // И симметрично: когда navigation вставлена первой, остальные группы
        // всё равно уходят после неё (сравнение с navigation справа).
        const first = setup([
            { menuId: MenuId.EditorContext, command: "nav", group: "navigation" },
            { menuId: MenuId.EditorContext, command: "other", group: "1_other" },
        ]);
        expect(labels(first.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:nav", "─", "Title:other"]);
    });

    it("дефолты: без group (→ '') и без order (→ 0)", () => {
        const h = setup([
            { menuId: MenuId.EditorContext, command: "grouped", group: "1_g" },
            { menuId: MenuId.EditorContext, command: "ungrouped-b" },
            { menuId: MenuId.EditorContext, command: "ungrouped-a" },
        ]);
        // "" сортируется раньше "1_g"; внутри "" — стабильно по вставке (order default 0).
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual([
            "Title:ungrouped-b",
            "Title:ungrouped-a",
            "─",
            "Title:grouped",
        ]);
    });

    it("скрытый пункт схлопывает группу без лишнего разделителя", () => {
        const h = setup([
            { menuId: MenuId.ExplorerContext, command: "copy", group: "1_clip" },
            { menuId: MenuId.ExplorerContext, command: "paste", group: "1_clip", visible: () => false },
            { menuId: MenuId.ExplorerContext, command: "rename", group: "2_mod" },
        ]);
        expect(labels(h.registry.getMenuItems(MenuId.ExplorerContext))).toEqual(["Title:copy", "─", "Title:rename"]);
    });

    it("label: явный title → title команды → id команды", () => {
        const commands = new CommandRegistry();
        commands.register("withTitle", () => {}, "Command Title");
        commands.register("noTitle", () => {}); // без title
        const registry = new MenuRegistry(commands, new KeybindingRegistry(), new ContextKeyService(), [
            { menuId: MenuId.EditorContext, command: "withTitle", title: "Explicit" },
            { menuId: MenuId.EditorContext, command: "withTitle" },
            { menuId: MenuId.EditorContext, command: "noTitle" },
        ]);
        expect(labels(registry.getMenuItems(MenuId.EditorContext))).toEqual(["Explicit", "Command Title", "noTitle"]);
    });

    it("shortcut: резолв из кейбиндов / промах / литерал / подавление false", () => {
        const h = setup([
            { menuId: MenuId.EditorContext, command: "bound" },
            { menuId: MenuId.EditorContext, command: "unbound" },
            { menuId: MenuId.EditorContext, command: "literal", shortcut: "F2" },
            { menuId: MenuId.EditorContext, command: "suppressed", shortcut: false },
        ]);
        h.keybindings.register(parseKeybinding("ctrl+c"), "bound");
        h.keybindings.register(parseKeybinding("delete"), "suppressed");
        const entries = items(h.registry.getMenuItems(MenuId.EditorContext));
        expect(entries.map((e) => e.shortcut)).toEqual(["Ctrl+C", undefined, "F2", undefined]);
    });

    it("args резолвятся сразу (даже без выбора пункта) и подставляются в execute", () => {
        let called = 0;
        const h = setup([
            {
                menuId: MenuId.ExplorerContext,
                command: "rename",
                args: (ctx) => {
                    called++;
                    return [(ctx as { path: string }).path];
                },
            },
        ]);
        const entries = items(h.registry.getMenuItems(MenuId.ExplorerContext, { path: "/ws/a.txt" }));
        expect(called).toBe(1); // резолвер отработал при сборке меню
        entries[0].onSelect?.();
        expect(h.executed).toEqual([{ id: "rename", args: ["/ws/a.txt"] }]);
    });

    it("onSelect без args исполняет команду без аргументов", () => {
        const h = setup([{ menuId: MenuId.EditorContext, command: "copy" }]);
        items(h.registry.getMenuItems(MenuId.EditorContext))[0].onSelect?.();
        expect(h.executed).toEqual([{ id: "copy", args: [] }]);
    });

    it("icon пробрасывается в MenuEntry", () => {
        const h = setup([{ menuId: MenuId.EditorContext, command: "a", icon: "★" }]);
        expect(items(h.registry.getMenuItems(MenuId.EditorContext))[0].icon).toBe("★");
    });

    it("appendMenuItem добавляет пункт, dispose снимает (повторный dispose безопасен)", () => {
        const h = setup([{ menuId: MenuId.EditorContext, command: "base" }]);
        h.commands.register("added", () => {}, "Added");
        const handle = h.registry.appendMenuItem({ menuId: MenuId.EditorContext, command: "added" });
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:base", "Added"]);
        handle.dispose();
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:base"]);
        handle.dispose(); // idempotent — пункт уже снят
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:base"]);
    });

    it("getSubmenus: фильтр по точке и when, сортировка по order, мнемоника", () => {
        const h = setup([]);
        const registry = new MenuRegistry(h.commands, h.keybindings, h.contextKeys, [
            {
                menuId: MenuId.MenubarMainMenu,
                submenu: MenuId.MenubarEditMenu,
                title: "Edit",
                mnemonic: "e",
                order: 20,
            },
            {
                menuId: MenuId.MenubarMainMenu,
                submenu: MenuId.MenubarFileMenu,
                title: "File",
                mnemonic: "f",
                order: 10,
            },
            // Чужая точка и непроходящий when — не попадают в выдачу.
            { menuId: MenuId.EditorContext, submenu: MenuId.MenubarHelpMenu, title: "Elsewhere" },
            { menuId: MenuId.MenubarMainMenu, submenu: MenuId.MenubarViewMenu, title: "Focused", when: "listFocus" },
            // Обычный пункт-команда в той же точке — не submenu, отфильтрован.
            { menuId: MenuId.MenubarMainMenu, command: "not-a-submenu" },
        ]);
        expect(registry.getSubmenus(MenuId.MenubarMainMenu)).toEqual([
            { title: "File", mnemonic: "f", submenu: MenuId.MenubarFileMenu },
            { title: "Edit", mnemonic: "e", submenu: MenuId.MenubarEditMenu },
        ]);
    });

    it("getMenuItems игнорирует submenu-записи (вложенные попапы не рендерим)", () => {
        const h = setup([{ menuId: MenuId.EditorContext, command: "cmd" }]);
        h.registry.appendMenuItem({ menuId: MenuId.EditorContext, submenu: MenuId.MenubarFileMenu, title: "Sub" });
        expect(labels(h.registry.getMenuItems(MenuId.EditorContext))).toEqual(["Title:cmd"]);
    });

    it("submenu c резолвером фильтруется по when и императивному visible", () => {
        const h = setup([{ menuId: MenuId.ViewTitle, command: "cmd" }]);
        h.contextKeys.set("listFocus", false);
        h.registry.appendMenuItem({
            menuId: MenuId.ViewTitle,
            submenu: MenuId.MenubarFileMenu,
            title: "OnlyChanges",
            visible: (context) => (context as { view?: string })?.view === "changes",
        });
        h.registry.appendMenuItem({
            menuId: MenuId.ViewTitle,
            submenu: MenuId.MenubarEditMenu,
            title: "WhenGated",
            when: "listFocus",
        });
        const resolver = (entry: { title: string }) => ({
            type: "submenu" as const,
            label: entry.title,
            entries: [],
        });

        // Контекст другой секции: submenu с visible скрыто; when-гейт тоже false.
        let titles = h.registry
            .getMenuItems(MenuId.ViewTitle, { view: "graph" }, resolver as never)
            .map((e) => ("label" in e ? e.label : "—"));
        expect(titles).toEqual(["Title:cmd"]);

        // Свой контекст + when=true: оба подменю в списке.
        h.contextKeys.set("listFocus", true);
        titles = h.registry
            .getMenuItems(MenuId.ViewTitle, { view: "changes" }, resolver as never)
            .map((e) => ("label" in e ? e.label : "—"));
        expect(titles).toContain("OnlyChanges");
        expect(titles).toContain("WhenGated");
    });

    it("onDidChangeMenu: срабатывает на append и на снятие, но не на повторный dispose", () => {
        const h = setup([]);
        const changed: string[] = [];
        h.registry.onDidChangeMenu((menuId) => changed.push(menuId.id));

        const handle = h.registry.appendMenuItem({ menuId: MenuId.EditorContext, command: "x" });
        expect(changed).toEqual(["EditorContext"]);

        handle.dispose();
        expect(changed).toEqual(["EditorContext", "EditorContext"]);

        handle.dispose(); // пункт уже снят — события нет
        expect(changed).toEqual(["EditorContext", "EditorContext"]);
    });

    it("onDidChangeMenu: dispose подписки прекращает уведомления", () => {
        const h = setup([]);
        const changed: string[] = [];
        const subscription = h.registry.onDidChangeMenu((menuId) => changed.push(menuId.id));
        subscription.dispose();

        h.registry.appendMenuItem({ menuId: MenuId.ExplorerContext, command: "y" });
        expect(changed).toEqual([]);
    });
});
