import { Emitter } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";

import type { IMessageChannel } from "./iMessageChannel.ts";
import { jsonImage, summarizeMessage } from "./messageChannelFallback.ts";

/** Intersection of `NodeJS.Process` and `ChildProcess`: works on both sides of IPC. */
export interface IIpcEndpoint {
    /** `false` once the IPC channel is closed: distinguishes a dead channel from a bad payload when `send` throws. */
    readonly connected: boolean;
    send(message: unknown): boolean;
    on(event: "message", listener: (msg: unknown) => void): unknown;
    on(event: "disconnect", listener: () => void): unknown;
    off(event: "message", listener: (msg: unknown) => void): unknown;
    off(event: "disconnect", listener: () => void): unknown;
}

/**
 * The endpoint is expected to run Node's `serialization: "advanced"` (structured clone via `v8.serialize`):
 * a 13 MB document sync costs ~10 ms of the main thread instead of ~55 with JSON. Structured clone rejects
 * what JSON silently dropped (functions, symbols, proxies, promises) by throwing from `send()`; such a message
 * is sent again as its JSON image — the exact bytes the old transport would have produced — with a warning,
 * so nothing an extension hands us is lost silently. Deviation: VS Code runs its own `RPCProtocol` over a
 * socket with a JSON-based serializer; Node IPC is ours.
 *
 * After `disconnect` new `postMessage` calls are silently ignored; the channel does not kill the endpoint, the owner does.
 */
export class IpcMessageChannel implements IMessageChannel {
    private readonly endpoint: IIpcEndpoint;
    private readonly logger: ILogger | undefined;
    private readonly onMessageEmitter = new Emitter<unknown>();
    private readonly onIncoming: (message: unknown) => void;
    private readonly onDisconnect: () => void;
    private disposed = false;
    private alive = true;

    public constructor(endpoint: IIpcEndpoint, logger?: ILogger) {
        this.endpoint = endpoint;
        this.logger = logger;
        this.onIncoming = (message: unknown): void => {
            if (this.disposed) return;
            this.onMessageEmitter.fire(message);
        };
        this.onDisconnect = (): void => {
            this.alive = false;
        };
        endpoint.on("message", this.onIncoming);
        endpoint.on("disconnect", this.onDisconnect);
    }

    public postMessage(message: unknown): void {
        if (this.disposed || !this.alive) return;
        try {
            this.endpoint.send(message);
        } catch (err) {
            // The channel may have closed between the check and the send; that is the owner's business, not ours.
            if (this.channelClosed()) return;
            this.sendJsonImage(message, err);
        }
    }

    /**
     * Not structured-cloneable: resend as the JSON image, which drops functions and symbols the way the JSON
     * transport did. A message that JSON rejects too (cycle plus a function) is dropped — loudly.
     */
    private sendJsonImage(message: unknown, cause: unknown): void {
        const summary = summarizeMessage(message);
        let image: unknown;
        try {
            image = jsonImage(message);
        } catch (jsonError) {
            this.logger?.error(
                "IPC message dropped: neither structured-cloneable nor JSON-serializable",
                summary,
                cause,
                jsonError,
            );
            return;
        }
        this.logger?.warn(
            "IPC message is not structured-cloneable (a function, symbol or proxy in the payload); sent as its JSON image",
            summary,
            cause,
        );
        try {
            this.endpoint.send(image);
        } catch (err) {
            if (this.channelClosed()) return;
            this.logger?.error("IPC message dropped: send failed after the JSON fallback", summary, err);
        }
    }

    private channelClosed(): boolean {
        if (this.endpoint.connected) return false;
        this.alive = false;
        return true;
    }

    public readonly onMessage = this.onMessageEmitter.event;

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.alive = false;
        this.endpoint.off("message", this.onIncoming);
        this.endpoint.off("disconnect", this.onDisconnect);
        // The `disposed` guard already blocks delivery after dispose; removing the listeners
        // is unobservable from outside and only frees their closures.
        // Stryker disable next-line CallExpression: equivalent, see above
        this.onMessageEmitter.dispose();
    }
}
