import { describe, expect, it } from "vitest";

import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { MenuRegistry } from "../../../../platform/actions/common/menuRegistry.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IExtensionContributions } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

import { parseMenuGroup, registerExtensionMenus } from "./extensionMenuContributor.ts";

// Герметичный контракт моста `contributes.menus` → `MenuRegistry`: синтетические
// манифесты, настоящий реестр. Стоковое расширение закрывает ту же дверь
// e2e-сценарием — здесь проверяется разбор манифеста, включая мусорный.

function extension(id: string, contributes: IExtensionContributions): IExtension {
    return { id, manifest: { name: id, publisher: "test", version: "0.0.1", contributes } } as unknown as IExtension;
}

function makeRegistry(): { menus: MenuRegistry; commands: CommandRegistry; contextKeys: ContextKeyService } {
    const commands = new CommandRegistry();
    const contextKeys = new ContextKeyService();
    const menus = new MenuRegistry(commands, new KeybindingRegistry(), contextKeys, []);
    return { menus, commands, contextKeys };
}

function collectLog(): { logger: ILogger; lines: string[] } {
    const lines: string[] = [];
    const logger = {
        info: (message: string) => lines.push(message),
        warn: (message: string) => lines.push(message),
        error: () => undefined,
        debug: () => undefined,
        trace: () => undefined,
    } as unknown as ILogger;
    return { logger, lines };
}

/** Метки пунктов точки — так их увидит попап. */
function labels(menus: MenuRegistry, menuId: MenuId): string[] {
    return menus.getMenuItems(menuId).map((entry) => (entry.type === "separator" ? "─" : entry.label));
}

describe("parseMenuGroup", () => {
    it("`группа@порядок` разбирается на группу и порядок", () => {
        expect(parseMenuGroup("navigation@2")).toEqual({ group: "navigation", order: 2 });
        expect(parseMenuGroup("1_modification@1.5")).toEqual({ group: "1_modification", order: 1.5 });
    });

    it("без `@` — только группа; без группы — пусто", () => {
        expect(parseMenuGroup("navigation")).toEqual({ group: "navigation" });
        expect(parseMenuGroup(undefined)).toEqual({});
        expect(parseMenuGroup("")).toEqual({});
    });

    it("нечисловой порядок отбрасывается, а не уезжает в NaN", () => {
        expect(parseMenuGroup("navigation@x")).toEqual({ group: "navigation" });
        expect(parseMenuGroup("@3")).toEqual({ order: 3 });
    });
});

