import { Emitter } from "../../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type {
    IFileIndexRequest,
    IFileIndexResult,
    IFileQueryRequest,
    IFileQueryResult,
    IFileSearchProvider,
} from "../../../search/common/fileSearch.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import { parseWireFileIndexResult, parseWireFileQueryResult } from "../hostWireParsers.ts";

/**
 * Upstream `MainThreadSearch` for the internal file search provider. A request starts the subprocess
 * when it is not up yet: Quick Open must not wait for some extension to activate first.
 */
export class SearchCustomer extends Disposable implements IExtensionHostCustomer, IFileSearchProvider {
    private live: HostRpc | null = null;
    private readonly onDidChangeIndexEmitter = this.register(new Emitter<string>());
    public readonly onDidChangeIndex = this.onDidChangeIndexEmitter.event;

    public constructor(private readonly ensureSubprocess: () => Promise<HostRpc>) {
        super();
    }

    public async index(request: IFileIndexRequest): Promise<IFileIndexResult> {
        const rpc = await this.ensureSubprocess();
        return parseWireFileIndexResult(await rpc.request("search.fileIndex", request));
    }

    public async query(request: IFileQueryRequest): Promise<IFileQueryResult> {
        const rpc = await this.ensureSubprocess();
        return parseWireFileQueryResult(await rpc.request("search.fileQuery", request));
    }

    /** A dead subprocess took the index with it: nothing to clear. */
    public clearCache(cacheKey: string): void {
        this.live?.notify("search.clearCache", { cacheKey });
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        this.live = rpc;
        // A key nobody asked for matches no session: nothing to guard against.
        const subscription = rpc.handleNotification("search.fileIndexChanged", (params) => {
            this.onDidChangeIndexEmitter.fire(params.cacheKey);
        });
        return {
            dispose: () => {
                subscription.dispose();
                if (this.live === rpc) this.live = null;
            },
        };
    }
}
