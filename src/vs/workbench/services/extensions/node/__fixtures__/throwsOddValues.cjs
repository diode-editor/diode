"use strict";

/**
 * Fixture (#861): throws plain values from timers, ticks and a burst of interval callbacks,
 * outside any promise. `test.alive` answers only while the subprocess lives on.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(vscode.commands.registerCommand("test.alive", () => "alive"));

    const throws = [
        () => {
            throw "plain-string";
        },
        () => {
            throw 42;
        },
        () => {
            throw undefined;
        },
        () => {
            throw null;
        },
        () => {
            throw new Error("юникод 🚀\nsecond line");
        },
        () => {
            throw Object.assign(new Error("read EPIPE"), { code: "EPIPE", syscall: "read" });
        },
    ];
    for (const fn of throws) setTimeout(fn, 0);
    setImmediate(() => {
        throw new Error("from-immediate");
    });
    process.nextTick(() => {
        throw new Error("from-next-tick");
    });

    let burst = 0;
    const interval = setInterval(() => {
        burst += 1;
        if (burst >= 50) clearInterval(interval);
        throw new Error(`burst-${burst}`);
    }, 1);
    context.subscriptions.push({ dispose: () => clearInterval(interval) });
};
exports.deactivate = function deactivate() {};
