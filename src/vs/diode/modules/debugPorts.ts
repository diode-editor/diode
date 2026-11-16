import { Uri } from "../../base/common/uri.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { IEnvironmentServiceDIToken } from "../../platform/environment/common/environment.ts";
import { IFileServiceDIToken } from "../../platform/files/common/files.ts";
import type { ServiceAccessor } from "../../platform/instantiation/common/diContainer.ts";
import { MarkerServiceDIToken } from "../../platform/markers/common/markerService.ts";
import { StateServiceDIToken } from "../../platform/state/common/iStateService.ts";
import { IWorkspaceContextServiceDIToken } from "../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { ViewsServiceDIToken } from "../../workbench/browser/parts/views/viewsService.ts";
import type { IConfigurationManagerPorts } from "../../workbench/contrib/debug/browser/debugConfigurationManager.ts";
import type { IDebugTaskRunnerPorts } from "../../workbench/contrib/debug/browser/debugTaskRunner.ts";
import type { IDebugVariableResolver } from "../../workbench/contrib/debug/common/debug.ts";
import { PROBLEMS_VIEW_ID } from "../../workbench/contrib/markers/browser/problemsComponent.ts";
import { TaskServiceDIToken } from "../../workbench/contrib/tasks/browser/taskService.ts";
import { ConfigurationResolverServiceDIToken } from "../../workbench/services/configurationResolver/browser/configurationResolverService.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/common/editorService.ts";
import { NotificationServiceDIToken } from "../../workbench/services/notification/browser/notificationService.ts";

/** Upstream opens a configuration at column 4 of its line: past the indentation of a `configurations` entry. */
const CONFIGURATION_COLUMN = 3;

export function configurationManagerPorts(container: ServiceAccessor): IConfigurationManagerPorts {
    const commands = container.get(CommandRegistryDIToken);
    return {
        configuration: container.get(IConfigurationServiceDIToken),
        workspace: container.get(IWorkspaceContextServiceDIToken),
        state: container.get(StateServiceDIToken),
        contextKeys: container.get(ContextKeyServiceDIToken),
        files: container.get(IFileServiceDIToken),
        openEditor: async (resource, { preserveFocus, line }) => {
            const editors = container.get(EditorServiceDIToken);
            await editors.openUri(resource, { focus: !preserveFocus });
            const editor = editors.getActiveEditor();
            if (line !== undefined && editor?.uri.toString() === resource.toString()) {
                editor.goToPosition(line, CONFIGURATION_COLUMN);
            }
        },
        userSettings: {
            resource: Uri.file(container.get(IEnvironmentServiceDIToken).settingsResource),
            open: async () => {
                await commands.execute("workbench.action.openSettingsJson");
            },
        },
    };
}

export function debugTaskRunnerPorts(container: ServiceAccessor): IDebugTaskRunnerPorts {
    const commands = container.get(CommandRegistryDIToken);
    return {
        tasks: container.get(TaskServiceDIToken),
        markers: container.get(MarkerServiceDIToken),
        configuration: container.get(IConfigurationServiceDIToken),
        notifications: container.get(NotificationServiceDIToken),
        state: container.get(StateServiceDIToken),
        openProblemsView: () => {
            container.get(ViewsServiceDIToken).openView(PROBLEMS_VIEW_ID, true);
        },
        configureTask: async () => {
            await commands.execute("workbench.action.tasks.configureTaskRunner");
        },
    };
}

/** Upstream `saveAllBeforeDebugStart`, then the configuration is reread: a saved launch.json is read at once. */
export async function saveAllBeforeDebugStart(container: ServiceAccessor): Promise<void> {
    const configuration = container.get(IConfigurationServiceDIToken);
    const editors = container.get(EditorServiceDIToken);
    const activeEditor = editors.getActiveEditor();
    const saveBeforeStartConfig = configuration.get("debug.saveBeforeStart", {
        overrideIdentifier: activeEditor?.languageId,
    });
    if (saveBeforeStartConfig !== "none") {
        await editors.saveAll();
        if (saveBeforeStartConfig === "allEditorsInActiveGroup" && activeEditor?.uri.scheme === "untitled") {
            // Make sure to save the active editor in case it is in untitled file it wont be saved as part of saveAll #111850
            await editors.save(activeEditor.uri);
        }
    }
    await configuration.reloadConfiguration?.();
}

/**
 * Upstream's `resolveWithInteractionReplace(folder, config, 'launch', variables, target)`: `${input:…}` reads the
 * `inputs` of the file the configuration comes from, else of the merged `launch` section.
 */
export function debugVariableResolver(container: ServiceAccessor): IDebugVariableResolver {
    const resolver = container.get(ConfigurationResolverServiceDIToken);
    const configuration = container.get(IConfigurationServiceDIToken);
    const workspace = container.get(IWorkspaceContextServiceDIToken);
    return (folder, config, variables) =>
        resolver.resolveWithInteractionReplace(folder, config, "launch", variables, () => {
            const inspected = configuration.inspect<{ readonly inputs?: unknown } | undefined>("launch");
            let section: { readonly inputs?: unknown } | undefined;
            switch (config.__configurationTarget) {
                case "user":
                    section = inspected.profile ?? inspected.user;
                    break;
                case "workspace":
                    section = inspected.workspace;
                    break;
                default:
                    // A folder's launch.json is the workspace layer of a folder window (`Launch.getConfig`).
                    section =
                        workspace.getWorkbenchState() === "workspace" ? inspected.workspaceFolder : inspected.workspace;
            }
            const inputs =
                section?.inputs ?? configuration.get<{ readonly inputs?: unknown } | undefined>("launch")?.inputs;
            return Promise.resolve(Array.isArray(inputs) ? (inputs as unknown[]) : undefined);
        });
}
