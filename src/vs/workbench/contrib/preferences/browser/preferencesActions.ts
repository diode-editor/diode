import * as fs from "node:fs";
import * as path from "node:path";

import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import {
    KeybindingRegistryDIToken,
    parseChord,
    parseKeybinding,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { ClipboardDIToken, KeybindingsResourceDIToken, SettingsResourceDIToken } from "../../../common/coreTokens.ts";
import { KeybindingsEditorServiceDIToken } from "../../../services/keybinding/common/iKeybindingsEditorService.ts";

import { KeybindingRecorderComponentDIToken } from "./keybindingRecorderComponent.ts";
import { KeybindingsEditorPane, KeybindingsEditorTargetDIToken } from "./keybindingsEditorPane.ts";

/**
 * Opens a user-config file (settings.json / keybindings.json) as an editor tab.
 * The path is resolved at bootstrap; it is null in tests/demo where no user data
 * dir is wired — then this is a no-op. On a fresh install the file may not exist
 * yet: we seed it (create the parent dir + a minimal skeleton) so the editor opens
 * a real file and a subsequent Ctrl+S can't fail with ENOENT, mirroring VS Code.
 */
function openUserConfigFile(
    accessor: ServiceAccessor,
    resource: string | null,
    kind: "settings" | "keybindings",
): void {
    if (resource === null) return;
    if (!fs.existsSync(resource)) {
        const skeleton = kind === "settings" ? "{}\n" : "[]\n";
        fs.mkdirSync(path.dirname(resource), { recursive: true });
        fs.writeFileSync(resource, skeleton, "utf-8");
    }
    accessor.get(CommandRegistryDIToken).execute("workbench.openFile", resource);
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
    keybinding: parseKeybinding("ctrl+,"),
    run(accessor) {
        openUserConfigFile(accessor, accessor.get(SettingsResourceDIToken), "settings");
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
    keybinding: parseChord("ctrl+k ctrl+s"),
    run(accessor) {
        const pane = new KeybindingsEditorPane(
            accessor.get(KeybindingRegistryDIToken),
            accessor.get(CommandRegistryDIToken),
            accessor.get(KeybindingsEditorServiceDIToken),
            accessor.get(KeybindingRecorderComponentDIToken),
            accessor.get(ContextMenuServiceDIToken),
            accessor.get(ClipboardDIToken),
        );
        accessor.get(KeybindingsEditorTargetDIToken).openPane(pane);
    },
};

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
        openUserConfigFile(accessor, accessor.get(KeybindingsResourceDIToken), "keybindings");
    },
};
