import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type { IWireTask, IWireTaskDefinition, IWireTaskExecution, WireTaskExecuteRequest } from "./taskWireTypes.ts";

/** Про ВСЕ задачи, в том числе запущенные из палитры (`$onDidStartTask` эталона). */
export interface IExtensionTaskEvents {
    started(execution: IWireTaskExecution, terminalId: number, resolvedDefinition: IWireTaskDefinition): void;
    processStarted(id: string, processId: number): void;
    processEnded(id: string, exitCode: number | undefined): void;
    ended(execution: IWireTaskExecution): void;
}

/** `MainThreadTask` эталона; описания задач уже разобраны хостом. */
export interface IExtensionTaskSink {
    subscribe(events: IExtensionTaskEvents): IDisposable;
    registerProvider(extensionId: string, type: string, provide: () => Promise<readonly IWireTask[]>): IDisposable;
    fetch(type: string | undefined): Promise<IWireTask[]>;
    /** Ответ — когда задача запущена; нет такой — отказ. */
    execute(request: WireTaskExecuteRequest): Promise<IWireTaskExecution>;
    terminate(id: string): void;
}
