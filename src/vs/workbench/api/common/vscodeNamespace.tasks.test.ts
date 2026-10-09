import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

// Проводка `vscode.tasks` внутри собранного namespace: устаревший
// `workspace.registerTaskProvider` — тот же вызов, папки задач — из `workspace`,
// pty `CustomExecution` — терминалам `window`. Сам `tasks` — tasksNamespace.test.ts.

async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

function setup() {
    const stub = makeStubRpc();
    const host = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());
    stub.fire("workspace.initialize", { workspaceFolders: [{ uri: "file:///ws", name: "ws", index: 0 }] });
    return { stub, host, vscode: host.namespace };
}

describe("vscode.tasks в namespace", () => {
    it("workspace.registerTaskProvider регистрирует провайдера задач, dispose — снимает", () => {
        const { stub, host, vscode } = setup();
        const registration = host.owner.runAs("pub.ext", () =>
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- проверяется именно устаревший `workspace.registerTaskProvider`
            vscode.workspace.registerTaskProvider("demo", { provideTasks: () => [], resolveTask: () => undefined }),
        );
        expect(stub.notifies.filter((n) => n.method === "tasks.registerProvider")).toStrictEqual([
            { method: "tasks.registerProvider", params: { handle: 0, type: "demo", extensionId: "pub.ext" } },
        ]);
        registration.dispose();
        expect(stub.notifies.some((n) => n.method === "tasks.unregisterProvider")).toBe(true);
    });

    it("задача из ядра в папке воркспейса — область задачи и есть папка `workspace`", async () => {
        const { stub, vscode } = setup();
        const started: vscode.Task[] = [];
        vscode.tasks.onDidStartTask((e) => started.push(e.execution.task));
        stub.fire("tasks.didStart", {
            terminalId: 1,
            execution: {
                id: "$core.build",
                task: {
                    name: "build",
                    execution: { commandLine: "make" },
                    definition: { type: "shell" },
                    isBackground: false,
                    source: { label: "Workspace", extensionId: "$core", scope: { folder: "/ws" } },
                    problemMatchers: [],
                    hasDefinedMatchers: false,
                },
            },
        });
        await settle();
        expect(started).toHaveLength(1);
        expect(started[0].scope).toBe(vscode.workspace.workspaceFolders?.[0]);
    });

    it("CustomExecution: pty задачи открывается в терминале, который завело ядро", async () => {
        const { stub, host, vscode } = setup();
        stub.fire("terminal.opened", { id: 7, name: "Task - own", launch: {} });
        const open = vi.fn();
        const pty: vscode.Pseudoterminal = {
            onDidWrite: () => ({ dispose: () => undefined }),
            open,
            close: () => undefined,
        };
        const folder = vscode.workspace.workspaceFolders![0];
        const task = new vscode.Task(
            { type: "demo", target: "own" },
            folder,
            "own",
            "demo",
            new vscode.CustomExecution(() => Promise.resolve(pty)),
        );
        await host.owner.runAs("pub.ext", () => vscode.tasks.executeTask(task));
        stub.fire("tasks.didStart", {
            execution: {
                id: "pub.ext.target,own,type,demo,",
                task: {
                    name: "own",
                    execution: { customExecution: "customExecution" },
                    definition: { type: "demo", target: "own" },
                    isBackground: false,
                    source: { label: "demo", extensionId: "pub.ext", scope: { folder: "/ws" } },
                    problemMatchers: [],
                    hasDefinedMatchers: false,
                },
            },
            terminalId: 7,
        });
        await settle();
        expect(open).toHaveBeenCalledTimes(1);
    });
});
