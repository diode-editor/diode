#!/usr/bin/env node
/**
 * Стек главного потока ЗАВИСШЕГО diode — без пересборки и перезапуска.
 *
 *   node scripts/hang-stack.mjs <pid> [--samples N]
 *
 * SIGUSR1 поднимает инспектор (и в SEA), `Debugger.pause` останавливает V8 даже посреди
 * тугого цикла; одинаковые сэмплы — место зависания. Простаивающий процесс на паузу не
 * встанет, пока не проснётся (нажми клавишу).
 *
 * Номера строк — в бандле (`~/.cache/diode/<версия>/main.cjs`); исходник — по
 * комментарию-пути `// src/...` выше функции.
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
                // не инспектор (порт drive/inspect-tui) — следующий
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`процесс ${pid} не поднял инспектор`);
}

/** Сокеты процесса из /proc/<pid>/fd против LISTEN-записей /proc/net/tcp*. */
function listeningPorts() {
    const own = new Set();
    for (const fd of readdirSync(`/proc/${pid}/fd`)) {
        try {
            const match = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${fd}`));
            if (match) own.add(match[1]);
        } catch {
            // fd закрылся между readdir и readlink
        }
    }
    const ports = [];
    for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
        for (const line of readFileSync(table, "utf8").split("\n").slice(1)) {
            const cols = line.trim().split(/\s+/);
            // st 0A — LISTEN; local_address — hex «addr:port», inode — десятая колонка
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
        console.log("пауза не наступила за 10 с: главный поток простаивает (не завис) — нажми клавишу в редакторе");
        break;
    }
    console.log(`--- сэмпл ${sample + 1}`);
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
