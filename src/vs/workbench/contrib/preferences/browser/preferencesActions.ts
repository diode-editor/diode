import { Uri } from "../../../../base/common/uri.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { IEnvironmentServiceDIToken } from "../../../../platform/environment/common/environment.ts";
import { IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    keybindingLabelStyle,
    KeybindingRegistryDIToken,
    parseChord,
    parseKeybinding,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { EditorGroup } from "../../../services/editor/browser/editorGroupModel.ts";
import { KeybindingsEditorServiceDIToken } from "../../../services/keybinding/common/iKeybindingsEditorService.ts";

import { KeybindingRecorderComponentDIToken } from "./keybindingRecorderComponent.ts";
import { KeybindingsEditorPane, KeybindingsEditorTargetDIToken } from "./keybindingsEditorPane.ts";

/**
 * Opens a user-config file (settings.json / keybindings.json) as an editor tab.
 * The path comes from the process environment. On a fresh install the file may not exist
 * yet: we seed it (create the parent dir + a minimal skeleton) so the editor opens
 * a real file and a subsequent Ctrl+S can't fail with ENOENT, mirroring VS Code.
 */
async function openUserConfigFile(accessor: ServiceAccessor, resource: string, skeleton: string): Promise<void> {
    const files = accessor.get(IFileServiceDIToken);
    const commands = accessor.get(CommandRegistryDIToken);
    const uri = Uri.file(resource);
    if (!(await files.exists(uri))) {
        await files.createFolder(Uri.joinPath(uri, ".."));
        await files.writeFile(uri, new TextEncoder().encode(skeleton));
    }
    commands.execute("workbench.openFile", resource);
}

/**
 * Open the user settings.json (VS Code `workbench.action.openSettings`). Diode has
 * no settings UI, so the command opens the JSON file directly. Default binding
 * matches VS Code (Ctrl+,).
 */
export const openSettingsAction: CommandAction = {
    id: "workbench.action.openSettings",
    title: "Preferences: Open User Settings",
    shortTitle: "Settings",
    menus: [{ menuId: MenuId.MenubarFileMenu, group: "4_preferences", order: 10 }],
    keybinding: parseKeybinding("mod+,"),
    run(accessor) {
        return openUserConfigFile(accessor, accessor.get(IEnvironmentServiceDIToken).settingsResource, "{}\n");
    },
};

/**
 * Open the Keyboard Shortcuts editor tab (VS Code
 * `workbench.action.openGlobalKeybindings`). Default chord matches VS Code
 * (Ctrl+K Ctrl+S); the raw keybindings.json is a separate command, as upstream.
 */
export const openKeybindingsAction: CommandAction = {
    id: "workbench.action.openGlobalKeybindings",
    title: "Preferences: Open Keyboard Shortcuts",
    shortTitle: "Keyboard Shortcuts",
    menus: [{ menuId: MenuId.MenubarFileMenu, group: "4_preferences", order: 20 }],
    keybinding: parseChord("mod+k mod+s"),
    run(accessor) {
        openKeybindingsEditor(accessor);
    },
};

/**
 * Вкладка Keyboard Shortcuts — в активную группу либо в указанную (рестор
 * сессии через фабрику вкладки). Уже открыта в группе — активируется.
 */
export function openKeybindingsEditor(
    accessor: ServiceAccessor,
    options: { focus?: boolean; group?: EditorGroup } = {},
): void {
    const pane = new KeybindingsEditorPane(
        accessor.get(KeybindingRegistryDIToken),
        accessor.get(CommandRegistryDIToken),
        accessor.get(KeybindingsEditorServiceDIToken),
        accessor.get(KeybindingRecorderComponentDIToken),
        accessor.get(ContextMenuServiceDIToken),
        accessor.get(ClipboardDIToken),
        () => keybindingLabelStyle(accessor.get(ContextKeyServiceDIToken)),
    );
    accessor.get(KeybindingsEditorTargetDIToken).openPane(pane, options);
}

/**
 * Open the user keybindings.json (VS Code `workbench.action.openGlobalKeybindingsFile`).
 * No default binding, as upstream: the JSON is the escape hatch, the UI tab is primary.
 */
export const openKeybindingsFileAction: CommandAction = {
    id: "workbench.action.openGlobalKeybindingsFile",
    title: "Preferences: Open Keyboard Shortcuts (JSON)",
    shortTitle: "Keyboard Shortcuts (JSON)",
    menus: [{ menuId: MenuId.MenubarFileMenu, group: "4_preferences", order: 21 }],
    run(accessor) {
        return openUserConfigFile(accessor, accessor.get(IEnvironmentServiceDIToken).keybindingsResource, "[]\n");
    },
};

/** Экшены настроек и вкладки Keyboard Shortcuts. Фича отдаёт их одним массивом; регистрирует агрегатор (`WORKBENCH_ACTIONS`). */
export const PREFERENCES_ACTIONS: readonly CommandAction[] = [
    openSettingsAction,
    openKeybindingsAction,
    openKeybindingsFileAction,
];
