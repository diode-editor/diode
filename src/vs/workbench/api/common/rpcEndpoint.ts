import type { IDisposable } from "@tuidom/core/common/disposable";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";

import type { IMessageChannel } from "./iMessageChannel.ts";

/**
 * Конверты сообщений host↔extension. Кастомный формат (без полного JSON-RPC):
 * минимум, нужный для request/response + notifications.
 */
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
    readonly error?: { readonly message: string };
}

export interface INotificationMessage {
    readonly kind: "notif";
    readonly method: string;
    readonly params: unknown;
}

export type IProtocolMessage = IRequestMessage | IResponseMessage | INotificationMessage;

export type IRequestHandler = (params: unknown) => unknown;
export type INotificationHandler = (params: unknown) => void;

/**
 * Тонкая обёртка поверх {@link IMessageChannel}, реализующая request/response
 * и notification поверх канального транспорта. Симметрична — оба конца
 * (host и runtime) используют один и тот же класс.
 */
export class RpcEndpoint implements IDisposable {
    private readonly channel: IMessageChannel;
    private readonly logger: ILogger | undefined;
    private readonly channelSubscription: IDisposable;
    private readonly pendingRequests = new Map<
        number,
        { resolve: (value: unknown) => void; reject: (reason: Error) => void }
    >();
    private readonly requestHandlers = new Map<string, IRequestHandler>();
    private readonly notificationHandlers = new Map<string, INotificationHandler>();
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

    public request(method: string, params?: unknown): Promise<unknown> {
        if (this.disposed) {
            return Promise.reject(new Error(`RpcEndpoint disposed; cannot request "${method}"`));
        }
        const id = this.nextRequestId++;
        return new Promise<unknown>((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            const msg: IRequestMessage = { kind: "req", id, method, params };
            this.logger?.trace(`-> req#${String(id)} ${method}`, params);
            this.channel.postMessage(msg);
        });
    }

    public notify(method: string, params?: unknown): void {
        if (this.disposed) return;
        const msg: INotificationMessage = { kind: "notif", method, params };
        this.logger?.trace(`-> notif ${method}`, params);
        this.channel.postMessage(msg);
    }

    public handleRequest(method: string, handler: IRequestHandler): IDisposable {
        this.requestHandlers.set(method, handler);
        return {
            dispose: (): void => {
                if (this.requestHandlers.get(method) === handler) {
                    this.requestHandlers.delete(method);
                }
            },
        };
    }

    public handleNotification(method: string, handler: INotificationHandler): IDisposable {
        this.notificationHandlers.set(method, handler);
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
            pending.reject(new Error("RpcEndpoint disposed"));
        }
        this.pendingRequests.clear();
        this.requestHandlers.clear();
        this.notificationHandlers.clear();
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
                error: { message: `No handler for method "${message.method}"` },
            };
            this.logger?.warn(`no handler for req#${String(message.id)} ${message.method}`);
            this.channel.postMessage(response);
            return;
        }
        Promise.resolve()
            .then(() => handler(message.params))
            .then(
                (result) => {
                    if (this.disposed) return;
                    const response: IResponseMessage = { kind: "res", id: message.id, result };
                    this.logger?.trace(`-> res#${String(message.id)} ${message.method}`, result);
                    this.channel.postMessage(response);
                },
                (reason: unknown) => {
                    if (this.disposed) return;
                    const errMessage = reason instanceof Error ? reason.message : String(reason);
                    const response: IResponseMessage = {
                        kind: "res",
                        id: message.id,
                        error: { message: errMessage },
                    };
                    this.logger?.warn(`-> res#${String(message.id)} ${message.method} ERROR: ${errMessage}`);
                    this.channel.postMessage(response);
                },
            );
    }

    private handleResponseMessage(message: IResponseMessage): void {
        const pending = this.pendingRequests.get(message.id);
        if (pending === undefined) return;
        this.pendingRequests.delete(message.id);
        if (message.error !== undefined) {
            pending.reject(new Error(message.error.message));
        } else {
            pending.resolve(message.result);
        }
    }

    private handleNotificationMessage(message: INotificationMessage): void {
        const handler = this.notificationHandlers.get(message.method);
        if (handler === undefined) return;
        try {
            handler(message.params);
        } catch (err) {
            // Notifications не имеют ответа — глотаем исключения молча
            // (в Phase 1 изоляция упрощённая).
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
