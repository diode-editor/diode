import { vi } from "vitest";

import { MarkerService } from "../vs/platform/markers/common/markerService.ts";
import { makeViewsHarness } from "../vs/workbench/browser/parts/views/viewsService.testUtils.ts";
import { PROBLEMS_VIEW_ID } from "../vs/workbench/contrib/markers/browser/problemsComponent.ts";
import { type ITaskEvent, TerminalTaskSystem } from "../vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts";
import type { ITaskVariableContext } from "../vs/workbench/contrib/tasks/common/taskVariables.ts";
import { TerminalService } from "../vs/workbench/contrib/terminal/browser/terminalService.ts";
import type { ITerminalSessionOptions } from "../vs/workbench/contrib/terminal/common/terminalSessionFactory.ts";

import { FakeEditorTerminals } from "./FakeEditorTerminals.ts";
import { FakeTerminalSurface } from "./FakeTerminalSurface.ts";
import { taskVariables } from "./taskFixtures.ts";
import { createTestConfigurationService } from "./testConfigurationService.ts";

export function buildTerminalTaskSystemHarness() {
    const views = makeViewsHarness();
    const sessions: FakeTerminalSurface[] = [];
    const factoryCalls: ITerminalSessionOptions[] = [];
    let nextPid = 100;
    const terminals = new TerminalService(views.service, createTestConfigurationService({}), (options) => {
        factoryCalls.push(options);
        const session = new FakeTerminalSurface(options.shell ?? "/bin/sh", nextPid++);
        sessions.push(session);
        return session;
    });
    // A neighbor panel tab, for "panel visible, but not on the terminal".
    views.service.registerContainer({ id: "other", title: "OTHER", location: "panel", order: 1 });
    views.service.registerView({
        id: "other",
        containerId: "other",
        title: "OTHER",
        order: 1,
        body: null,
        placeholder: "",
        focus: () => undefined,
    });
    // Stands in for the Problems panel that `revealProblems` opens.
    views.service.registerContainer({ id: PROBLEMS_VIEW_ID, title: "PROBLEMS", location: "panel", order: 3 });
    views.service.registerView({
        id: PROBLEMS_VIEW_ID,
        containerId: PROBLEMS_VIEW_ID,
        title: "PROBLEMS",
        order: 1,
        body: null,
        placeholder: "",
        focus: () => undefined,
    });
    views.service.attachRegisteredContainers();
    const editorTerminals = new FakeEditorTerminals(terminals);
    const markers = new MarkerService();
    const openResources = new Set<string>();
    const warnings: string[] = [];
    const listedDirectories: string[] = [];
    const system = new TerminalTaskSystem(terminals, views.service, () => "/bin/bash", editorTerminals, {
        markers,
        isOpen: (resource) => openResources.has(resource),
        files: {
            exists: () => Promise.resolve(false),
            resolve: (uri) => {
                listedDirectories.push(uri.fsPath);
                return Promise.reject(new Error("no fs"));
            },
        },
        warn: (message) => warnings.push(message),
    });
    const events: string[] = [];
    const raw: ITaskEvent[] = [];
    system.onDidStateChange((event) => {
        raw.push(event);
        events.push(describeTaskEvent(event));
    });
    const focus = vi.fn();
    terminals.onDidRequestFocus(focus);
    let variables = taskVariables();
    const context = () => ({ variables, platform: "linux" as const });
    const setVariables = (overrides: Partial<ITaskVariableContext>): void => {
        variables = taskVariables(overrides);
    };
    const dispose = (): void => {
        system.dispose();
        terminals.dispose();
    };
    return {
        views,
        markers,
        openResources,
        warnings,
        listedDirectories,
        terminals,
        editorTerminals,
        sessions,
        factoryCalls,
        system,
        events,
        raw,
        focus,
        context,
        setVariables,
        dispose,
    };
}

export function describeTaskEvent(event: ITaskEvent): string {
    switch (event.kind) {
        case "changed":
            return "changed";
        case "processStarted":
            return `processStarted:${event.task.name}:${String(event.processId)}`;
        case "processEnded":
            return `processEnded:${event.task.name}:${String(event.exitCode)}`;
        case "terminated":
            return `terminated:${event.task.name}:${event.exitReason}`;
        default:
            return `${event.kind}:${event.task.name}:${String(event.terminalId)}`;
    }
}
