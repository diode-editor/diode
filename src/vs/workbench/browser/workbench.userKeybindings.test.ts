import { describe, expect, it } from "vitest";

import { UserKeybindingsDIToken } from "../../diode/modules/keybindingsModule.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import type { KeyboardEventLike } from "../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingRegistryDIToken } from "../../platform/keybinding/common/keybindingRegistry.ts";
import type { IUserKeybindingRule } from "../../platform/keybinding/node/keybindingsService.ts";

import { WorkbenchComponentDIToken } from "./workbenchComponent.ts";

const KEY = (key: string, mods: Partial<KeyboardEventLike> = {}): KeyboardEventLike => ({
    key,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...mods,
});

/** Build an app whose user keybindings.json is the given rules, return its registry. */
function appWithRules(rules: IUserKeybindingRule[]) {
    const { container } = createTestContainer();
    // Rebind before the Workbench is constructed (rules are read in its constructor).
    container.bind(UserKeybindingsDIToken, () => rules);
    container.get(WorkbenchComponentDIToken);
    const keybindings = container.get(KeybindingRegistryDIToken);
    // Живые контекст-ключи: у дефолтов с `mod` (Ctrl+S и т.п.) условие по мак-рунгу.
    const contextKeys = container.get(ContextKeyServiceDIToken);
    return { keybindings, contextKeys };
}

function resolve(app: ReturnType<typeof appWithRules>, event: KeyboardEventLike) {
    const res = app.keybindings.resolveKey(event, app.contextKeys);
    return res.kind === "command" ? res.commandId : undefined;
}

describe("Workbench — user keybindings.json", () => {
    it("registers a user binding (no when) so the key resolves to the command", () => {
        const app = appWithRules([{ key: "ctrl+alt+k", command: "workbench.action.files.save" }]);
        expect(resolve(app, KEY("k", { ctrlKey: true, altKey: true }))).toBe("workbench.action.files.save");
    });

    it("unbinds a default command with -command, making its key inert", () => {
        // ctrl+b → toggle sidebar (a default with no when).
        const before = appWithRules([]);
        expect(resolve(before, KEY("b", { ctrlKey: true }))).toBe("workbench.action.toggleSidebarVisibility");

        const after = appWithRules([{ key: "ctrl+b", command: "-workbench.action.toggleSidebarVisibility" }]);
        expect(resolve(after, KEY("b", { ctrlKey: true }))).toBeUndefined();
    });

    it("a user binding registered last wins over a default on the same key", () => {
        const app = appWithRules([{ key: "ctrl+b", command: "user.custom.command" }]);
        expect(resolve(app, KEY("b", { ctrlKey: true }))).toBe("user.custom.command");
    });

    it("an unbind rule with an empty key removes ALL bindings for the command", () => {
        // The default command can be triggered by ctrl+s (its sole default binding).
        const before = appWithRules([]);
        expect(resolve(before, KEY("s", { ctrlKey: true }))).toBe("workbench.action.files.save");

        // `-command` with no key (stored as "") unbinds every binding for that command.
        const after = appWithRules([{ key: "", command: "-workbench.action.files.save" }]);
        expect(resolve(after, KEY("s", { ctrlKey: true }))).toBeUndefined();
    });
});
