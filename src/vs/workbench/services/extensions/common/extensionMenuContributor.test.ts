import { describe, expect, it } from "vitest";

import { CODICON_GLYPHS } from "../../../../base/common/codicons.generated.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { MenuRegistry } from "../../../../platform/actions/common/menuRegistry.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IExtensionContributions } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

import { parseMenuGroup, registerExtensionMenus } from "./extensionMenuContributor.ts";

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

function labels(menus: MenuRegistry, menuId: MenuId): string[] {
    return menus.getMenuItems(menuId).map((entry) => (entry.type === "separator" ? "─" : entry.label));
}

describe("parseMenuGroup", () => {
    it("`group@order` splits into group and order", () => {
        expect(parseMenuGroup("navigation@2")).toEqual({ group: "navigation", order: 2 });
        expect(parseMenuGroup("1_modification@1.5")).toEqual({ group: "1_modification", order: 1.5 });
    });

    it("without `@` — group only; without group — empty", () => {
        expect(parseMenuGroup("navigation")).toEqual({ group: "navigation" });
        expect(parseMenuGroup(undefined)).toEqual({});
        expect(parseMenuGroup("")).toEqual({});
    });

    it("non-numeric order is dropped instead of becoming NaN", () => {
        expect(parseMenuGroup("navigation@x")).toEqual({ group: "navigation" });
        expect(parseMenuGroup("@3")).toEqual({ order: 3 });
    });
});

