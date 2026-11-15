import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../base/common/uri.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { IEnvironmentServiceDIToken } from "../../platform/environment/common/environment.ts";
import { IFileServiceDIToken } from "../../platform/files/common/files.ts";
import type { ServiceAccessor, Token } from "../../platform/instantiation/common/diContainer.ts";
import { MarkerServiceDIToken } from "../../platform/markers/common/markerService.ts";
import { StateServiceDIToken } from "../../platform/state/common/iStateService.ts";
import { IWorkspaceContextServiceDIToken } from "../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { ViewsServiceDIToken } from "../../workbench/browser/parts/views/viewsService.ts";
import { PROBLEMS_VIEW_ID } from "../../workbench/contrib/markers/browser/problemsComponent.ts";
import { TaskServiceDIToken } from "../../workbench/contrib/tasks/browser/taskService.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/common/editorService.ts";
import { NotificationServiceDIToken } from "../../workbench/services/notification/browser/notificationService.ts";

import { configurationManagerPorts, debugTaskRunnerPorts, saveAllBeforeDebugStart } from "./debugPorts.ts";

const LAUNCH = Uri.file("/w/.diode/launch.json");

function accessorOf(services: Map<Token<unknown>, unknown>): ServiceAccessor {
    return {
        get: <T>(token: Token<T>): T => {
            if (!services.has(token)) throw new Error(`unexpected ${token.id}`);
            return services.get(token) as T;
        },
    };
}

