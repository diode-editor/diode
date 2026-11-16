"use strict";

/**
 * A tiny DAP adapter for extensionHost.debugAdapters.test.ts. `createAdapter(send, name)` answers the requests of a
 * session: after `configurationDone` it prints "hello from <name>" and stops on entry in `<name>_main`. A launch
 * configuration with `crash: true` makes `onCrash` run instead (the process adapter exits with code 3).
 * `capabilities` join the answer to `initialize`. `connectStream` speaks the DAP base protocol (Content-Length framing) over a pair of streams.
 */

exports.createAdapter = function createAdapter(send, name, onCrash, capabilities = {}) {
    let seq = 1;
    let crash = false;
    const respond = (request, body) =>
        send({ seq: seq++, type: "response", request_seq: request.seq, command: request.command, success: true, body });
    const event = (name, body) => send({ seq: seq++, type: "event", event: name, body });
    return function handle(message) {
        if (message.type !== "request") return;
        switch (message.command) {
            case "initialize":
                respond(message, { supportsConfigurationDoneRequest: true, ...capabilities });
                break;
            case "launch":
                crash = message.arguments.crash === true;
                respond(message);
                event("initialized");
                break;
            case "configurationDone":
                respond(message);
                if (crash) {
                    onCrash();
                    return;
                }
                event("output", { category: "stdout", output: `hello from ${name}\n` });
                event("stopped", { reason: "entry", threadId: 1, allThreadsStopped: true });
                break;
            case "threads":
                respond(message, { threads: [{ id: 1, name: "main" }] });
                break;
            case "stackTrace":
                respond(message, {
                    stackFrames: [{ id: 1, name: `${name}_main`, line: 3, column: 1 }],
                    totalFrames: 1,
                });
                break;
            case "scopes":
                respond(message, { scopes: [] });
                break;
            default:
                respond(message);
        }
    };
};

exports.connectStream = function connectStream(readable, writable, name, onCrash, capabilities) {
    const send = (message) => {
        const json = JSON.stringify(message);
        writable.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`, "utf8");
    };
    const handle = exports.createAdapter(send, name, onCrash, capabilities);
    let buffer = Buffer.alloc(0);
    readable.on("data", (data) => {
        buffer = Buffer.concat([buffer, data]);
        for (;;) {
            const headerEnd = buffer.indexOf("\r\n\r\n");
            if (headerEnd === -1) return;
            const length = Number(/Content-Length: (\d+)/.exec(buffer.toString("utf8", 0, headerEnd))[1]);
            const start = headerEnd + 4;
            if (buffer.length < start + length) return;
            const message = JSON.parse(buffer.toString("utf8", start, start + length));
            buffer = buffer.subarray(start + length);
            handle(message);
        }
    });
};
