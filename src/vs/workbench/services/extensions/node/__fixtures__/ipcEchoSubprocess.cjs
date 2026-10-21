// Helper subprocess for IpcMessageChannel.RoundTrip.test.ts.
// Started via `child_process.spawn(process.execPath, [thisFile], { stdio: [...,'ipc'] })`.
// Echo server: answers any `{ id, payload }` message with `{ id, echo: payload }`.

"use strict";

process.on("message", function (msg) {
    if (typeof msg !== "object" || msg === null) return;
    if (msg.cmd === "exit") {
        process.exit(0);
    }
    if (typeof process.send !== "function") return;
    process.send({ id: msg.id, echo: msg.payload });
});

// Readiness signal.
if (typeof process.send === "function") {
    process.send({ ready: true });
}
