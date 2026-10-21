import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { HostRpc } from "../../../api/common/extHostProtocol.ts";

/** Lives exactly until the spawn dies or the app shuts down. */
export interface IExtensionHostContext {
    readonly rpc: HostRpc;
    readonly logger: ILogger | undefined;
}

/**
 * Like upstream `mainThread*`. {@link attach} is called on every spawn before the child's first
 * message; all per-spawn state is set up inside and torn down by the returned disposable.
 */
export interface IExtensionHostCustomer {
    attach(ctx: IExtensionHostContext): IDisposable;
}
