import { Emitter } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type { IMessageChannel } from "./iMessageChannel.ts";

/** Delivery via `queueMicrotask`: asynchronous, like real IPC. */
export function createInProcessChannelPair(): [IMessageChannel, IMessageChannel] {
    const a = new InProcessChannel();
    const b = new InProcessChannel();
    a.connect(b);
    b.connect(a);
    return [a, b];
}

class InProcessChannel implements IMessageChannel {
    private peer: InProcessChannel | null = null;
    private readonly onMessageEmitter = new Emitter<unknown>();
    private disposed = false;

    public connect(peer: InProcessChannel): void {
        this.peer = peer;
    }

    public postMessage(message: unknown): void {
        if (this.disposed) return;
        const peer = this.peer;
        /* v8 ignore start -- defensive: createInProcessChannelPair always connects both ends and InProcessChannel is not exported, so peer is never null here */
        if (peer === null) return;
        /* v8 ignore stop */
        // Serialize/deserialize mimics structured cloning as in real IPC:
        // catches extensions that mutate sent objects.
        const serialized = JSON.stringify(message);
        queueMicrotask(() => {
            if (peer.disposed) return;
            const decoded: unknown = JSON.parse(serialized);
            peer.onMessageEmitter.fire(decoded);
        });
    }

    public readonly onMessage = this.onMessageEmitter.event;

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        // The `disposed` guard already blocks delivery after dispose; removing the listeners
        // is unobservable from outside and only frees their closures.
        // Stryker disable next-line CallExpression: equivalent, see above
        this.onMessageEmitter.dispose();
    }
}
