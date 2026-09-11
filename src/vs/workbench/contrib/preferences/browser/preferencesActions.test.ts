import { describe, expect, it } from "vitest";

import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { formatKeybinding, KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { openKeybindingsAction, openKeybindingsFileAction, openSettingsAction } from "./preferencesActions.ts";

describe("PreferencesActions", () => {
    it("declares VS Code-compatible ids, titles and default bindings", () => {
        expect(openSettingsAction.id).toBe("workbench.action.openSettings");
        expect(openSettingsAction.title).toBe("Preferences: Open User Settings");
        expect(openKeybindingsAction.id).toBe("workbench.action.openGlobalKeybindings");
        expect(openKeybindingsAction.title).toBe("Preferences: Open Keyboard Shortcuts");
        expect(openKeybindingsFileAction.id).toBe("workbench.action.openGlobalKeybindingsFile");
        expect(openKeybindingsFileAction.title).toBe("Preferences: Open Keyboard Shortcuts (JSON)");
        // JSON — запасной ход без дефолтной клавиши, как в VS Code.
        expect(openKeybindingsFileAction.keybinding).toBeUndefined();
        expect(openKeybindingsFileAction.keybindings).toBeUndefined();
    });

    it("registers each command with its title and default keybinding", () => {
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();

        registerAction(commands, keybindings, accessor, openSettingsAction);
        registerAction(commands, keybindings, accessor, openKeybindingsAction);
        registerAction(commands, keybindings, accessor, openKeybindingsFileAction);

        expect(commands.has("workbench.action.openSettings")).toBe(true);
        expect(commands.has("workbench.action.openGlobalKeybindings")).toBe(true);
        expect(commands.has("workbench.action.openGlobalKeybindingsFile")).toBe(true);

        const settingsChord = keybindings.getKeybindingForCommand("workbench.action.openSettings");
        expect(settingsChord && formatKeybinding(settingsChord)).toBe("Ctrl+,");
        const kbChord = keybindings.getKeybindingForCommand("workbench.action.openGlobalKeybindings");
        expect(kbChord && formatKeybinding(kbChord)).toBe("Ctrl+K Ctrl+S");
        expect(keybindings.getKeybindingForCommand("workbench.action.openGlobalKeybindingsFile")).toBeUndefined();
    });
});