describe("the ports of the debug service", () => {
    function setup(options: { saveBeforeStart?: string; active?: { uri: Uri; languageId: string } | null } = {}) {
        const commands = { execute: vi.fn() };
        const goToPosition = vi.fn();
        let active: { uri: Uri; languageId: string; goToPosition: typeof goToPosition } | null =
            options.active === undefined ? null : options.active && { ...options.active, goToPosition };
        const order: string[] = [];
        const editors = {
            openUri: vi.fn((uri: Uri) => {
                active = { uri, languageId: "jsonc", goToPosition };
                return Promise.resolve();
            }),
            getActiveEditor: () => active,
            saveAll: vi.fn(() => {
                order.push("saveAll");
                return Promise.resolve(true);
            }),
            save: vi.fn((uri: Uri) => {
                order.push(`save ${uri.toString()}`);
                return Promise.resolve(uri);
            }),
        };
        const configuration = {
            get: vi.fn(() => options.saveBeforeStart),
            reloadConfiguration: vi.fn(() => {
                order.push("reload");
                return Promise.resolve();
            }),
        };
        const views = { openView: vi.fn() };
        const services = new Map<Token<unknown>, unknown>([
            [CommandRegistryDIToken, commands],
            [IConfigurationServiceDIToken, configuration],
            [IWorkspaceContextServiceDIToken, { name: "workspace" }],
            [StateServiceDIToken, { name: "state" }],
            [ContextKeyServiceDIToken, { name: "contextKeys" }],
            [IFileServiceDIToken, { name: "files" }],
            [EditorServiceDIToken, editors],
            [IEnvironmentServiceDIToken, { settingsResource: "/user/settings.json" }],
            [TaskServiceDIToken, { name: "tasks" }],
            [MarkerServiceDIToken, { name: "markers" }],
            [NotificationServiceDIToken, { name: "notifications" }],
            [ViewsServiceDIToken, views],
        ]);
        return {
            accessor: accessorOf(services),
            services,
            commands,
            editors,
            configuration,
            views,
            goToPosition,
            order,
        };
    }

    it("the configuration manager gets the workbench's services", () => {
        const { accessor, services } = setup();

        const ports = configurationManagerPorts(accessor);

        expect([ports.configuration, ports.workspace, ports.state, ports.contextKeys, ports.files]).toEqual(
            [
                IConfigurationServiceDIToken,
                IWorkspaceContextServiceDIToken,
                StateServiceDIToken,
                ContextKeyServiceDIToken,
                IFileServiceDIToken,
            ].map((token) => services.get(token)),
        );
        expect(ports.userSettings.resource.toString()).toBe("file:///user/settings.json");
    });

    it("opens a configuration at column 4 of its line, focused unless asked to preserve the focus", async () => {
        const { accessor, editors, goToPosition } = setup();
        const ports = configurationManagerPorts(accessor);

        await ports.openEditor(LAUNCH, { preserveFocus: false, line: 5 });
        await ports.openEditor(LAUNCH, { preserveFocus: true });

        expect(editors.openUri.mock.calls).toEqual([
            [LAUNCH, { focus: true }],
            [LAUNCH, { focus: false }],
        ]);
        expect(goToPosition.mock.calls).toEqual([[5, 3]]);
    });

    it("does not move the caret of another editor when the file did not open", async () => {
        const { accessor, editors, goToPosition } = setup();
        editors.openUri.mockResolvedValueOnce(undefined);

        await configurationManagerPorts(accessor).openEditor(LAUNCH, { preserveFocus: false, line: 5 });

        expect(goToPosition).not.toHaveBeenCalled();
    });

    it("the user settings open with Open User Settings (JSON); the tasks' ports run the workbench's commands", async () => {
        const { accessor, services, commands, views } = setup();

        await configurationManagerPorts(accessor).userSettings.open();
        const tasks = debugTaskRunnerPorts(accessor);
        await tasks.configureTask();
        tasks.openProblemsView();

        expect(commands.execute.mock.calls).toEqual([
            ["workbench.action.openSettingsJson"],
            ["workbench.action.tasks.configureTaskRunner"],
        ]);
        expect(views.openView).toHaveBeenCalledWith(PROBLEMS_VIEW_ID, true);
        expect([tasks.tasks, tasks.markers, tasks.configuration, tasks.notifications, tasks.state]).toEqual(
            [
                TaskServiceDIToken,
                MarkerServiceDIToken,
                IConfigurationServiceDIToken,
                NotificationServiceDIToken,
                StateServiceDIToken,
            ].map((token) => services.get(token)),
        );
    });

    describe("saving before a start", () => {
        it("allEditorsInActiveGroup saves all and an untitled active editor, then rereads the configuration", async () => {
            const untitled = Uri.from({ scheme: "untitled", path: "Untitled-1" });
            const { accessor, configuration, order } = setup({
                saveBeforeStart: "allEditorsInActiveGroup",
                active: { uri: untitled, languageId: "c" },
            });

            await saveAllBeforeDebugStart(accessor);

            expect(configuration.get).toHaveBeenCalledWith("debug.saveBeforeStart", { overrideIdentifier: "c" });
            expect(order).toEqual(["saveAll", `save ${untitled.toString()}`, "reload"]);
        });

        it("a file editor is saved by saveAll alone; nonUntitledEditorsInActiveGroup leaves an untitled one", async () => {
            const file = setup({
                saveBeforeStart: "allEditorsInActiveGroup",
                active: { uri: LAUNCH, languageId: "c" },
            });
            await saveAllBeforeDebugStart(file.accessor);
            expect(file.order).toEqual(["saveAll", "reload"]);

            const untitled = setup({
                saveBeforeStart: "nonUntitledEditorsInActiveGroup",
                active: { uri: Uri.from({ scheme: "untitled", path: "U" }), languageId: "c" },
            });
            await saveAllBeforeDebugStart(untitled.accessor);
            expect(untitled.order).toEqual(["saveAll", "reload"]);
        });

        it("none saves nothing; without an active editor no language is asked for", async () => {
            const { accessor, configuration, order } = setup({ saveBeforeStart: "none" });

            await saveAllBeforeDebugStart(accessor);

            expect(configuration.get).toHaveBeenCalledWith("debug.saveBeforeStart", { overrideIdentifier: undefined });
            expect(order).toEqual(["reload"]);
        });
    });
});
