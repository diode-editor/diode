#!/usr/bin/env node
// Runs the editor binary with the same arguments and terminal (stdio: inherit).
// If the binary is missing (postinstall skipped or failed), downloads it first.
import { spawn } from "node:child_process";

import { binaryPath, download, isInstalled } from "../lib/binary.js";

if (!isInstalled()) {
    await download();
}

const child = spawn(binaryPath(), process.argv.slice(2), { stdio: "inherit", windowsHide: true });

// Terminal signals (Ctrl+C outside raw mode, SIGTERM from tmux/ssh) go to the child, not the wrapper.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
    } else {
        process.exit(code ?? 1);
    }
});
child.on("error", (error) => {
    console.error(`diode: failed to start ${binaryPath()}: ${error.message}`);
    process.exit(1);
});
