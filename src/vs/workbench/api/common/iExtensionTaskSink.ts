import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type { IWireTask, IWireTaskDefinition, IWireTaskExecution, WireTaskExecuteRequest } from "./taskWireTypes.ts";

/**
 * Жизнь исполнений задач ядра — то, что хост пересказывает субпроцессу
 * (`$onDidStartTask` и соседи эталона): про ВСЕ задачи, в том числе запущенные
 * из палитры.
 */
export interface IExtensionTaskEvents {
    started(execution: IWireTaskExecution, terminalId: number, resolvedDefinition: IWireTaskDefinition): void;
    processStarted(id: string, processId: number): void;
    processEnded(id: string, exitCode: number | undefined): void;
    ended(execution: IWireTaskExecution): void;
}

/**
 * Сток задач расширений (`MainThreadTask` эталона): реализует его мост
 * `contrib/tasks` поверх сервиса задач ядра. Описания задач уже разобраны
 * хостом (`hostWireParsers.ts`).
 */
export interface IExtensionTaskSink {
    subscribe(events: IExtensionTaskEvents): IDisposable;
    /** Провайдер типа `type` расширения `extensionId`; `provide` — запрос субпроцессу. */
    registerProvider(extensionId: string, type: string, provide: () => Promise<readonly IWireTask[]>): IDisposable;
    fetch(type: string | undefined): Promise<IWireTask[]>;
    /** Запустить задачу; ответ — когда она запущена. Нет такой задачи — отказ. */
    execute(request: WireTaskExecuteRequest): Promise<IWireTaskExecution>;
    terminate(id: string): void;
}
