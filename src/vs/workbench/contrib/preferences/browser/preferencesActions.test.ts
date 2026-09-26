import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import {
    ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    formatKeybinding,
    KeybindingRegistry,
    KeybindingRegistryDIToken,
    parseKeybinding,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { ClipboardDIToken } from "../../../common/coreTokens.ts";
import type { IKeybindingsEditorService } from "../../../services/keybinding/common/iKeybindingsEditorService.ts";
import { KeybindingsEditorServiceDIToken } from "../../../services/keybinding/common/iKeybindingsEditorService.ts";

import type { KeybindingRecorderComponent } from "./keybindingRecorderComponent.ts";
import { KeybindingRecorderComponentDIToken } from "./keybindingRecorderComponent.ts";
import { KeybindingsEditorTargetDIToken } from "./keybindingsEditorPane.ts";
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

    it("вкладка Keyboard Shortcuts подписывает комбинации по ОС клавиатуры: на маке — глифами", () => {
        function openedScreen(isMac: boolean): string {
            const keybindings = new KeybindingRegistry();
            const commands = new CommandRegistry();
            commands.register("save", () => {}, "Save File");
            keybindings.register(parseKeybinding("meta+s"), "save");
            const contextKeys = new ContextKeyService();
            contextKeys.set("isMac", isMac);
            const opened: IEditorPane[] = [];
            const container = new Container();
            container.bind(KeybindingRegistryDIToken, () => keybindings);
            container.bind(CommandRegistryDIToken, () => commands);
            container.bind(ContextKeyServiceDIToken, () => contextKeys);
            container.bind(
                KeybindingsEditorServiceDIToken,
                () =>
                    ({
                        onDidChange: () => ({ dispose: () => undefined }),
                        hasUserModifications: () => false,
                    }) as unknown as IKeybindingsEditorService,
            );
            container.bind(KeybindingRecorderComponentDIToken, () => ({}) as KeybindingRecorderComponent);
            container.bind(ContextMenuServiceDIToken, () => ({}) as ContextMenuService);
            container.bind(ClipboardDIToken, () => ({
                readText: () => Promise.resolve(""),
                writeText: () => Promise.resolve(),
            }));
            container.bind(KeybindingsEditorTargetDIToken, () => ({
                openPane: (pane: IEditorPane) => opened.push(pane),
            }));

            openKeybindingsAction.run(container);
            return renderElement(opened[0].view, 80, 8, { themeVars: true }).screenToString();
        }

        expect(openedScreen(true)).toContain("⌘S");
        expect(openedScreen(false)).toContain("Meta+S");
    });
});