describe("registerExtensionMenus", () => {
    it("пункт расширения приезжает в контекст-меню редактора с группой и порядком", () => {
        const { menus, commands } = makeRegistry();
        commands.register("ext.doThing", () => undefined, "Do Thing");

        registerExtensionMenus(
            [
                extension("test.ext", {
                    menus: { "editor/context": [{ command: "ext.doThing", group: "navigation@2" }] },
                }),
            ],
            menus,
        );

        expect(labels(menus, MenuId.EditorContext)).toEqual(["Do Thing"]);
    });

    it("свой title пункта перебивает титул команды", () => {
        const { menus, commands } = makeRegistry();
        commands.register("ext.organize", () => undefined, "Organize Imports");
        registerExtensionMenus(
            [
                extension("test.ext", {
                    menus: {
                        "editor/context": [{ command: "ext.organize", title: "Pyright: Organize Imports" }],
                    },
                }),
            ],
            menus,
        );

        expect(labels(menus, MenuId.EditorContext)).toEqual(["Pyright: Organize Imports"]);
    });

    it("`when` пункта — настоящий контекст-ключ", () => {
        const { menus, commands, contextKeys } = makeRegistry();
        commands.register("ext.doThing", () => undefined, "Do Thing");
        registerExtensionMenus(
            [
                extension("test.ext", {
                    menus: { "editor/context": [{ command: "ext.doThing", when: "editorHasRenameProvider" }] },
                }),
            ],
            menus,
        );

        expect(labels(menus, MenuId.EditorContext)).toEqual([]);
        contextKeys.set("editorHasRenameProvider", true);
        expect(labels(menus, MenuId.EditorContext)).toEqual(["Do Thing"]);
    });

    it("порядок внутри группы — из `@`, а не из порядка в манифесте", () => {
        const { menus, commands } = makeRegistry();
        commands.register("ext.second", () => undefined, "Second");
        commands.register("ext.first", () => undefined, "First");
        registerExtensionMenus(
            [
                extension("test.ext", {
                    menus: {
                        "editor/context": [
                            { command: "ext.second", group: "navigation@2" },
                            { command: "ext.first", group: "navigation@1" },
                        ],
                    },
                }),
            ],
            menus,
        );

        expect(labels(menus, MenuId.EditorContext)).toEqual(["First", "Second"]);
    });

    it("разные точки меню разводятся по своим реестрам", () => {
        const { menus, commands } = makeRegistry();
        commands.register("ext.editor", () => undefined, "In Editor");
        commands.register("ext.explorer", () => undefined, "In Explorer");
        registerExtensionMenus(
            [
                extension("test.ext", {
                    menus: {
                        "editor/context": [{ command: "ext.editor" }],
                        "explorer/context": [{ command: "ext.explorer" }],
                    },
                }),
            ],
            menus,
        );

        expect(labels(menus, MenuId.EditorContext)).toEqual(["In Editor"]);
        expect(labels(menus, MenuId.ExplorerContext)).toEqual(["In Explorer"]);
    });

    it("неизвестная точка — строка в лог, остальные пункты расширения живут", () => {
        const { menus, commands } = makeRegistry();
        const { logger, lines } = collectLog();
        commands.register("ext.doThing", () => undefined, "Do Thing");

        registerExtensionMenus(
            [
                extension("test.ext", {
                    menus: {
                        "timeline/item/context": [{ command: "ext.gone" }],
                        "editor/context": [{ command: "ext.doThing" }],
                    },
                }),
            ],
            menus,
            logger,
        );

        expect(labels(menus, MenuId.EditorContext)).toEqual(["Do Thing"]);
        expect(lines).toEqual(['test.ext: неизвестная точка меню "timeline/item/context" — пункты пропущены']);
    });

    it("commandPalette называет себя отдельно: это фильтр палитры, а не точка меню", () => {
        const { menus, commands } = makeRegistry();
        const { logger, lines } = collectLog();
        commands.register("ext.doThing", () => undefined, "Do Thing");

        registerExtensionMenus(
            [extension("test.ext", { menus: { commandPalette: [{ command: "ext.doThing", when: "false" }] } })],
            menus,
            logger,
        );

        expect(lines).toEqual(['test.ext: пункты "commandPalette" пока не применяются']);
    });

    it("пункт без command и submenu пропускается с объяснением", () => {
        const { menus } = makeRegistry();
        const { logger, lines } = collectLog();

        registerExtensionMenus(
            [extension("test.ext", { menus: { "editor/context": [{ group: "navigation" }, { command: "" }] } })],
            menus,
            logger,
        );

        expect(labels(menus, MenuId.EditorContext)).toEqual([]);
        expect(lines).toEqual([
            "test.ext: пункт меню без command и submenu — пропущен",
            "test.ext: пункт меню без command и submenu — пропущен",
        ]);
    });

    it("submenu расширения раскрывается вложенной точкой со своими пунктами", () => {
        const { menus, commands } = makeRegistry();
        commands.register("ext.inner", () => undefined, "Inner");
        registerExtensionMenus(
            [
                extension("test.ext", {
                    submenus: [{ id: "ext.more", label: "More" }],
                    menus: {
                        "editor/context": [{ submenu: "ext.more", group: "navigation" }],
                        "ext.more": [{ command: "ext.inner" }],
                    },
                }),
            ],
            menus,
        );

        const submenus = menus.getSubmenus(MenuId.EditorContext);
        expect(submenus.map((entry) => entry.title)).toEqual(["More"]);
        expect(labels(menus, submenus[0].submenu)).toEqual(["Inner"]);
    });

    it("ссылка на необъявленное подменю — строка в лог, пункт пропущен", () => {
        const { menus } = makeRegistry();
        const { logger, lines } = collectLog();

        registerExtensionMenus(
            [extension("test.ext", { menus: { "editor/context": [{ submenu: "ext.ghost" }] } })],
            menus,
            logger,
        );

        expect(menus.getSubmenus(MenuId.EditorContext)).toEqual([]);
        expect(lines).toEqual(['test.ext: подменю "ext.ghost" не объявлено в contributes.submenus — пункт пропущен']);
    });

    it("одноимённые подменю разных расширений не схлопываются в одну точку", () => {
        const { menus, commands } = makeRegistry();
        commands.register("a.inner", () => undefined, "A Inner");
        commands.register("b.inner", () => undefined, "B Inner");
        registerExtensionMenus(
            [
                extension("test.a", {
                    submenus: [{ id: "more", label: "A More" }],
                    menus: { "editor/context": [{ submenu: "more" }], more: [{ command: "a.inner" }] },
                }),
                extension("test.b", {
                    submenus: [{ id: "more", label: "B More" }],
                    menus: { "editor/context": [{ submenu: "more" }], more: [{ command: "b.inner" }] },
                }),
            ],
            menus,
        );

        const submenus = menus.getSubmenus(MenuId.EditorContext);
        expect(submenus.map((entry) => entry.title)).toEqual(["A More", "B More"]);
        expect(labels(menus, submenus[0].submenu)).toEqual(["A Inner"]);
        expect(labels(menus, submenus[1].submenu)).toEqual(["B Inner"]);
    });

    it("dispose снимает все пункты расширений (перерегистрация состава)", () => {
        const { menus, commands } = makeRegistry();
        commands.register("ext.doThing", () => undefined, "Do Thing");
        const registration = registerExtensionMenus(
            [extension("test.ext", { menus: { "editor/context": [{ command: "ext.doThing" }] } })],
            menus,
        );
        expect(labels(menus, MenuId.EditorContext)).toEqual(["Do Thing"]);

        registration.dispose();

        expect(labels(menus, MenuId.EditorContext)).toEqual([]);
    });

    it("повторная регистрация того же подменю не падает на уникальности MenuId", () => {
        const first = makeRegistry();
        const second = makeRegistry();
        first.commands.register("ext.inner", () => undefined, "Inner");
        second.commands.register("ext.inner", () => undefined, "Inner");
        const manifest = extension("test.again", {
            submenus: [{ id: "again.more", label: "More" }],
            menus: {
                "editor/context": [{ submenu: "again.more" }],
                "again.more": [{ command: "ext.inner" }],
            },
        });

        registerExtensionMenus([manifest], first.menus);
        // Второй контейнер (новый профиль, пересборка состава) — тот же манифест.
        expect(() => registerExtensionMenus([manifest], second.menus)).not.toThrow();

        const submenus = second.menus.getSubmenus(MenuId.EditorContext);
        expect(labels(second.menus, submenus[0].submenu)).toEqual(["Inner"]);
    });

    it("мусор в объявлении подменю: не строковый id, пустой id и дубль — пропуск с объяснением", () => {
        const { menus } = makeRegistry();
        const { logger, lines } = collectLog();

        registerExtensionMenus(
            [
                extension("test.junk", {
                    submenus: [
                        { id: 42 as unknown as string, label: "Broken" },
                        { id: "", label: "Empty" },
                        { id: "more", label: "First" },
                        { id: "more", label: "Second" },
                    ],
                    menus: { "editor/context": [{ submenu: "more" }] },
                }),
            ],
            menus,
            logger,
        );

        // Выжило только первое объявление «more» — его label и стоит в пункте.
        expect(menus.getSubmenus(MenuId.EditorContext).map((entry) => entry.title)).toEqual(["First"]);
        expect(lines).toEqual([
            "test.junk: подменю без id — объявление пропущено",
            "test.junk: подменю без id — объявление пропущено",
            'test.junk: подменю "more" объявлено дважды — второе пропущено',
        ]);
    });

    it("подменю без строкового label подписывается своим id", () => {
        const { menus } = makeRegistry();

        registerExtensionMenus(
            [
                extension("test.nolabel", {
                    submenus: [{ id: "more", label: 42 as unknown as string }],
                    menus: { "editor/context": [{ submenu: "more" }] },
                }),
            ],
            menus,
        );

        expect(menus.getSubmenus(MenuId.EditorContext).map((entry) => entry.title)).toEqual(["more"]);
    });

    it("не строковые title/group/when пункта игнорируются, а не уезжают в меню как есть", () => {
        const { menus, commands } = makeRegistry();
        commands.register("ext.doThing", () => undefined, "Do Thing");

        registerExtensionMenus(
            [
                extension("test.types", {
                    menus: {
                        "editor/context": [
                            {
                                command: "ext.doThing",
                                title: 42 as unknown as string,
                                group: 7 as unknown as string,
                                when: 1 as unknown as string,
                            },
                        ],
                    },
                }),
            ],
            menus,
        );

        // Label — титул команды (свой не взяли), пункт виден (when не взяли).
        expect(labels(menus, MenuId.EditorContext)).toEqual(["Do Thing"]);
    });

    it("пустой title пункта — тоже не label: подписывает команда", () => {
        const { menus, commands } = makeRegistry();
        commands.register("ext.doThing", () => undefined, "Do Thing");

        registerExtensionMenus(
            [extension("test.emptytitle", { menus: { "editor/context": [{ command: "ext.doThing", title: "" }] } })],
            menus,
        );

        expect(labels(menus, MenuId.EditorContext)).toEqual(["Do Thing"]);
    });

    it("без логгера мусорный манифест не роняет старт — пункты просто не заводятся", () => {
        const { menus } = makeRegistry();

        expect(() =>
            registerExtensionMenus(
                [
                    extension("test.silent", {
                        submenus: [
                            { id: "", label: "Empty" },
                            { id: "more", label: "More" },
                            { id: "more", label: "Dup" },
                        ],
                        menus: {
                            "timeline/item/context": [{ command: "ext.gone" }],
                            commandPalette: [{ command: "ext.gone" }],
                            "editor/context": [{ group: "navigation" }, { submenu: "ext.ghost" }],
                        },
                    }),
                ],
                menus,
            ),
        ).not.toThrow();

        expect(labels(menus, MenuId.EditorContext)).toEqual([]);
    });

    it("расширение без contributes и без menus мост не трогает", () => {
        const { menus } = makeRegistry();
        const { logger, lines } = collectLog();

        registerExtensionMenus(
            [{ id: "test.bare", manifest: { name: "bare" } } as unknown as IExtension, extension("test.empty", {})],
            menus,
            logger,
        );

        expect(labels(menus, MenuId.EditorContext)).toEqual([]);
        expect(lines).toEqual([]);
    });
});
