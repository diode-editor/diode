import type * as vscode from "vscode";

import { Emitter, type Event } from "../../../base/common/event.ts";
import { DisposableStore } from "../../../base/common/lifecycle.ts";

/**
 * A debug adapter as the subprocess runs it (upstream reuses the core's `AbstractDebugAdapter` there, but only as a
 * pipe: the message callback is always set, so its sequence numbers, pending requests and queue are never used).
 * Messages go through as they are; the core numbers and matches them.
 */
export abstract class ExtHostDebugAdapter {
    protected readonly store = new DisposableStore();
    protected readonly onMessageEmitter = this.store.add(new Emitter<DebugProtocol.ProtocolMessage>());
    protected readonly onErrorEmitter = this.store.add(new Emitter<Error>());
    protected readonly onExitEmitter = this.store.add(new Emitter<number | null>());

    public get onMessage(): Event<DebugProtocol.ProtocolMessage> {
        return this.onMessageEmitter.event;
    }

    public get onError(): Event<Error> {
        return this.onErrorEmitter.event;
    }

    public get onExit(): Event<number | null> {
        return this.onExitEmitter.event;
    }

    /** Settles once the adapter can take messages; an inline adapter can at once. */
    public abstract startSession(): Promise<void> | void;

    public abstract sendMessage(message: DebugProtocol.ProtocolMessage): void;

    public abstract stopSession(): Promise<void>;

    public dispose(): void {
        this.store.dispose();
    }
}

/** Upstream `DirectDebugAdapter`: calls straight into the extension's `DebugAdapterInlineImplementation`. */
export class DirectDebugAdapter extends ExtHostDebugAdapter {
    public constructor(private readonly implementation: vscode.DebugAdapter) {
        super();
        this.store.add(
            implementation.onDidSendMessage((message) => {
                this.onMessageEmitter.fire(message as DebugProtocol.ProtocolMessage);
            }),
        );
    }

    public startSession(): void {
        // Nothing to start: the implementation is already there.
    }

    public sendMessage(message: DebugProtocol.ProtocolMessage): void {
        this.implementation.handleMessage(message);
    }

    public stopSession(): Promise<void> {
        this.implementation.dispose();
        return Promise.resolve();
    }
}

/**
 * The adapters that need the OS — a process (`DebugAdapterExecutable`), a TCP socket (`DebugAdapterServer`), a named
 * pipe (`DebugAdapterNamedPipeServer`): upstream's `api/node/extHostDebugService.ts` `createDebugAdapter`. The node
 * subprocess passes `api/node/extHostDebugAdapters.ts`; `undefined` — this descriptor is not one of them.
 */
export type ExtHostNodeDebugAdapters = (
    descriptor: vscode.DebugAdapterDescriptor,
    debugType: string,
) => ExtHostDebugAdapter | undefined;
