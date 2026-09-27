#!/usr/bin/env node
// Запускает бинарь редактора с теми же аргументами и терминалом (stdio: inherit).
// Если бинаря нет (postinstall пропущен или упал) — докачивает и запускает.
import { spawn } from "node:child_process";

import { binaryPath, download, isInstalled } from "../lib/binary.js";

if (!isInstalled()) {
    await download();
}

const child = spawn(binaryPath(), process.argv.slice(2), { stdio: "inherit", windowsHide: true });

// Сигналы терминала (Ctrl+C вне raw-режима, SIGTERM от tmux/ssh) — ребёнку, а не обёртке.
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
