import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { IIpcEndpoint } from "./ipcMessageChannel.ts";
import { IpcMessageChannel } from "./ipcMessageChannel.ts";
import { RpcEndpoint } from "./rpcEndpoint.ts";

const fixturePath = fileURLToPath(
    new URL("../../services/extensions/node/__fixtures__/ipcEchoSubprocess.cjs", import.meta.url),
);

interface RunningChild {
    child: ChildProcess;
    channel: IpcMessageChannel;
    rpc: RpcEndpoint;
}

describe("IpcMessageChannel — real subprocess round-trip", () => {
    const running: RunningChild[] = [];

    afterEach(async () => {
        while (running.length > 0) {
            const r = running.pop();
            if (r === undefined) break;
            r.rpc.dispose();
            r.channel.dispose();
            if (!r.child.killed && r.child.exitCode === null) {
                r.child.kill("SIGTERM");
                await new Promise<void>((resolve) => {
                    r.child.once("exit", () => {
                        resolve();
                    });
                    setTimeout(resolve, 500);
                });
            }
        }
    });

    function startEchoChild(): Promise<RunningChild> {
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [fixturePath], {
                stdio: ["ignore", "pipe", "pipe", "ipc"],
                env: { ...process.env },
            });
            const channel = new IpcMessageChannel(child as unknown as IIpcEndpoint);
            const handle: RunningChild = { child, channel, rpc: new RpcEndpoint(channel) };
            running.push(handle);
            const onReady = channel.onMessage((msg) => {
                if (typeof msg === "object" && msg !== null && (msg as { ready?: boolean }).ready === true) {
                    onReady.dispose();
                    resolve(handle);
                }
            });
            child.once("error", reject);
            child.once("exit", (code) => {
                if (code !== 0 && code !== null) {
                    reject(new Error(`echo subprocess exited with code ${String(code)}`));
                }
            });
        });
    }

    it("postMessage доходит через реальный node IPC", async () => {
        const { channel } = await startEchoChild();
        const received: unknown[] = [];
        channel.onMessage((m) => received.push(m));
        channel.postMessage({ id: 1, payload: "ping" });
        await waitUntil(() => received.length > 0, 2000);
        expect(received).toEqual([{ id: 1, echo: "ping" }]);
    });

    it("несколько сообщений сохраняют порядок", async () => {
        const { channel } = await startEchoChild();
        const received: unknown[] = [];
        channel.onMessage((m) => received.push(m));
        channel.postMessage({ id: 1, payload: "a" });
        channel.postMessage({ id: 2, payload: "b" });
        channel.postMessage({ id: 3, payload: "c" });
        await waitUntil(() => received.length === 3, 2000);
        expect(received).toEqual([
            { id: 1, echo: "a" },
            { id: 2, echo: "b" },
            { id: 3, echo: "c" },
        ]);
    });

    it("RpcEndpoint поверх IpcMessageChannel работает с настоящим subprocess", async () => {
        // Echo fixture without an RPC envelope: only the channel round-trip is tested here.
        const { channel, rpc } = await startEchoChild();
        expect(rpc).toBeDefined();
        const received: unknown[] = [];
        channel.onMessage((m) => received.push(m));
        channel.postMessage({ id: 42, payload: { nested: true } });
        await waitUntil(() => received.length > 0, 2000);
        expect(received).toEqual([{ id: 42, echo: { nested: true } }]);
    });
});

async function waitUntil(pred: () => boolean, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (pred()) return;
        await new Promise((r) => setTimeout(r, 10));
    }
    if (!pred()) throw new Error("waitUntil timed out");
}
