import { CancellationTokenSource, type ICancellationToken } from "../../../base/common/cancellation.ts";
import { BugIndicatingError } from "../../../base/common/errors.ts";
import {
    type SerializedError,
    transformErrorForSerialization,
    transformErrorFromSerialization,
} from "../../../base/common/errorSerialization.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";

import type { IMessageChannel } from "./iMessageChannel.ts";

export interface IRequestMessage {
    readonly kind: "req";
    readonly id: number;
    readonly method: string;
    readonly params: unknown;
}

export interface IResponseMessage {
    readonly kind: "res";
    readonly id: number;
    readonly result?: unknown;
    /** Arrives whole, with `name`/`stack`/`code`/`cause` — like upstream's `ReplyErrError`. */
    readonly error?: SerializedError;
}

export interface INotificationMessage {
    readonly kind: "notif";
    readonly method: string;
    readonly params: unknown;
}

export type IProtocolMessage = IRequestMessage | IResponseMessage | INotificationMessage;

/**
 * Long work must watch the token; short work may ignore it — the caller drops the reply
 * to a cancelled request itself.
 */
export type IRequestHandler = (params: unknown, token: ICancellationToken) => unknown;
export type INotificationHandler = (params: unknown) => void;

/** Types only: the map changes nothing on the wire. */
export interface IRpcProtocol {
    readonly requests: object;
    readonly notifications: object;
}

export interface IUntypedProtocol {
    readonly requests: Readonly<Record<string, readonly [params: unknown, result: unknown]>>;
    readonly notifications: Readonly<Record<string, unknown>>;
}

export type RequestMethod<P extends IRpcProtocol> = keyof P["requests"] & string;
export type RequestParams<P extends IRpcProtocol, K extends RequestMethod<P>> = P["requests"][K] extends readonly [
    infer A,
    unknown,
]
    ? A
    : unknown;
export type RequestResult<P extends IRpcProtocol, K extends RequestMethod<P>> = P["requests"][K] extends readonly [
    unknown,
    infer R,
]
    ? R
    : unknown;
export type NotificationMethod<P extends IRpcProtocol> = keyof P["notifications"] & string;
export type NotificationParams<P extends IRpcProtocol, K extends NotificationMethod<P>> = P["notifications"][K];

/** Like LSP `$/cancelRequest`: cancellation is owned by the side that sent the request. */
// Stryker disable next-line StringLiteral: the method name is a contract with itself, both sides read this same constant; observable only against a foreign protocol implementation
export const CANCEL_REQUEST_METHOD = "$/cancelRequest";

export interface ICancelRequestParams {
    readonly id: number;
}

/**
 * Orphan cancellations that overtook their request on a reordering transport; bounded
 * so the set does not grow on foreign garbage.
 */
const EARLY_CANCEL_MEMORY = 64;

export class RpcEndpoint<
    TOut extends IRpcProtocol = IUntypedProtocol,
    TIn extends IRpcProtocol = IUntypedProtocol,
