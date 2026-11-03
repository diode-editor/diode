import { describe, expect, it } from "vitest";

import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { MenuRegistry } from "../../../../platform/actions/common/menuRegistry.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IExtensionContributions } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { registerExtensionMenus } from "./extensionMenuContributor.ts";

function extension(id: string, contributes: IExtensionContributions): IExtension {
    return { id, manifest: { name: id, publisher: "test", version: "0.0.1", contributes } } as unknown as IExtension;
}

function setup(menus: IExtensionContributions["menus"], titles: Record<string, string>): string[] {
    const commands = new CommandRegistry();
    for (const [id, title] of Object.entries(titles)) commands.register(id, () => undefined, title);
    const registry = new MenuRegistry(commands, new KeybindingRegistry(), new ContextKeyService(), []);
    registerExtensionMenus([extension("test.ext", { menus })], registry);
    return registry.getMenuItems(MenuId.EditorContext).map((entry) => (entry.type === "separator" ? "─" : entry.label));
}

describe("registerExtensionMenus — items without a group", () => {
    it('no group, `group: ""` and `@N` share the last section, ordered by N then manifest order', () => {
        const labels = setup(
            {
                "editor/context": [
                    { command: "ext.at3", group: "@3" },
                    { command: "ext.none" },
                    { command: "ext.mod", group: "1_modification" },
                    { command: "ext.empty", group: "" },
                    { command: "ext.nav", group: "0_navigation@1" },
                ],
            },
            {
                "ext.at3": "At Three",
                "ext.none": "No Group",
                "ext.mod": "Modify",
                "ext.empty": "Empty Group",
                "ext.nav": "Navigate",
            },
        );
        expect(labels).toEqual(["Navigate", "─", "Modify", "─", "No Group", "Empty Group", "At Three"]);
    });

    it("two extensions' ungrouped items sit together after every named group of both", () => {
        const commands = new CommandRegistry();
        commands.register("a.ungrouped", () => undefined, "A Ungrouped");
        commands.register("a.nav", () => undefined, "A Nav");
        commands.register("b.ungrouped", () => undefined, "B Ungrouped");
        commands.register("b.z", () => undefined, "B Z");
        const registry = new MenuRegistry(commands, new KeybindingRegistry(), new ContextKeyService(), []);
        registerExtensionMenus(
            [
                extension("a.ext", {
                    menus: {
                        "editor/context": [{ command: "a.ungrouped" }, { command: "a.nav", group: "navigation" }],
                    },
                }),
                extension("b.ext", {
                    menus: { "editor/context": [{ command: "b.ungrouped" }, { command: "b.z", group: "z_commands" }] },
                }),
            ],
            registry,
        );
        expect(
            registry
                .getMenuItems(MenuId.EditorContext)
                .map((entry) => (entry.type === "separator" ? "─" : entry.label)),
        ).toEqual(["A Nav", "─", "B Z", "─", "A Ungrouped", "B Ungrouped"]);
    });
});
