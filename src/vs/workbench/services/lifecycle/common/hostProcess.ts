import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/** Without a request the window comes back with the same profile and arguments; a workspace replaces the positional arguments. */
export interface IRelaunchRequest {
    readonly profile?: string | undefined;
    readonly workspace?: string | undefined;
}

/** How shutdown ends; by the time it is called, participants have already released their resources. */
export interface IHostProcess {
    exit(): void;
    restart(relaunch?: IRelaunchRequest): void;
}

export const HostProcessDIToken = token<IHostProcess>("HostProcess");
