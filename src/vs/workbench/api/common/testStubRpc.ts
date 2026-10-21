import { CancellationTokenNone, type ICancellationToken } from "../../../base/common/cancellation.ts";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import type { IRequestHandler } from "./rpcEndpoint.ts";

export interface IStubRpc {
    readonly rpc: SubprocessRpc;
    fire(method: string, params: unknown): void;
    /** `token` defaults to a non-cancellable one. */
    callRequest(method: string, params: unknown, token?: ICancellationToken): Promise<unknown>;
    readonly requests: { method: string; params: unknown }[];
    readonly notifies: { method: string; params: unknown }[];
    /** Replies `undefined` by default. */
    responder: ((method: string, params: unknown) => unknown) | null;
}

export function makeStubRpc(): IStubRpc {
    const handlers = new Map<string, (params: unknown) => void>();
    const requestHandlers = new Map<string, IRequestHandler>();
    const requests: { method: string; params: unknown }[] = [];
    const notifies: { method: string; params: unknown }[] = [];
    const rpc = {
        handleNotification: (method: string, handler: (params: unknown) => void) => {
            handlers.set(method, handler);
            return { dispose: () => handlers.delete(method) };
        },
        handleRequest: (method: string, handler: IRequestHandler) => {
            requestHandlers.set(method, handler);
            return { dispose: () => requestHandlers.delete(method) };
        },
        request: (method: string, params: unknown) => {
            requests.push({ method, params });
            return Promise.resolve(stub.responder?.(method, params));
        },
        notify: (method: string, params: unknown) => {
            notifies.push({ method, params });
        },
        dispose: () => undefined,
    } as unknown as SubprocessRpc;

    const stub: IStubRpc = {
        rpc,
        responder: null,
        fire: (method, params) => {
            const handler = handlers.get(method);
            if (handler === undefined) throw new Error(`no handler for "${method}"`);
            handler(params);
        },
        callRequest: (method, params, token = CancellationTokenNone) => {
            const handler = requestHandlers.get(method);
            if (handler === undefined) throw new Error(`no request handler for "${method}"`);
            return Promise.resolve(handler(params, token));
        },
        requests,
        notifies,
    };
    return stub;
}
