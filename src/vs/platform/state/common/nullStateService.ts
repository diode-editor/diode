import { Event } from "../../../base/common/event.ts";
import type { WorkspaceId } from "../../workspace/common/iWorkspaceContextService.ts";

import type { IStateDescriptor, IStateService } from "./iStateService.ts";

export const NULL_STATE_SERVICE: IStateService = {
    get<T>(descriptor: IStateDescriptor<T>): T {
        return descriptor.default;
    },
    store<T>(_descriptor: IStateDescriptor<T>, _value: T): void {
        /* no-op */
    },
    remove<T>(_descriptor: IStateDescriptor<T>): void {
        /* no-op */
    },
    openWorkspace(_workspaceId: WorkspaceId): void {
        /* no-op */
    },
    flushSync(): void {
        /* no-op */
    },
    dispose(): void {
        /* no-op */
    },
    onDidOpenWorkspace: Event.None,
};
