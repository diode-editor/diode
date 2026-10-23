import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ILogger } from "../../../platform/log/common/iLogger.ts";

import type { IIpcEndpoint } from "./ipcMessageChannel.ts";
import { IpcMessageChannel } from "./ipcMessageChannel.ts";
import { RpcEndpoint } from "./rpcEndpoint.ts";

const fixturePath = fileURLToPath(
    new URL("../../services/extensions/node/__fixtures__/ipcEchoSubprocess.cjs", import.meta.url),
);

type RecordingLogger = ILogger & { warn: ReturnType<typeof vi.fn> };

interface RunningChild {
    child: ChildProcess;
    channel: IpcMessageChannel;
    rpc: RpcEndpoint;
    logger: RecordingLogger;
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

    /** The extension host's wire format; the child picks it up from the env Node sets for it. */
    function startEchoChild(): Promise<RunningChild> {
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [fixturePath], {
                stdio: ["ignore", "pipe", "pipe", "ipc"],
                serialization: "advanced",
                env: { ...process.env },
            });
            const logger = {
                trace: vi.fn(),
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            } as unknown as RecordingLogger;
            const channel = new IpcMessageChannel(child as unknown as IIpcEndpoint, logger);
            const handle: RunningChild = { child, channel, rpc: new RpcEndpoint(channel), logger };
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

    it("postMessage arrives over real node IPC", async () => {
        const { channel } = await startEchoChild();
        const received: unknown[] = [];
        channel.onMessage((m) => received.push(m));
        channel.postMessage({ id: 1, payload: "ping" });
        await waitUntil(() => received.length > 0, 2000);
        expect(received).toEqual([{ id: 1, echo: "ping" }]);
    });

    it("multiple messages keep their order", async () => {
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

    it("RpcEndpoint over IpcMessageChannel works with a real subprocess", async () => {
        // Echo fixture without an RPC envelope: only the channel round-trip is tested here.
        const { channel, rpc } = await startEchoChild();
        expect(rpc).toBeDefined();
        const received: unknown[] = [];
        channel.onMessage((m) => received.push(m));
        channel.postMessage({ id: 42, payload: { nested: true } });
        await waitUntil(() => received.length > 0, 2000);
        expect(received).toEqual([{ id: 42, echo: { nested: true } }]);
    });

    it("the structured clone carries what JSON lost: undefined fields, Map, Date, Uint8Array", async () => {
        const { channel } = await startEchoChild();
        const received: unknown[] = [];
        channel.onMessage((m) => received.push(m));
        const when = new Date(1234);
        channel.postMessage({
            id: 1,
            payload: { gap: undefined, map: new Map([["k", 1]]), when, bytes: new Uint8Array([1, 2]) },
        });
        await waitUntil(() => received.length > 0, 2000);
        const echo = (received[0] as { echo: Record<string, unknown> }).echo;
        expect(Object.keys(echo)).toEqual(["gap", "map", "when", "bytes"]);
        expect(echo.map).toEqual(new Map([["k", 1]]));
        expect(echo.when).toEqual(when);
        expect(Array.from(echo.bytes as Uint8Array)).toEqual([1, 2]);
    });

    it("a function in the payload: the message is not lost, it arrives as its JSON image, with a warning", async () => {
        const { channel, logger } = await startEchoChild();
        const received: unknown[] = [];
        channel.onMessage((m) => received.push(m));
        channel.postMessage({ id: 1, payload: { onClick: () => "x", label: "ok" } });
        channel.postMessage({ id: 2, payload: "after" });
        await waitUntil(() => received.length === 2, 2000);
        expect(received).toEqual([
            { id: 1, echo: { label: "ok" } },
            { id: 2, echo: "after" },
        ]);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls[0]?.[1]).toBe("message#1");
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
