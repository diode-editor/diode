"use strict";

/**
 * Фикстура для extensionHost.fork.test.ts. Регистрирует команду
 * `test.fork.roundtrip`: форкает `process.execPath` (как это делает
 * vscode-languageclient при `TransportKind.ipc`), ребёнок отчитывается по IPC
 * своим окружением. Тест проверяет, что форк из extension host'а живой и что
 * ребёнок унаследовал `DIODE_RUN_AS_NODE=1` без `DIODE_EXTENSION_HOST` — под
 * SEA именно эта пара уводит diode-бинарь в node-режим вместо ext-host-ветки.
 */
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CHILD_SOURCE = [
    "process.send({",
    "    runAsNode: process.env.DIODE_RUN_AS_NODE ?? null,",
    "    extensionHost: process.env.DIODE_EXTENSION_HOST ?? null,",
    "});",
].join("\n");

exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.commands.registerCommand("test.fork.roundtrip", function () {
            const script = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "diode-fork-")), "child.cjs");
            fs.writeFileSync(script, CHILD_SOURCE, "utf-8");
            return new Promise(function (resolve, reject) {
                const child = cp.fork(script);
                const timer = setTimeout(function () {
                    child.kill();
                    reject(new Error("fork child did not report in time"));
                }, 10_000);
                child.on("message", function (msg) {
                    clearTimeout(timer);
                    child.kill();
                    resolve(msg);
                });
                child.on("error", function (err) {
                    clearTimeout(timer);
                    reject(err);
                });
            }).finally(function () {
                fs.rmSync(path.dirname(script), { recursive: true, force: true });
            });
        }),
    );
};
