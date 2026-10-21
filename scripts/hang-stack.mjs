#!/usr/bin/env node
/**
 * Main-thread stack of a HUNG diode, without a rebuild or restart.
 *
 *   node scripts/hang-stack.mjs <pid> [--samples N]
 *
 * SIGUSR1 opens the inspector (in SEA too), and `Debugger.pause` stops V8 even inside a tight
 * loop; identical samples point at the hang. An idle process won't pause until it wakes up
 * (press a key).
 *
 * Line numbers refer to the bundle (`~/.cache/diode/<version>/main.cjs`); find the source by the
 * `// src/...` path comment above the function.
 */

import { readdirSync, readFileSync, readlinkSync } from "node:fs";

const pid = Number(process.argv[2]);
const samplesFlag = process.argv.indexOf("--samples");
const samples = samplesFlag > 0 ? Number(process.argv[samplesFlag + 1]) : 5;
if (!Number.isInteger(pid) || pid <= 0) {
    console.error("usage: node scripts/hang-stack.mjs <pid> [--samples N]");
    process.exit(2);
}

async function inspectorUrl() {
    process.kill(pid, "SIGUSR1");
    for (let attempt = 0; attempt < 50; attempt++) {
        for (const port of listeningPorts()) {
            try {
                const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
                if (list[0]?.webSocketDebuggerUrl) return list[0].webSocketDebuggerUrl;
            } catch {
                // not the inspector (a drive/inspect-tui port), try the next one
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`process ${pid} did not open the inspector`);
}

/** Process sockets from /proc/<pid>/fd matched against LISTEN entries of /proc/net/tcp*. */
function listeningPorts() {
    const own = new Set();
    for (const fd of readdirSync(`/proc/${pid}/fd`)) {
        try {
            const match = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${fd}`));
            if (match) own.add(match[1]);
        } catch {
            // fd closed between readdir and readlink
        }
    }
    const ports = [];
    for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
        for (const line of readFileSync(table, "utf8").split("\n").slice(1)) {
            const cols = line.trim().split(/\s+/);
            // st 0A is LISTEN; local_address is hex "addr:port", inode is the tenth column
            if (cols[3] === "0A" && own.has(cols[9])) ports.push(parseInt(cols[1].split(":")[1], 16));
        }
    }
    return ports.sort((a, b) => Number(b === 9229) - Number(a === 9229));
}

const ws = new WebSocket(await inspectorUrl());
let nextId = 0;
const pending = new Map();
const scripts = new Map();
let onPaused = null;
ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
    } else if (message.method === "Debugger.scriptParsed") {
        scripts.set(message.params.scriptId, message.params.url);
    } else if (message.method === "Debugger.paused") {
        onPaused?.(message.params);
    }
};
const send = (method, params = {}) =>
    new Promise((resolve) => {
        const id = ++nextId;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
    });
await new Promise((resolve) => (ws.onopen = resolve));
await send("Debugger.enable");

for (let sample = 0; sample < samples; sample++) {
    const paused = new Promise((resolve) => (onPaused = resolve));
    void send("Debugger.pause");
    const params = await Promise.race([paused, new Promise((resolve) => setTimeout(() => resolve(null), 10_000))]);
    if (!params) {
        console.log("no pause within 10 s: the main thread is idle (not hung), press a key in the editor");
        break;
    }
    console.log(`--- sample ${sample + 1}`);
    for (const frame of params.callFrames.slice(0, 30)) {
        const url = (scripts.get(frame.location.scriptId) ?? frame.url ?? "").split("/").pop();
        console.log(`  ${frame.functionName || "<anonymous>"}  ${url}:${frame.location.lineNumber + 1}:${frame.location.columnNumber + 1}`);
    }
    await send("Debugger.resume");
    await new Promise((resolve) => setTimeout(resolve, 500));
}
await send("Debugger.disable");
ws.close();
process.exit(0);
