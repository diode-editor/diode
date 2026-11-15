// Upstream `MockDebugAdapter` of `contrib/debug/test/common/mockDebug.ts`.

import { DeferredPromise } from "../vs/base/common/async.ts";
import { AbstractDebugAdapter } from "../vs/workbench/contrib/debug/common/abstractDebugAdapter.ts";

/** A handler of {@link MockDebugAdapter} returning this never answers: the request stays pending. */
export const NO_RESPONSE = Symbol("no response");

/**
 * Answers every request with an empty body on the next task, `evaluate` as upstream's ordering tests need it;
 * `handlers` override a command's answer (a body, an `Error` for a failed response, {@link NO_RESPONSE}). A response
 * the client sends to a reverse request is kept for {@link MockDebugAdapter.waitForResponseFromClient}.
 */
export class MockDebugAdapter extends AbstractDebugAdapter {
    private seq = 0;
    private readonly pendingResponses = new Map<string, DeferredPromise<DebugProtocol.Response>>();
    public readonly requests: DebugProtocol.Request[] = [];
    public readonly handlers = new Map<string, (args: unknown) => unknown>();
    public stopped = false;

    public startSession(): Promise<void> {
        return Promise.resolve();
    }

    public stopSession(): Promise<void> {
        this.stopped = true;
        return Promise.resolve();
    }

    public sendMessage(message: DebugProtocol.ProtocolMessage): void {
        if (message.type === "request") {
            const request = message as DebugProtocol.Request;
            this.requests.push(request);
            setTimeout(() => {
                this.answer(request);
            }, 0);
        } else {
            // The client sends requests, and responses to the reverse requests.
            const response = message as DebugProtocol.Response;
            this.pendingResponses.get(response.command)?.complete(response);
        }
    }

    private answer(request: DebugProtocol.Request): void {
        const handler = this.handlers.get(request.command);
        if (handler) {
            const body = handler(request.arguments);
            if (body instanceof Error) {
                this.sendErrorResponse(request, body.message);
            } else if (body !== NO_RESPONSE) {
                this.sendResponseBody(request, body);
            }
            return;
        }
        if (request.command === "evaluate") {
            this.evaluate(request, request.arguments as DebugProtocol.EvaluateArguments);
            return;
        }
        this.sendResponseBody(request, {});
    }

    /** The requests the client sent with this command, in order. */
    public sent(command: string): DebugProtocol.Request[] {
        return this.requests.filter((r) => r.command === command);
    }

    public sendResponseBody(request: DebugProtocol.Request, body: unknown): void {
        this.acceptMessage({
            seq: ++this.seq,
            type: "response",
            request_seq: request.seq,
            command: request.command,
            success: true,
            body,
        } as DebugProtocol.Response);
    }

    public sendErrorResponse(request: DebugProtocol.Request, message: string, body?: unknown): void {
        this.acceptMessage({
            seq: ++this.seq,
            type: "response",
            request_seq: request.seq,
            command: request.command,
            success: false,
            message,
            body,
        } as DebugProtocol.Response);
    }

    public sendEventBody(event: string, body?: unknown): void {
        this.acceptMessage({ seq: ++this.seq, type: "event", event, body } as DebugProtocol.Event);
    }

    public waitForResponseFromClient(command: string): Promise<DebugProtocol.Response> {
        const deferred = new DeferredPromise<DebugProtocol.Response>();
        this.pendingResponses.set(command, deferred);
        return deferred.p;
    }

    public sendRequestBody(command: string, args: unknown): void {
        this.acceptMessage({ seq: ++this.seq, type: "request", command, arguments: args } as DebugProtocol.Request);
    }

    public fireError(error: Error): void {
        this.onErrorEmitter.fire(error);
    }

    public fireExit(code: number | null): void {
        this.onExitEmitter.fire(code);
    }

    private evaluate(request: DebugProtocol.Request, args: DebugProtocol.EvaluateArguments): void {
        if (args.expression.startsWith("before.")) {
            this.sendEventBody("output", { output: args.expression });
        }

        this.sendResponseBody(request, { result: "=" + args.expression, variablesReference: 0 });

        if (args.expression.startsWith("after.")) {
            this.sendEventBody("output", { output: args.expression });
        }
    }
}
