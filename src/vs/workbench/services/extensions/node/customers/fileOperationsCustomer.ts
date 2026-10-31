import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type {
    IWireFileOperationEvent,
    IWireFileOperationParams,
    IWireWorkspaceEditOp,
} from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import { parseWireApplyWorkspaceEditParams } from "../hostWireParsers.ts";
import { loggingRequest } from "../requestPolicy.ts";

interface ISpawnFileOperations {
    readonly rpc: HostRpc;
    willSubscribed: boolean;
}

/** No "will" listener or no subprocess: nothing to wait for, a stuck host doesn't hold up a rename. */
export class FileOperationsCustomer implements IExtensionHostCustomer {
    private live: ISpawnFileOperations | null = null;

    public constructor(private readonly logger: ILogger | undefined) {}

    public pushInitialState(): void {
        /* the subprocess starts without listeners */
    }

    /** A timeout or an RPC failure is "no edits": the operation goes on. */
    public async willRunFileOperation(params: IWireFileOperationParams): Promise<readonly IWireWorkspaceEditOp[]> {
        const live = this.live;
        if (!live?.willSubscribed) return [];
        const ops = await loggingRequest(live.rpc, this.logger)("workspace.willRunFileOperation", params, {
            timeoutMs: params.timeoutMs,
        }).catch(() => []);
        return parseWireApplyWorkspaceEditParams({ ops }) ?? [];
    }

    public didRunFileOperation(event: IWireFileOperationEvent): void {
        this.live?.rpc.notify("workspace.didRunFileOperation", event);
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const live: ISpawnFileOperations = { rpc, willSubscribed: false };
        this.live = live;
        const store = new DisposableStore();
        store.add(
            rpc.handleNotification("workspace.updateFileOperationSubscriptions", (params) => {
                live.willSubscribed = params.will;
            }),
        );
        store.add({
            dispose: () => {
                this.live = null;
            },
        });
        return store;
    }
}
