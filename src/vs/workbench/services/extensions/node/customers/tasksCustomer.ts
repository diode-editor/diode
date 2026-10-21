import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { IExtensionTaskSink } from "../../../../api/common/iExtensionTaskSink.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import {
    parseWireTaskExecuteRequest,
    parseWireTaskExecutionId,
    parseWireTaskFilter,
    parseWireTaskProviderHandle,
    parseWireTaskProviderRegistration,
    parseWireTasksFromSubprocess,
} from "../hostWireParsers.ts";

/**
 * `MainThreadTask` эталона. Субпроцессу пересказываются все исполнения задач ядра,
 * в том числе запущенные из палитры. Регистрации провайдеров принадлежат спавну.
 */
export class TasksCustomer implements IExtensionHostCustomer {
    public constructor(private readonly sink: IExtensionTaskSink | undefined) {}

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const store = new DisposableStore();
        const sink = this.sink;
        if (sink === undefined) {
            store.add(rpc.handleRequest("tasks.fetch", () => []));
            store.add(
                rpc.handleRequest("tasks.execute", () =>
                    Promise.reject(new Error("Tasks are not supported in this host.")),
                ),
            );
            return store;
        }
        const providers = new Map<number, IDisposable>();
        store.add({
            dispose: () => {
                for (const registration of providers.values()) registration.dispose();
            },
        });

        store.add(
            sink.subscribe({
                started: (execution, terminalId, resolvedDefinition) => {
                    rpc.notify("tasks.didStart", { execution, terminalId, resolvedDefinition });
                },
                processStarted: (id, processId) => {
                    rpc.notify("tasks.didStartProcess", { id, processId });
                },
                processEnded: (id, exitCode) => {
                    // Stryker disable next-line ConditionalExpression: эквивалентный — JSON-провод сам роняет ключ со значением undefined; ветка — для типа сообщения
                    rpc.notify("tasks.didEndProcess", { id, ...(exitCode !== undefined ? { exitCode } : {}) });
                },
                ended: (execution) => {
                    rpc.notify("tasks.didEnd", { execution });
                },
            }),
        );

        store.add(
            rpc.handleNotification("tasks.registerProvider", (params) => {
                const registration = parseWireTaskProviderRegistration(params);
                if (registration === null) return;
                const { handle, type, extensionId } = registration;
                providers.get(handle)?.dispose();
                providers.set(
                    handle,
                    sink.registerProvider(extensionId, type, async () =>
                        parseWireTasksFromSubprocess(await rpc.request("tasks.provideTasks", { handle })),
                    ),
                );
            }),
        );
        store.add(
            rpc.handleNotification("tasks.unregisterProvider", (params) => {
                const request = parseWireTaskProviderHandle(params);
                if (request === null) return;
                providers.get(request.handle)?.dispose();
                providers.delete(request.handle);
            }),
        );
        store.add(rpc.handleRequest("tasks.fetch", (params) => sink.fetch(parseWireTaskFilter(params).type)));
        store.add(
            rpc.handleRequest("tasks.execute", (params) => {
                const request = parseWireTaskExecuteRequest(params);
                if (request === null) return Promise.reject(new Error("Task is not valid"));
                return sink.execute(request);
            }),
        );
        store.add(
            rpc.handleNotification("tasks.terminate", (params) => {
                const request = parseWireTaskExecutionId(params);
                if (request !== null) sink.terminate(request.id);
            }),
        );
        return store;
    }
}
