import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type { IWireTask, IWireTaskDefinition, IWireTaskExecution, WireTaskExecuteRequest } from "./taskWireTypes.ts";

/** About ALL tasks, including ones started from the palette (upstream `$onDidStartTask`). */
export interface IExtensionTaskEvents {
    started(execution: IWireTaskExecution, terminalId: number, resolvedDefinition: IWireTaskDefinition): void;
    processStarted(id: string, processId: number): void;
    processEnded(id: string, exitCode: number | undefined): void;
    ended(execution: IWireTaskExecution): void;
}

/** Upstream `MainThreadTask`; task definitions are already parsed by the host. */
export interface IExtensionTaskSink {
    subscribe(events: IExtensionTaskEvents): IDisposable;
    registerProvider(extensionId: string, type: string, provide: () => Promise<readonly IWireTask[]>): IDisposable;
    fetch(type: string | undefined): Promise<IWireTask[]>;
    /** Resolves once the task has started; rejects if there is no such task. */
    execute(request: WireTaskExecuteRequest): Promise<IWireTaskExecution>;
    terminate(id: string): void;
}
