import { Emitter } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type { IMessageChannel } from "./iMessageChannel.ts";

/** Intersection of `NodeJS.Process` and `ChildProcess`: works on both sides of IPC. */
export interface IIpcEndpoint {
    send(message: unknown): boolean;
    on(event: "message", listener: (msg: unknown) => void): unknown;
    on(event: "disconnect", listener: () => void): unknown;
    off(event: "message", listener: (msg: unknown) => void): unknown;
    off(event: "disconnect", listener: () => void): unknown;
}

/** After `disconnect` new `postMessage` calls are silently ignored; the channel does not kill the endpoint, the owner does. */
export class IpcMessageChannel implements IMessageChannel {
    private readonly endpoint: IIpcEndpoint;
    private readonly onMessageEmitter = new Emitter<unknown>();
    private readonly onIncoming: (message: unknown) => void;
    private readonly onDisconnect: () => void;
    private disposed = false;
    private alive = true;

    public constructor(endpoint: IIpcEndpoint) {
        this.endpoint = endpoint;
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
        } catch {
            // The channel may have closed between the check and the send; ignore silently.
            this.alive = false;
        }
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