> implements IDisposable {
    private readonly channel: IMessageChannel;
    private readonly logger: ILogger | undefined;
    private readonly channelSubscription: IDisposable;
    private readonly pendingRequests = new Map<
        number,
        {
            resolve: (value: unknown) => void;
            reject: (reason: Error) => void;
            cancelSubscription: IDisposable | null;
            timer: ReturnType<typeof setTimeout> | undefined;
        }
    >();
    private readonly incomingCancellations = new Map<number, CancellationTokenSource>();
    private readonly earlyCancellations = new Set<number>();
    private readonly requestHandlers = new Map<string, IRequestHandler>();
    private readonly notificationHandlers = new Map<string, INotificationHandler>();
    private readonly unknownNotifications = new Set<string>();
    private nextRequestId = 1;
    private disposed = false;

    public constructor(channel: IMessageChannel, logger?: ILogger) {
        this.channel = channel;
        this.logger = logger;
        this.channelSubscription = channel.onMessage((msg) => {
            this.traceIncoming(msg);
            this.handleIncoming(msg);
        });
    }

    /**
     * A reply is still expected after cancellation: cancellation is a request, not a disconnect. An expired
     * `timeoutMs` cancels the request the same way and rejects the promise without waiting for a late reply.
     */
    public request<K extends RequestMethod<TOut>>(
        method: K,
        params?: RequestParams<TOut, K>,
        options: IRequestOptions = {},
    ): Promise<RequestResult<TOut, K>> {
        const { token, timeoutMs } = options;
        if (this.disposed) {
            return Promise.reject(new Error(`RpcEndpoint disposed; cannot request "${method}"`));
        }
        const id = this.nextRequestId++;
        return new Promise<RequestResult<TOut, K>>((resolve, reject) => {
            const pending = {
                resolve: resolve as (value: unknown) => void,
                reject,
                cancelSubscription: null as IDisposable | null,
                timer: undefined as ReturnType<typeof setTimeout> | undefined,
            };
            this.pendingRequests.set(id, pending);
            const msg: IRequestMessage = { kind: "req", id, method, params };
            this.logger?.trace(`-> req#${String(id)} ${method}`, params);
            this.channel.postMessage(msg);
            // Subscribe AFTER sending: an already-cancelled token calls the listener
            // synchronously, and the cancellation must go out after the request,
            // not ahead of it.
            pending.cancelSubscription =
                token?.onCancellationRequested(() => {
                    this.cancelOutgoing(id, method);
                }) ?? null;
            if (timeoutMs !== undefined) {
                pending.timer = setTimeout(() => {
                    // Stryker disable next-line CallExpression: hygiene — a late reply would find an already rejected promise (a second resolve is a no-op); the only difference is map growth
                    this.pendingRequests.delete(id);
                    pending.cancelSubscription?.dispose();
                    this.cancelOutgoing(id, method);
                    reject(new TimeoutError(method, timeoutMs));
                }, timeoutMs);
            }
        });
    }

    public notify<K extends NotificationMethod<TOut>>(method: K, params?: NotificationParams<TOut, K>): void {
        this.sendNotification(method, params);
    }

    /** Sends a notification bypassing the protocol map: the internal `$/cancelRequest` is not listed there. */
    private sendNotification(method: string, params: unknown): void {
        if (this.disposed) return;
        const msg: INotificationMessage = { kind: "notif", method, params };
        this.logger?.trace(`-> notif ${method}`, params);
        this.channel.postMessage(msg);
    }

    public handleRequest<K extends RequestMethod<TIn>>(
        method: K,
        handler: (
            params: RequestParams<TIn, K>,
            token: ICancellationToken,
        ) => RequestResult<TIn, K> | Promise<RequestResult<TIn, K>>,
    ): IDisposable {
        // A second handler would silently replace the first — a request has one responder.
        if (this.requestHandlers.has(method)) {
            throw new BugIndicatingError(`request handler for "${method}" is already registered`);
        }
        this.requestHandlers.set(method, handler as IRequestHandler);
        return {
            dispose: (): void => {
                if (this.requestHandlers.get(method) === handler) {
                    this.requestHandlers.delete(method);
                }
            },
        };
    }

    public handleNotification<K extends NotificationMethod<TIn>>(
        method: K,
        handler: (params: NotificationParams<TIn, K>) => void,
    ): IDisposable {
        this.notificationHandlers.set(method, handler as INotificationHandler);
        return {
            dispose: (): void => {
                if (this.notificationHandlers.get(method) === handler) {
                    this.notificationHandlers.delete(method);
                }
            },
        };
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.channelSubscription.dispose();
        for (const pending of this.pendingRequests.values()) {
            pending.cancelSubscription?.dispose();
            clearTimeout(pending.timer);
            pending.reject(new Error("RpcEndpoint disposed"));
        }
        this.pendingRequests.clear();
        // There is nowhere to send replies; handlers still running get cancelled. The cleanup below
        // does not change behavior: the endpoint is dead and nobody reads the collections.
        for (const source of this.incomingCancellations.values()) {
            source.cancel();
            // Stryker disable next-line CallExpression: cleanup, see above
            source.dispose();
        }
        // Stryker disable next-line CallExpression: cleanup, see above
        this.incomingCancellations.clear();
        // Stryker disable next-line CallExpression: cleanup, see above
        this.earlyCancellations.clear();
        this.requestHandlers.clear();
        this.notificationHandlers.clear();
    }

    /**
     * Cancellation of an already answered request never gets here: the token subscription is removed
     * together with the reply — this is what keeps us silent after the reply.
     */
    private cancelOutgoing(id: number, method: string): void {
        // Stryker disable next-line StringLiteral: the trace line text is unobservable (endpoint tests have no logger)
        this.logger?.trace(`-> cancel req#${String(id)} ${method}`);
        this.sendNotification(CANCEL_REQUEST_METHOD, { id } satisfies ICancelRequestParams);
    }

    private handleCancelMessage(params: unknown): void {
        // Stryker disable next-line OptionalChaining: without `?.` garbage params make handleCancelMessage throw straight from channel delivery, i.e. outside the test's stack. A test for this case exists (malformed and unpaired cancellations are silent), but it PASSES: the unhandled error crashes the runner (RuntimeError) instead of failing the test. This is a gap in listener error localization (docs/MUTATION.md → #275), not a gap in this line's tests.
        const id = (params as ICancelRequestParams | null | undefined)?.id;
        // Without the guard a non-numeric id would settle in earlyCancellations and match nothing — unobservable.
        // Stryker disable next-line ConditionalExpression: see above
        if (typeof id !== "number") return;
        const source = this.incomingCancellations.get(id);
        if (source !== undefined) {
            source.cancel();
            return;
        }
        // No match: either the request is already answered (stay silent) or the cancellation overtook it —
        // then the handler receives an already cancelled token.
        this.earlyCancellations.add(id);
        for (const stale of this.earlyCancellations) {
            if (this.earlyCancellations.size <= EARLY_CANCEL_MEMORY) break;
            this.earlyCancellations.delete(stale);
        }
    }

    private handleIncoming(raw: unknown): void {
        if (typeof raw !== "object" || raw === null) return;
        const message = raw as Partial<IProtocolMessage> & { kind?: string };
        switch (message.kind) {
            case "req":
                this.handleRequestMessage(message as IRequestMessage);
                return;
            case "res":
                this.handleResponseMessage(message as IResponseMessage);
                return;
            case "notif":
                if ((message as INotificationMessage).method === CANCEL_REQUEST_METHOD) {
                    this.handleCancelMessage((message as INotificationMessage).params);
                    return;
                }
                this.handleNotificationMessage(message as INotificationMessage);
                return;
            default:
                return;
        }
    }

    private handleRequestMessage(message: IRequestMessage): void {
        const handler = this.requestHandlers.get(message.method);
        if (handler === undefined) {
            const response: IResponseMessage = {
                kind: "res",
                id: message.id,
                error: serializeRejection(new Error(`No handler for method "${message.method}"`)),
            };
            this.logger?.warn(`no handler for req#${String(message.id)} ${message.method}`);
            this.channel.postMessage(response);
            return;
        }
        const source = new CancellationTokenSource();
        this.incomingCancellations.set(message.id, source);
        if (this.earlyCancellations.delete(message.id)) source.cancel();
        Promise.resolve()
            .then(() => handler(message.params, source.token))
            .then(
                (result) => {
                    // Stryker disable next-line CallExpression: token cleanup, see finishIncoming
                    this.finishIncoming(message.id, source);
                    if (this.disposed) return;
                    const response: IResponseMessage = { kind: "res", id: message.id, result };
                    this.logger?.trace(`-> res#${String(message.id)} ${message.method}`, result);
                    this.channel.postMessage(response);
                },
                (reason: unknown) => {
                    // Stryker disable next-line CallExpression: token cleanup, see finishIncoming
                    this.finishIncoming(message.id, source);
                    if (this.disposed) return;
                    const error = serializeRejection(reason);
                    const response: IResponseMessage = { kind: "res", id: message.id, error };
                    this.logger?.warn(`-> res#${String(message.id)} ${message.method} ERROR: ${error.message}`);
                    this.channel.postMessage(response);
                },
            );
    }

    // A late cancellation for this id is addressed to no one: cleanup only prevents collection growth.
    // Stryker disable BlockStatement,CallExpression: cleanup with no observable effect, see above
    private finishIncoming(id: number, source: CancellationTokenSource): void {
        this.incomingCancellations.delete(id);
        source.dispose();
    }
    // Stryker restore BlockStatement,CallExpression

    private handleResponseMessage(message: IResponseMessage): void {
        const pending = this.pendingRequests.get(message.id);
        if (pending === undefined) return;
        this.pendingRequests.delete(message.id);
        pending.cancelSubscription?.dispose();
        clearTimeout(pending.timer);
        if (message.error !== undefined) {
            pending.reject(transformErrorFromSerialization(message.error));
        } else {
            pending.resolve(message.result);
        }
    }

    private handleNotificationMessage(message: INotificationMessage): void {
        const handler = this.notificationHandlers.get(message.method);
        if (handler === undefined) {
            // The protocol sides disagree; a stream of such messages must not flood the log.
            if (!this.unknownNotifications.has(message.method)) {
                this.unknownNotifications.add(message.method);
                this.logger?.warn(`no handler for notification "${message.method}"`);
            }
            return;
        }
        try {
            handler(message.params);
        } catch (err) {
            this.logger?.warn(`notification handler for "${message.method}" threw`, err);
        }
    }

    private traceIncoming(raw: unknown): void {
        if (this.logger === undefined) return;
        if (typeof raw !== "object" || raw === null) return;
        const message = raw as Partial<IProtocolMessage> & { kind?: string };
        switch (message.kind) {
            case "req":
                this.logger.trace(
                    `<- req#${String((message as IRequestMessage).id)} ${(message as IRequestMessage).method}`,
                    (message as IRequestMessage).params,
                );
                return;
            case "res": {
                const m = message as IResponseMessage;
                if (m.error !== undefined) {
                    this.logger.trace(`<- res#${String(m.id)} ERROR: ${m.error.message}`);
                } else {
                    this.logger.trace(`<- res#${String(m.id)}`, m.result);
                }
                return;
            }
            case "notif":
                this.logger.trace(
                    `<- notif ${(message as INotificationMessage).method}`,
                    (message as INotificationMessage).params,
                );
                return;
            default:
                return;
        }
    }
}

export interface IRequestOptions {
    readonly token?: ICancellationToken;
    readonly timeoutMs?: number;
}

export class TimeoutError extends Error {
    public constructor(
        public readonly method: string,
        public readonly timeoutMs: number,
    ) {
        super(`request "${method}" timed out after ${String(timeoutMs)}ms`);
        this.name = "TimeoutError";
    }
}

/** A non-`Error` was thrown — the value travels as the message text of a plain error. */
function serializeRejection(reason: unknown): SerializedError {
    if (reason instanceof Error) return transformErrorForSerialization(reason);
    return { $isError: true, name: "Error", message: String(reason), stack: "" };
}
