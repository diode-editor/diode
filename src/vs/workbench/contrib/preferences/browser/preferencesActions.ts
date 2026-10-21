import { Uri } from "../../../../base/common/uri.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { workspaceSettingsPath } from "../../../../platform/configuration/common/workspaceSettings.ts";
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
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import type { EditorGroup } from "../../../services/editor/browser/editorGroupModel.ts";
import { KeybindingsEditorServiceDIToken } from "../../../services/keybinding/common/iKeybindingsEditorService.ts";

import { KeybindingRecorderComponentDIToken } from "./keybindingRecorderComponent.ts";
import { KeybindingsEditorPane, KeybindingsEditorTargetDIToken } from "./keybindingsEditorPane.ts";

/** The file may not exist yet: create it from a skeleton so Ctrl+S doesn't fail with ENOENT — as VS Code does. */
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

function openUserSettingsFile(accessor: ServiceAccessor): Promise<void> {
    return openUserConfigFile(accessor, accessor.get(IEnvironmentServiceDIToken).settingsResource, "{}\n");
}

/** There is no Settings UI — the command opens the JSON. */
export const openSettingsAction: CommandAction = {
    id: "workbench.action.openSettings",
    title: "Preferences: Open User Settings",
    shortTitle: "Settings",
    menus: [{ menuId: MenuId.MenubarFileMenu, group: "4_preferences", order: 10 }],
    keybinding: parseKeybinding("mod+,"),
    run: openUserSettingsFile,
};

/**
 * Extensions offer it from validation toasts (golang.go: "Open Settings"). Upstream options
 * (`revealSetting`, `query`, `openToSide`) are accepted and not applied yet.
 */
export const openSettingsJsonAction: CommandAction = {
    id: "workbench.action.openSettingsJson",
    title: "Preferences: Open User Settings (JSON)",
    run: openUserSettingsFile,
};

/**
 * For a window from `.code-workspace` — the workspace file itself (the `settings` block, as upstream), otherwise
 * the folder's `.diode/settings.json` (upstream: `.vscode/`). Without a folder, calling by id does nothing.
 */
function openWorkspaceSettingsFile(accessor: ServiceAccessor): Promise<void> {
    const workspace = accessor.get(IWorkspaceContextServiceDIToken).getWorkspace();
    if (workspace.configuration !== undefined) {
        accessor.get(CommandRegistryDIToken).execute("workbench.openFile", workspace.configuration.fsPath);
        return Promise.resolve();
    }
    return openFolderSettingsFile(accessor);
}

/** There is nothing to pick a folder from — no multi-root. */
function openFolderSettingsFile(accessor: ServiceAccessor): Promise<void> {
    const folder = accessor.get(IWorkspaceContextServiceDIToken).getWorkspace().folders.at(0);
    if (folder === undefined) return Promise.resolve();
    return openUserConfigFile(accessor, workspaceSettingsPath(folder.uri.fsPath), "{}\n");
}

export const openWorkspaceSettingsAction: CommandAction = {
    id: "workbench.action.openWorkspaceSettings",
    title: "Preferences: Open Workspace Settings",
    // Upstream: `when: WorkbenchStateContext.notEqualsTo('empty')` on the palette item.
    enablement: "workbenchState != 'empty'",
    run: openWorkspaceSettingsFile,
};

export const openWorkspaceSettingsFileAction: CommandAction = {
    id: "workbench.action.openWorkspaceSettingsFile",
    title: "Preferences: Open Workspace Settings (JSON)",
    enablement: "workbenchState != 'empty'",
    run: openWorkspaceSettingsFile,
};

/** Meaningful only in a window from `.code-workspace`: in a folder window its settings ARE the workspace settings. */
export const openFolderSettingsAction: CommandAction = {
    id: "workbench.action.openFolderSettings",
    title: "Preferences: Open Folder Settings",
    // Upstream: `when: WorkbenchStateContext.isEqualTo('workspace')` on the palette item.
    enablement: "workbenchState == 'workspace'",
    run: openFolderSettingsFile,
};

export const openFolderSettingsFileAction: CommandAction = {
    id: "workbench.action.openFolderSettingsFile",
    title: "Preferences: Open Folder Settings (JSON)",
    enablement: "workbenchState == 'workspace'",
    run: openFolderSettingsFile,
};

/** Raw keybindings.json is a separate command, as upstream. */
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

/** The group is passed on session restore via the tab factory. */
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

/** No default binding, as upstream: the JSON is the escape hatch, the UI tab is primary. */
export const openKeybindingsFileAction: CommandAction = {
    id: "workbench.action.openGlobalKeybindingsFile",
    title: "Preferences: Open Keyboard Shortcuts (JSON)",
    shortTitle: "Keyboard Shortcuts (JSON)",
    menus: [{ menuId: MenuId.MenubarFileMenu, group: "4_preferences", order: 21 }],
    run(accessor) {
        return openUserConfigFile(accessor, accessor.get(IEnvironmentServiceDIToken).keybindingsResource, "[]\n");
    },
};

export const PREFERENCES_ACTIONS: readonly CommandAction[] = [
    openSettingsAction,
    openSettingsJsonAction,
    openWorkspaceSettingsAction,
    openWorkspaceSettingsFileAction,
    openFolderSettingsAction,
    openFolderSettingsFileAction,
    openKeybindingsAction,
    openKeybindingsFileAction,
];
