/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/common/abstractDebugAdapter.ts
// The low-level DAP plumbing every adapter shares: sequence numbers, pending requests with their timeouts, and the
// queue that hands incoming messages to the session one task at a time. Missing is how an adapter talks to its
// process: the extension host bridge (`ExtensionHostDebugAdapter`) and the in-process synthetic adapter of the tests
// subclass it.

import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Emitter, type Event } from "../../../../base/common/event.ts";

import type { IDebugAdapter } from "./debug.ts";

function nextTask(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

export abstract class AbstractDebugAdapter implements IDebugAdapter {
    private sequence = 1;
    private readonly pendingRequests = new Map<number, (e: DebugProtocol.Response) => void>();
    private readonly pendingRequestTimers = new Map<number, ReturnType<typeof setTimeout>>();
    private requestCallback: ((request: DebugProtocol.Request) => void) | undefined;
    private eventCallback: ((request: DebugProtocol.Event) => void) | undefined;
    private messageCallback: ((message: DebugProtocol.ProtocolMessage) => void) | undefined;
    private queue: DebugProtocol.ProtocolMessage[] = [];
    protected readonly onErrorEmitter = new Emitter<Error>();
    protected readonly onExitEmitter = new Emitter<number | null>();

    public abstract startSession(): Promise<void>;

    public abstract stopSession(): Promise<void>;

    public abstract sendMessage(message: DebugProtocol.ProtocolMessage): void;

    public get onError(): Event<Error> {
        return this.onErrorEmitter.event;
    }

    public get onExit(): Event<number | null> {
        return this.onExitEmitter.event;
    }

    public onMessage(callback: (message: DebugProtocol.ProtocolMessage) => void): void {
        if (this.messageCallback) {
            this.onErrorEmitter.fire(new Error(`attempt to set more than one 'Message' callback`));
        }
        this.messageCallback = callback;
    }

    public onEvent(callback: (event: DebugProtocol.Event) => void): void {
        if (this.eventCallback) {
            this.onErrorEmitter.fire(new Error(`attempt to set more than one 'Event' callback`));
        }
        this.eventCallback = callback;
    }

    public onRequest(callback: (request: DebugProtocol.Request) => void): void {
        if (this.requestCallback) {
            this.onErrorEmitter.fire(new Error(`attempt to set more than one 'Request' callback`));
        }
        this.requestCallback = callback;
    }

    public sendResponse(response: DebugProtocol.Response): void {
        if (response.seq > 0) {
            this.onErrorEmitter.fire(
                new Error(`attempt to send more than one response for command ${response.command}`),
            );
        } else {
            this.internalSend("response", response);
        }
    }

    public sendRequest(
        command: string,
        args: unknown,
        clb: (result: DebugProtocol.Response) => void,
        timeout?: number,
    ): number {
        const request = { command } as DebugProtocol.Request;
        if (args && Object.keys(args).length > 0) {
            request.arguments = args;
        }
        this.internalSend("request", request);
        if (typeof timeout === "number") {
            // A response or a cancel clears the timer, so the request is still pending when it fires.
            const timer = setTimeout(() => {
                this.pendingRequestTimers.delete(request.seq);
                this.pendingRequests.delete(request.seq);
                clb({
                    type: "response",
                    seq: 0,
                    request_seq: request.seq,
                    success: false,
                    command,
                    message: `Timeout after ${String(timeout)} ms for '${command}'`,
                });
            }, timeout);
            this.pendingRequestTimers.set(request.seq, timer);
        }
        // store callback for this request
        this.pendingRequests.set(request.seq, clb);
        return request.seq;
    }

    public acceptMessage(message: DebugProtocol.ProtocolMessage): void {
        if (this.messageCallback) {
            this.messageCallback(message);
        } else {
            this.queue.push(message);
            if (this.queue.length === 1) {
                // first item = need to start processing loop; a callback that throws is reported, not lost
                this.processQueue().catch(onUnexpectedError);
            }
        }
    }

    /**
     * Returns whether we should insert a timeout between processing messageA and messageB. Artificially queueing
     * protocol messages guarantees that any microtasks for previous message finish before next message is processed.
     * This is essential ordering when using promises anywhere along the call path.
     */
    protected needsTaskBoundaryBetween(
        messageA: DebugProtocol.ProtocolMessage,
        messageB: DebugProtocol.ProtocolMessage,
    ): boolean {
        return messageA.type !== "event" || messageB.type !== "event";
    }

    /**
     * Reads and dispatches items from the queue until it is empty.
     */
    private async processQueue(): Promise<void> {
        let message: DebugProtocol.ProtocolMessage | undefined;
        while (this.queue.length) {
            if (!message || this.needsTaskBoundaryBetween(this.queue[0], message)) {
                await nextTask();
            }
            message = this.queue.shift();
            if (!message) {
                return; // may have been disposed of
            }
            switch (message.type) {
                case "event":
                    this.eventCallback?.(message as DebugProtocol.Event);
                    break;
                case "request":
                    this.requestCallback?.(message as DebugProtocol.Request);
                    break;
                case "response": {
                    const response = message as DebugProtocol.Response;
                    const clb = this.pendingRequests.get(response.request_seq);
                    if (clb) {
                        this.pendingRequests.delete(response.request_seq);
                        this.clearPendingRequestTimer(response.request_seq);
                        clb(response);
                    }
                    break;
                }
            }
        }
    }

    private internalSend(typ: "request" | "response" | "event", message: DebugProtocol.ProtocolMessage): void {
        message.type = typ;
        message.seq = this.sequence++;
        this.sendMessage(message);
    }

    protected async cancelPendingRequests(): Promise<void> {
        if (this.pendingRequests.size === 0) {
            return;
        }
        const pending = new Map(this.pendingRequests);
        await new Promise((resolve) => setTimeout(resolve, 500));
        pending.forEach((callback, requestSeq) => {
            callback({
                type: "response",
                seq: 0,
                request_seq: requestSeq,
                success: false,
                command: "canceled",
                message: "canceled",
            });
            this.pendingRequests.delete(requestSeq);
            this.clearPendingRequestTimer(requestSeq);
        });
    }

    private clearPendingRequestTimer(requestSeq: number): void {
        clearTimeout(this.pendingRequestTimers.get(requestSeq));
        // Stryker disable next-line CallExpression: the map only holds timer handles; a cleared one left in it is never fired or read
        this.pendingRequestTimers.delete(requestSeq);
    }

    public getPendingRequestIds(): number[] {
        return Array.from(this.pendingRequests.keys());
    }

    public dispose(): void {
        for (const timer of this.pendingRequestTimers.values()) {
            clearTimeout(timer);
        }
        this.pendingRequestTimers.clear();
        this.onErrorEmitter.dispose();
        this.onExitEmitter.dispose();
        this.queue = [];
    }
}
