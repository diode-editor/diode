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

/** The user settings.json, seeded with an empty object on a fresh install. */
function openUserSettingsFile(accessor: ServiceAccessor): Promise<void> {
    return openUserConfigFile(accessor, accessor.get(IEnvironmentServiceDIToken).settingsResource, "{}\n");
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
    run: openUserSettingsFile,
};

/**
 * Open the user settings.json (VS Code `workbench.action.openSettingsJson`) — the
 * JSON flavour of {@link openSettingsAction}; upstream extensions offer it from
 * validation toasts (golang.go: "Open Settings"). Upstream options
 * (`revealSetting`, `query`, `openToSide`) are accepted and not applied yet.
 */
export const openSettingsJsonAction: CommandAction = {
    id: "workbench.action.openSettingsJson",
    title: "Preferences: Open User Settings (JSON)",
    run: openUserSettingsFile,
};

/**
 * Открывает настройки воркспейса: у окна из `.code-workspace` — сам файл
 * воркспейса (его блок `settings`, как у эталона), иначе `.diode/settings.json`
 * открытой папки (у эталона `.vscode/settings.json`). Как у эталона, файла
 * папки может ещё не быть: он создаётся заготовкой. Без папки команды в палитре
 * нет (`workbenchState`), а вызов по id ничего не делает.
 */
function openWorkspaceSettingsFile(accessor: ServiceAccessor): Promise<void> {
    const workspace = accessor.get(IWorkspaceContextServiceDIToken).getWorkspace();
    if (workspace.configuration !== undefined) {
        accessor.get(CommandRegistryDIToken).execute("workbench.openFile", workspace.configuration.fsPath);
        return Promise.resolve();
    }
    return openFolderSettingsFile(accessor);
}

/**
 * Открывает `.diode/settings.json` единственной папки воркспейса (папку
 * выбирать не из чего — мульти-рута нет); файла нет — создаётся заготовкой.
 */
function openFolderSettingsFile(accessor: ServiceAccessor): Promise<void> {
    const folder = accessor.get(IWorkspaceContextServiceDIToken).getWorkspace().folders.at(0);
    if (folder === undefined) return Promise.resolve();
    return openUserConfigFile(accessor, workspaceSettingsPath(folder.uri.fsPath), "{}\n");
}

/**
 * Open the workspace settings (VS Code `workbench.action.openWorkspaceSettings`).
 * Diode has no settings UI, so — like {@link openSettingsAction} — the command
 * opens the JSON file directly.
 */
export const openWorkspaceSettingsAction: CommandAction = {
    id: "workbench.action.openWorkspaceSettings",
    title: "Preferences: Open Workspace Settings",
    // У эталона — `when: WorkbenchStateContext.notEqualsTo('empty')` пункта палитры.
    enablement: "workbenchState != 'empty'",
    run: openWorkspaceSettingsFile,
};

/** Open the workspace settings.json (VS Code `workbench.action.openWorkspaceSettingsFile`). */
export const openWorkspaceSettingsFileAction: CommandAction = {
    id: "workbench.action.openWorkspaceSettingsFile",
    title: "Preferences: Open Workspace Settings (JSON)",
    enablement: "workbenchState != 'empty'",
    run: openWorkspaceSettingsFile,
};

/**
 * Open the folder settings (VS Code `workbench.action.openFolderSettings`):
 * `.diode/settings.json` of the workspace folder. Only meaningful in a window
 * opened from a `.code-workspace` file — there the folder settings are a layer of
 * their own; in a folder window they are the workspace settings.
 */
export const openFolderSettingsAction: CommandAction = {
    id: "workbench.action.openFolderSettings",
    title: "Preferences: Open Folder Settings",
    // У эталона — `when: WorkbenchStateContext.isEqualTo('workspace')` пункта палитры.
    enablement: "workbenchState == 'workspace'",
    run: openFolderSettingsFile,
};

/** Open the folder settings.json (VS Code `workbench.action.openFolderSettingsFile`). */
export const openFolderSettingsFileAction: CommandAction = {
    id: "workbench.action.openFolderSettingsFile",
    title: "Preferences: Open Folder Settings (JSON)",
    enablement: "workbenchState == 'workspace'",
    run: openFolderSettingsFile,
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
    openSettingsJsonAction,
    openWorkspaceSettingsAction,
    openWorkspaceSettingsFileAction,
    openFolderSettingsAction,
    openFolderSettingsFileAction,
    openKeybindingsAction,
    openKeybindingsFileAction,
];
