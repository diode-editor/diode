import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { IWorkspaceFoldersSink } from "../../../../api/common/iWorkspaceFoldersSink.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import { parseWireUpdateWorkspaceFolders } from "../hostWireParsers.ts";

/** upstream `MainThreadWorkspace.$updateWorkspaceFolders`. */
export class WorkspaceFoldersCustomer implements IExtensionHostCustomer {
    public constructor(private readonly sink: IWorkspaceFoldersSink | undefined) {}

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const store = new DisposableStore();
        store.add(
            rpc.handleNotification("workspace.updateWorkspaceFolders", (params) => {
                const request = parseWireUpdateWorkspaceFolders(params);
                // Stryker disable next-line ConditionalExpression: без проверки null падает на полях запроса — RpcEndpoint глотает исключение нотификации, наблюдаемо то же «проигнорировано»
                if (request === null) return;
                this.sink?.update(request);
            }),
        );
        return store;
    }
}
