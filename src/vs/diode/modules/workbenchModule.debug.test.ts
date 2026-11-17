import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../base/common/uri.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";
import { StateServiceDIToken } from "../../platform/state/common/iStateService.ts";
import { IWorkspaceContextServiceDIToken } from "../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { DebugLifecycle, DebugLifecycleDIToken } from "../../workbench/contrib/debug/browser/debugLifecycle.ts";
import { DebugQuickAccessProviderDIToken } from "../../workbench/contrib/debug/browser/debugQuickAccess.ts";
import {
    DebugExtensionActivatorDIToken,
    DebugServicePortsDIToken,
    NO_DEBUG_EXTENSIONS,
} from "../../workbench/contrib/debug/browser/debugService.ts";
import { QuickAccessRegistryDIToken } from "../../workbench/contrib/quickaccess/common/quickAccessRegistry.ts";
import { TaskServiceDIToken } from "../../workbench/contrib/tasks/browser/taskService.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/common/editorService.ts";
import { NotificationServiceDIToken } from "../../workbench/services/notification/browser/notificationService.ts";
import { TextFileModelServiceDIToken } from "../../workbench/services/textfile/common/textFileModelService.ts";

import { createTestContainer } from "./testProfile.ts";

describe("workbenchModule — the ports of the debug service", () => {
    it("are the workbench's services; without an extension host no extension is activated", async () => {
        const { container } = createTestContainer();
        const createLogger = vi.spyOn(container.get(ILogServiceDIToken), "createLogger");

        const ports = container.get(DebugServicePortsDIToken);

        expect(createLogger).toHaveBeenCalledWith("debug", { label: "Debug" });
        expect(ports.logger).toBe(createLogger.mock.results[0].value);
        expect(ports.contextKeys).toBe(container.get(ContextKeyServiceDIToken));
        expect(ports.state).toBe(container.get(StateServiceDIToken));
        expect(ports.notifications).toBe(container.get(NotificationServiceDIToken));
        expect(ports.workspace).toBe(container.get(IWorkspaceContextServiceDIToken));
        expect(container.get(DebugExtensionActivatorDIToken)).toBe(NO_DEBUG_EXTENSIONS);
        await expect(ports.extensions.activateByEvent("onDebug")).resolves.toBeUndefined();
        await expect(ports.extensions.whenInstalledExtensionsRegistered()).resolves.toBeUndefined();
    });

    it("the activation port asks the activator bound when it is used: the extension host binds its own later", async () => {
        const { container } = createTestContainer();
        const ports = container.get(DebugServicePortsDIToken);
        const activator = {
            activateByEvent: vi.fn(() => Promise.resolve()),
            whenInstalledExtensionsRegistered: vi.fn(() => Promise.resolve()),
            extensions: [],
        };
        container.bind(DebugExtensionActivatorDIToken, () => activator);

        await ports.extensions.activateByEvent("onDebugResolve:lldb");
        await ports.extensions.whenInstalledExtensionsRegistered();
        await ports.configurationManager.extensions.whenInstalledExtensionsRegistered();

        expect(activator.activateByEvent).toHaveBeenCalledWith("onDebugResolve:lldb");
        expect(activator.whenInstalledExtensionsRegistered).toHaveBeenCalledTimes(2);
        expect(ports.configurationManager.extensions.extensions).toBe(activator.extensions);
    });

    it("the active editor's resource is the one of the editor active when it is asked", () => {
        const { container } = createTestContainer();
        const ports = container.get(DebugServicePortsDIToken);
        const active = vi.spyOn(container.get(EditorServiceDIToken), "getActiveEditor");

        active.mockReturnValue(null);
        expect(ports.activeEditorResource()).toBeUndefined();
        active.mockReturnValue({ uri: Uri.file("/w/a.c") } as never);
        expect(ports.activeEditorResource()).toBe(Uri.file("/w/a.c").toString());
    });

    it("launch.json, the debug tasks, saving, Select and Start Debugging and the exit confirmation are wired", async () => {
        const { container } = createTestContainer();
        const ports = container.get(DebugServicePortsDIToken);

        expect(ports.configurationManager.configuration).toBe(container.get(IConfigurationServiceDIToken));
        expect(ports.tasks.tasks).toBe(container.get(TaskServiceDIToken));
        await expect(ports.saveAllBeforeStart()).resolves.toBeUndefined();
        expect(container.get(QuickAccessRegistryDIToken).getProvider("debug run").provider).toBe(
            container.get(DebugQuickAccessProviderDIToken),
        );
        expect(container.get(DebugLifecycleDIToken)).toBeInstanceOf(DebugLifecycle);
    });

    it("a file is dirty while its open model is modified", () => {
        const { container } = createTestContainer();
        const ports = container.get(DebugServicePortsDIToken);
        const uri = Uri.file("/tmp/a.c");
        let modified = true;
        const models = container.get(TextFileModelServiceDIToken);
        const get = models.get.bind(models);
        models.get = (resource) =>
            resource.toString() === uri.toString() ? ({ isModified: modified } as never) : get(resource);

        expect(ports.textFiles.isDirty(uri)).toBe(true);
        modified = false;
        expect(ports.textFiles.isDirty(uri)).toBe(false);
        expect(ports.textFiles.isDirty(Uri.file("/tmp/not-open.c"))).toBe(false);
    });

    it("reads the console settings on every call", async () => {
        const { container } = createTestContainer();
        const ports = container.get(DebugServicePortsDIToken);
        expect(ports.replConfiguration()).toEqual({ collapseIdenticalLines: true, maximumLines: 10000 });

        const configuration = container.get(IConfigurationServiceDIToken);
        await configuration.updateValue("debug.console.collapseIdenticalLines", false);
        await configuration.updateValue("debug.console.maximumLines", 5);

        expect(ports.replConfiguration()).toEqual({ collapseIdenticalLines: false, maximumLines: 5 });
    });
});
