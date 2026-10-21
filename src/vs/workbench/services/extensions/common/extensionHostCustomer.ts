import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { HostRpc } from "../../../api/common/extHostProtocol.ts";

/** Живёт ровно до смерти спавна или выключения. */
export interface IExtensionHostContext {
    readonly rpc: HostRpc;
    readonly logger: ILogger | undefined;
}

/**
 * Как `mainThread*` upstream. {@link attach} зовётся на каждый спавн до первого сообщения
 * ребёнка; всё состояние спавна заводится внутри и снимается возвращённым disposable.
 */
export interface IExtensionHostCustomer {
    attach(ctx: IExtensionHostContext): IDisposable;
}