describe("registerExtensionMenus", () => {
    it("extension item lands in the editor context menu with group and order", () => {
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

    it("item's own title overrides the command title", () => {
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

    it("item `when` is a real context key", () => {
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

    it("order within a group comes from `@`, not from manifest order", () => {
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

    it("different menu points go to their own registries", () => {
        const { menus, commands } = makeRegistry();
        commands.register("ext.editor", () => undefined, "In Editor");
        commands.register("ext.explorer", () => undefined, "In Explorer");
        registerExtensionMenus(
            [
                extension("test.ext", {
                    menus: {
                        "editor/context": [{ command: "ext.editor" }],
                        "explorer/context": [{ command: "ext.explorer" }],
                        "view/item/context": [{ command: "ext.row", group: "inline" }],
                    },
                }),
            ],
            menus,
        );

        expect(labels(menus, MenuId.EditorContext)).toEqual(["In Editor"]);
        expect(labels(menus, MenuId.ExplorerContext)).toEqual(["In Explorer"]);
        expect(menus.getMenuItemGroups(MenuId.ViewItemContext).map((group) => group.group)).toEqual(["inline"]);
    });

    it("unknown point — a log line, the extension's other items survive", () => {
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
        expect(lines).toEqual(['test.ext: unknown menu "timeline/item/context", items skipped']);
    });

    it("a built-in's commandPalette items become the palette filter: listed while one of their when holds", () => {
        const { menus, commands, contextKeys } = makeRegistry();
        const { logger, lines } = collectLog();
        commands.register("ext.doThing", () => undefined, "Do Thing");
        commands.register("ext.internal", () => undefined, "Internal");
        commands.register("ext.free", () => undefined, "Free");

        const registration = registerExtensionMenus(
            [
                {
                    ...extension("test.ext", {
                        menus: {
                            commandPalette: [
                                { command: "ext.doThing", when: "editorLangId == javascript" },
                                { command: "ext.doThing", when: "editorLangId == javascriptreact" },
                                { command: "ext.internal", when: "false" },
                            ],
                        },
                    }),
                    isBuiltin: true,
                },
            ],
            menus,
            logger,
        );

        expect(lines).toEqual([]);
        expect(menus.isInCommandPalette("ext.doThing")).toBe(false);
        contextKeys.set("editorLangId", "javascriptreact");
        expect(menus.isInCommandPalette("ext.doThing")).toBe(true);
        expect(menus.isInCommandPalette("ext.internal")).toBe(false);
        expect(menus.isInCommandPalette("ext.free")).toBe(true);

        registration.dispose();
        expect(menus.isInCommandPalette("ext.internal")).toBe(true);
    });

    it("a stock extension's commandPalette items are not applied: its when may read keys we do not set", () => {
        const { menus, commands } = makeRegistry();
        const { logger, lines } = collectLog();
        commands.register("EditorConfig.generate", () => undefined, "Generate .editorconfig");

        registerExtensionMenus(
            [
                {
                    ...extension("editorconfig.editorconfig", {
                        menus: {
                            commandPalette: [{ command: "EditorConfig.generate", when: "explorerResourceIsFolder" }],
                        },
                    }),
                    isBuiltin: false,
                },
            ],
            menus,
            logger,
        );

        expect(lines).toEqual(['editorconfig.editorconfig: "commandPalette" items are not applied yet']);
        expect(menus.isInCommandPalette("EditorConfig.generate")).toBe(true);
    });

    it("item without command and submenu is skipped with an explanation", () => {
        const { menus } = makeRegistry();
        const { logger, lines } = collectLog();

        registerExtensionMenus(
            [extension("test.ext", { menus: { "editor/context": [{ group: "navigation" }, { command: "" }] } })],
            menus,
            logger,
        );

        expect(labels(menus, MenuId.EditorContext)).toEqual([]);
        expect(lines).toEqual([
            "test.ext: menu item without command or submenu, skipped",
            "test.ext: menu item without command or submenu, skipped",
        ]);
    });

    it("extension submenu expands into a nested point with its own items", () => {
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

    it("reference to an undeclared submenu — a log line, item skipped", () => {
        const { menus } = makeRegistry();
        const { logger, lines } = collectLog();

        registerExtensionMenus(
            [extension("test.ext", { menus: { "editor/context": [{ submenu: "ext.ghost" }] } })],
            menus,
            logger,
        );

        expect(menus.getSubmenus(MenuId.EditorContext)).toEqual([]);
        expect(lines).toEqual(['test.ext: submenu "ext.ghost" is not declared in contributes.submenus, item skipped']);
    });

    it("same-named submenus of different extensions do not collapse into one point", () => {
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

    it("dispose removes all extension items (re-registration of the extension set)", () => {
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

    it("re-registering the same submenu does not fail on MenuId uniqueness", () => {
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
        // A second container (new profile, rebuilt extension set) with the same manifest.
        expect(() => registerExtensionMenus([manifest], second.menus)).not.toThrow();

        const submenus = second.menus.getSubmenus(MenuId.EditorContext);
        expect(labels(second.menus, submenus[0].submenu)).toEqual(["Inner"]);
    });

    it("junk in a submenu declaration: non-string id, empty id and duplicate — skipped with an explanation", () => {
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

        expect(menus.getSubmenus(MenuId.EditorContext).map((entry) => entry.title)).toEqual(["First"]);
        expect(lines).toEqual([
            "test.junk: submenu without id, declaration skipped",
            "test.junk: submenu without id, declaration skipped",
            'test.junk: submenu "more" declared twice, the second one skipped',
        ]);
    });

    it("submenu without a string label is labelled with its id", () => {
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

    it("non-string item title/group/when are ignored instead of going into the menu as is", () => {
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

        // The label is the command title (own one ignored), the item is visible (when ignored).
        expect(labels(menus, MenuId.EditorContext)).toEqual(["Do Thing"]);
    });

    it("empty item title is not a label either: the command labels it", () => {
        const { menus, commands } = makeRegistry();
        commands.register("ext.doThing", () => undefined, "Do Thing");

        registerExtensionMenus(
            [extension("test.emptytitle", { menus: { "editor/context": [{ command: "ext.doThing", title: "" }] } })],
            menus,
        );

        expect(labels(menus, MenuId.EditorContext)).toEqual(["Do Thing"]);
    });

    it("without a logger a junk manifest does not crash startup — items are just not created", () => {
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

    it("extension without contributes and menus leaves the bridge alone", () => {
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

describe("registerExtensionMenus — editor/title and command icons", () => {
    function icons(menus: MenuRegistry, menuId: MenuId): Record<string, string | undefined> {
        const result: Record<string, string | undefined> = {};
        for (const entry of menus.getMenuItems(menuId)) {
            if (entry.type === undefined && typeof entry.id === "string") result[entry.id] = entry.icon;
        }
        return result;
    }

    it("editor/title — editor group action bar; $(codicon) icon is a glyph, SVG and unknown codicon get no icon", () => {
        const { menus, commands } = makeRegistry();
        for (const id of ["ext.accept", "ext.open", "ext.ghost", "ext.plain"])
            commands.register(id, () => undefined, id);
        const { logger, lines } = collectLog();

        registerExtensionMenus(
            [
                extension("pub.claude", {
                    commands: [
                        { command: "ext.accept", title: "Accept", icon: "$(check)" },
                        { command: "ext.open", title: "Open", icon: { light: "a.svg", dark: "a.svg" } },
                        { command: "ext.ghost", title: "Ghost", icon: "$(no-such-codicon)" },
                        { command: "ext.plain", title: "Plain", icon: "resources/logo.svg" },
                    ],
                    menus: {
                        "editor/title": [
                            { command: "ext.accept", group: "navigation" },
                            { command: "ext.open", group: "navigation" },
                            { command: "ext.ghost", group: "navigation" },
                            { command: "ext.plain", group: "navigation" },
                        ],
                    },
                }),
            ],
            menus,
            logger,
        );

        expect(icons(menus, MenuId.EditorTitle)).toEqual({
            "ext.accept": "",
            "ext.open": undefined,
            "ext.ghost": undefined,
            "ext.plain": undefined,
        });
        expect(lines).toEqual([]);
    });

    it("icon is exactly `$(name)` or `$(name~modifier)`: with surrounding text it is not an icon", () => {
        const { menus, commands } = makeRegistry();
        const ids = ["ext.spin", "ext.before", "ext.after", "ext.emptyModifier"];
        for (const id of ids) commands.register(id, () => undefined, id);
        registerExtensionMenus(
            [
                extension("pub.claude", {
                    commands: [
                        { command: "ext.spin", title: "Spin", icon: "$(sync~spin)" },
                        { command: "ext.before", title: "Before", icon: "x $(check)" },
                        { command: "ext.after", title: "After", icon: "$(check) x" },
                        { command: "ext.emptyModifier", title: "Empty modifier", icon: "$(check~)" },
                    ],
                    menus: { "editor/title": ids.map((command) => ({ command, group: "navigation" })) },
                }),
            ],
            menus,
        );
        expect(icons(menus, MenuId.EditorTitle)).toStrictEqual({
            "ext.spin": CODICON_GLYPHS.sync,
            "ext.before": undefined,
            "ext.after": undefined,
            "ext.emptyModifier": undefined,
        });
    });

    it("icon belongs to the command: an item of another extension and another point gets the same one", () => {
        const { menus, commands } = makeRegistry();
        commands.register("ext.accept", () => undefined, "Accept");
        registerExtensionMenus(
            [
                extension("pub.owner", { commands: [{ command: "ext.accept", title: "Accept", icon: "$(check)" }] }),
                extension("pub.user", { menus: { "view/title": [{ command: "ext.accept", group: "navigation" }] } }),
            ],
            menus,
        );
        expect(icons(menus, MenuId.ViewTitle)).toEqual({ "ext.accept": "" });
    });
});
