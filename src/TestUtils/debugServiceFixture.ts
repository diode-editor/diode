// A `DebugService` over in-memory ports: context keys, the workspace store, notifications that record what they
// showed and answer modal questions with `answer`.

import { vi } from "vitest";

import { ContextKeyService } from "../vs/platform/contextkey/common/contextKeyService.ts";
import { NULL_LOGGER } from "../vs/platform/log/common/nullLogService.ts";
import type { IWorkspaceFolder } from "../vs/platform/workspace/common/iWorkspaceContextService.ts";
import { DebugService, type IDebugServicePorts } from "../vs/workbench/contrib/debug/browser/debugService.ts";
import type {
    INotificationHandle,
    INotificationMessage,
} from "../vs/workbench/services/notification/browser/notificationService.ts";

import { DEFAULT_REPL_CONFIGURATION } from "./debugSessionFixture.ts";
import { type MockStateService, mockStateService, NO_DIRTY_FILES } from "./mockDebug.ts";

export interface IDebugServiceFixture {
    readonly service: DebugService;
    readonly contextKeys: ContextKeyService;
    readonly state: MockStateService;
    readonly shown: INotificationMessage[];
    readonly activated: string[];
    /** The answer to the next modal questions: a button index, or `undefined` for closed. */
    answer: number | undefined;
    folders: IWorkspaceFolder[];
}

export function createDebugServiceFixture(): IDebugServiceFixture {
    const contextKeys = new ContextKeyService();
    const state = mockStateService();
    const shown: INotificationMessage[] = [];
    const activated: string[] = [];
    let id = 0;
    const fixture = {
        contextKeys,
        state,
        shown,
        activated,
        answer: undefined as number | undefined,
        folders: [] as IWorkspaceFolder[],
    };
    const ports: IDebugServicePorts = {
        contextKeys,
        state,
        textFiles: NO_DIRTY_FILES,
        logger: NULL_LOGGER,
        notifications: {
            show: vi.fn((message: INotificationMessage): INotificationHandle => {
                shown.push(message);
                return { id: ++id, answered: Promise.resolve(message.modal ? fixture.answer : undefined) };
            }),
        },
        extensions: {
            activateByEvent: (event) => {
                activated.push(event);
                return Promise.resolve();
            },
            whenInstalledExtensionsRegistered: () => {
                activated.push("<registered>");
                return Promise.resolve();
            },
        },
        workspace: { getWorkspace: () => ({ id: "w" as never, folders: fixture.folders }) },
        replConfiguration: () => DEFAULT_REPL_CONFIGURATION,
    };
    return Object.assign(fixture, { service: new DebugService(ports) });
}
