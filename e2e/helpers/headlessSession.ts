import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import type WebSocket from "ws";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";
import type {
    CaptureFrameResult,
    GetDocumentResult,
    InspectorResponse,
    InspectorSuccessResponse,
    NodeSnapshot,
    SendMouseParams,
    WaitForIdleParams,
    WaitForIdleResult,
} from "@tuidom/inspector/protocol";

import { getBinaryPath } from "./buildOnce.ts";
import { dumpFrame, frameToText } from "./frame.ts";
import { hermeticSpawnEnv } from "./hermeticEnv.ts";
import { connectWithRetry, freePort } from "./inspectorClient.ts";
import { killGroup, SESSION_MARKER_ENV } from "./processGroup.ts";
import { $, $$, focusedLeaf } from "./query.ts";
import { waitUntil } from "./waitFor.ts";

/** How long to wait for the `TUIDom.shutdown` reply before falling back to SIGKILL. */
const SHUTDOWN_REPLY_TIMEOUT_MS = 5000;
const CONNECT_TIMEOUT_MS = 30_000;
/** How long to let the process exit on its own after shutdown (before SIGKILL). */
const EXIT_GRACE_MS = 3000;

export type MouseModifiers = Pick<SendMouseParams, "shiftKey" | "altKey" | "ctrlKey">;

/** `settle: false` skips the automatic idle wait (race tests); an object passes `waitForIdle` params. */
export type SettleOption = { settle?: boolean | WaitForIdleParams };

export type WaitOpts = { timeoutMs?: number; intervalMs?: number };

/** Relative to the top-left corner of the node's box, not its center. */
export type NodeClickOffset = { dx?: number; dy?: number };

export interface HeadlessSessionOptions {
    /** Positional args (files/dirs to open) and any flags except headless/inspect-tui. */
    args?: string[];
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
    /** E.g. a self-extract build; defaults to the SEA from getBinaryPath(). */
    binary?: string;
}

/** The real SEA binary in `--headless`, driven over the inspector — no pty, no ANSI. */
export class HeadlessSession {
    public readonly cols: number;
    public readonly rows: number;
    /**
     * `DIODE_E2E_SESSION`: inherited by everything the editor spawns, including language servers in
     * another process group — `appSession` uses it to kill whatever survives `dispose`.
     */
    public readonly sessionTag: string;
    private readonly child: ChildProcess;
    /** Not readonly: a window reload starts a new process on the same port. */
    private ws: WebSocket;
    private readonly port: number;
    private nextId = 1;
    private readonly pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();
    private stderr = "";

    public static async start(options: HeadlessSessionOptions = {}): Promise<HeadlessSession> {
        const binary = options.binary ?? (await getBinaryPath());
        const cols = options.cols ?? 140;
        const rows = options.rows ?? 38;
        const port = await freePort();
        const args = [
            ...(options.args ?? []),
            `--headless=${String(cols)}x${String(rows)}`,
            `--inspect-tui=127.0.0.1:${String(port)}`,
        ];
        const sessionTag = randomUUID();
        const child = spawn(binary, args, {
            stdio: ["ignore", "ignore", "pipe"],
            ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
            env: hermeticSpawnEnv({ ...options.env, [SESSION_MARKER_ENV]: sessionTag }),
            // Own process group (posix): `dispose` signals the whole group, not just the
            // editor, so its direct helpers are not orphaned.
            detached: process.platform !== "win32",
        });
        // Collect stderr from spawn: if the process dies before connecting, its
        // last words are the only diagnostics.
        let stderr = "";
        child.stderr?.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        const ws = await connectOrDie(child, `ws://127.0.0.1:${String(port)}`, () => stderr);
        const session = new HeadlessSession(child, sessionTag, cols, rows, port, ws);
        session.stderr = stderr;
        return session;
    }

    private constructor(child: ChildProcess, sessionTag: string, cols: number, rows: number, port: number, ws: WebSocket) {
        this.child = child;
        this.sessionTag = sessionTag;
        this.cols = cols;
        this.rows = rows;
        this.port = port;
        this.ws = ws;
        this.child.stderr?.on("data", (chunk: Buffer) => {
            this.stderr += chunk.toString();
        });
        this.listenToSocket();
    }

    /**
     * The process replaces itself with a new one on the same port. The old socket does not close
     * right away (shutdown stops the extension host first) — its closing is the restart signal.
     */
    public async reconnect(timeoutMs = 30_000): Promise<void> {
        await this.waitForSocketClose(timeoutMs);
        this.ws = await connectWithRetry(`ws://127.0.0.1:${String(this.port)}`, timeoutMs);
        this.listenToSocket();
    }

    private waitForSocketClose(timeoutMs: number): Promise<void> {
        if (this.ws.readyState === this.ws.CLOSED) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error("window did not reload: the inspector socket is still open"));
            }, timeoutMs);
            this.ws.once("close", () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }

    private listenToSocket(): void {
        this.ws.on("message", (data: WebSocket.RawData) => {
            const res = JSON.parse(data.toString()) as InspectorResponse;
            const waiter = this.pending.get(res.id);
            if (waiter === undefined) return;
            this.pending.delete(res.id);
            if ("error" in res) waiter.reject(new Error(res.error.message));
            else waiter.resolve((res as InspectorSuccessResponse).result);
        });
        // A dead socket never replies: on `TUIDom.shutdown` the process exits synchronously, and
        // without this `dispose()` never returned.
        const failPending = (reason: string): void => {
            for (const [id, waiter] of this.pending) {
                this.pending.delete(id);
                waiter.reject(new Error(reason));
            }
        };
        this.ws.on("close", () => {
            failPending("inspector socket closed with requests in flight");
        });
        this.ws.on("error", (error: Error) => {
            failPending(`inspector socket failed: ${error.message}`);
        });
    }

    private rpc<T>(method: string, params?: unknown): Promise<T> {
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            this.pending.set(id, { resolve: resolve as (r: unknown) => void, reject });
            // The callback is required: without it `ws` silently drops a send to a closed socket, and a
            // request after `dispose` would hang forever — the `close` event has already fired.
            this.ws.send(JSON.stringify({ id, method, params }), (error) => {
                if (error === undefined || error === null) return;
                this.pending.delete(id);
                reject(new Error(`inspector request ${method} not sent: ${error.message}`));
            });
        });
    }


    /** No idle wait — for race tests. */
    public async sendKey(name: string): Promise<void> {
        await this.rpc("TUIDom.sendKey", { name });
    }

    /** No idle wait — for race tests. */
    public async sendText(text: string): Promise<void> {
        await this.rpc("TUIDom.sendText", { text });
    }

    /** 0-based screen coordinates — the same as a node's `box` in `TUIDom.getDocument`. No idle wait. */
    public async sendMouse(params: SendMouseParams): Promise<void> {
        await this.rpc("TUIDom.sendMouse", params);
    }


    /**
     * Waits for *render* idle, not for async tails (ext-host, StateService debounce) — use a
     * predicate for those ({@link waitForDocument} etc.).
     */
    public async waitForIdle(opts: WaitForIdleParams = {}): Promise<WaitForIdleResult> {
        return this.rpc<WaitForIdleResult>("TUIDom.waitForIdle", opts);
    }

    private async settle(opt: SettleOption): Promise<void> {
        if (opt.settle === false) return;
        await this.waitForIdle(typeof opt.settle === "object" ? opt.settle : {});
    }

    public async key(name: string, opts: SettleOption = {}): Promise<void> {
        await this.sendKey(name);
        await this.settle(opts);
    }

    /** Inject literal text as a paste, then wait for the render to settle. */
    public async text(value: string, opts: SettleOption = {}): Promise<void> {
        await this.sendText(value);
        await this.settle(opts);
    }

    public async click(x: number, y: number, opts: MouseModifiers & SettleOption = {}): Promise<void> {
        const { settle, ...mods } = opts;
        await this.sendMouse({ action: "press", button: "left", x, y, ...mods });
        await this.sendMouse({ action: "release", button: "left", x, y, ...mods });
        await this.settle({ settle });
    }

    /** Spin the wheel over a cell (`direction` matches DOM `wheelDirection`), then settle. */
    public async wheel(x: number, y: number, direction: "up" | "down" | "left" | "right", opts: SettleOption = {}): Promise<void> {
        await this.sendMouse({ action: `scroll-${direction}`, x, y });
        await this.settle(opts);
    }

    public async resize(cols: number, rows: number, opts: SettleOption = {}): Promise<void> {
        await this.rpc("TUIDom.resize", { cols, rows });
        await this.settle(opts);
    }

    public async captureFrame(): Promise<GridSnapshot> {
        return (await this.rpc<CaptureFrameResult>("TUIDom.captureFrame")).frame;
    }


    /**
     * Does not wait for readiness: methods come up with the inspector, before extensions activate —
     * for tests where the user acts before startup completes.
     */
    public async executeCommand(id: string, ...args: unknown[]): Promise<void> {
        await this.rpc("Diode.executeCommand", { id, args });
    }

    /**
     * Extension host activated (`*`, `workspaceContains:`, `onStartupFinished`) and phase `eventually`.
     * Text on screen does not mean ready: extensions come up later, as in upstream.
     */
    public async waitForReady(timeoutMs = 60_000): Promise<void> {
        const { ready } = await this.rpc<{ ready: boolean }>("Diode.whenReady", { timeoutMs });
        if (!ready) throw new Error(`Diode.whenReady: editor not ready within ${String(timeoutMs)} ms`);
    }

    /** Output channel text (by id or label). */
    public async getOutput(channel: string): Promise<string> {
        return (await this.rpc<{ text: string }>("Diode.getOutput", { channel })).text;
    }

    /** Snapshot of the element tree — node boxes are the coordinates {@link click} takes. */
    public async getDocument(): Promise<GetDocumentResult> {
        return this.rpc<GetDocumentResult>("TUIDom.getDocument");
    }

    public async waitForDocument(
        predicate: (root: NodeSnapshot) => boolean,
        opts: { timeoutMs?: number; intervalMs?: number } = {},
    ): Promise<NodeSnapshot> {
        const root = await waitUntil(
            async () => (await this.getDocument()).root,
            (r): r is NodeSnapshot => r !== null && predicate(r),
            {
                ...opts,
                describe: "document predicate",
                diagnose: (last) => `last root: ${last === null ? "<null>" : (last as NodeSnapshot).type}`,
            },
        );
        return root as NodeSnapshot;
    }

    public async waitForText(
        predicate: (text: string) => boolean,
        opts: { timeoutMs?: number; intervalMs?: number } = {},
    ): Promise<GridSnapshot> {
        return waitUntil(() => this.captureFrame(), (frame) => predicate(frameToText(frame)), {
            intervalMs: 150,
            ...opts,
            describe: "screen text predicate",
            diagnose: (last) => `--- last frame ---\n${dumpFrame(last as GridSnapshot)}`,
        });
    }


    public async node(selector: string): Promise<NodeSnapshot | null> {
        return $((await this.getDocument()).root, selector);
    }

    public async nodes(selector: string): Promise<NodeSnapshot[]> {
        return $$((await this.getDocument()).root, selector);
    }

    public async focusedType(): Promise<string | undefined> {
        return focusedLeaf((await this.getDocument()).root)?.type;
    }

    public async waitForNode(selector: string, opts: WaitOpts = {}): Promise<NodeSnapshot> {
        const root = await this.waitForDocument((r) => $(r, selector) !== null, opts);
        return $(root, selector) as NodeSnapshot;
    }

    public async waitForNoNode(selector: string, opts: WaitOpts = {}): Promise<void> {
        await this.waitForDocument((r) => $(r, selector) === null, opts);
    }

    public async waitForFocus(type: string, opts: WaitOpts = {}): Promise<NodeSnapshot> {
        const root = await this.waitForDocument((r) => focusedLeaf(r)?.type === type, opts);
        return focusedLeaf(root) as NodeSnapshot;
    }

    public async waitForState(
        selector: string,
        predicate: (state: Record<string, unknown> | undefined) => boolean,
        opts: WaitOpts = {},
    ): Promise<NodeSnapshot> {
        const root = await this.waitForDocument((r) => {
            const node = $(r, selector);
            return node !== null && predicate(node.state);
        }, opts);
        return $(root, selector) as NodeSnapshot;
    }


    public async clickNode(selector: string, opts: MouseModifiers & SettleOption & NodeClickOffset = {}): Promise<void> {
        const { x, y } = await this.pointIn(selector, opts);
        const { dx: _dx, dy: _dy, ...rest } = opts;
        await this.click(x, y, rest);
    }

    public async wheelNode(
        selector: string,
        direction: "up" | "down" | "left" | "right",
        opts: SettleOption & NodeClickOffset = {},
    ): Promise<void> {
        const { x, y } = await this.pointIn(selector, opts);
        const { settle } = opts;
        await this.wheel(x, y, direction, { settle });
    }

    private async pointIn(selector: string, offset: NodeClickOffset): Promise<{ x: number; y: number }> {
        const node = await this.node(selector);
        if (node === null) throw new Error(`clickNode: locator not found: ${selector}`);
        const { x, y, width, height } = node.box;
        if (offset.dx !== undefined || offset.dy !== undefined) {
            return { x: x + (offset.dx ?? 0), y: y + (offset.dy ?? 0) };
        }
        return { x: x + Math.floor(width / 2), y: y + Math.floor(height / 2) };
    }

    public async dispose(): Promise<void> {
        try {
            // Only a request: neither the socket nor a hung process may reply, and SIGKILL follows
            // anyway — so the wait is bounded.
            await Promise.race([this.rpc("TUIDom.shutdown"), sleep(SHUTDOWN_REPLY_TIMEOUT_MS)]);
        } catch {
            // socket may drop as the process exits — ignore
        }
        try {
            this.ws.close();
        } catch {
            // already closed
        }
        // Let the process exit on its own: an immediate SIGKILL cuts off the store's flushSync in
        // process.on("exit") on slow runners (the commit message draft was lost between restarts).
        const exitDeadline = Date.now() + EXIT_GRACE_MS;
        while (this.child.exitCode === null && Date.now() < exitDeadline) {
            await sleep(50);
        }
        // Always signal the group, even if the leader exited: its helpers do not leave on their own.
        // The extension subprocess lives in its OWN group and shuts down by itself
        // (languageServerTeardown.test.ts).
        killGroup(this.child, "SIGKILL");
    }

    /** Captured stderr (diagnostics only — headless writes nothing there normally). */
    public getStderr(): string {
        return this.stderr;
    }

    /** For tests on the process TREE (extension subprocess, language servers), not on the frame. */
    public get pid(): number | undefined {
        return this.child.pid;
    }
}

/**
 * Races against process death: an early exit (ENOENT, crash on startup) shows up within milliseconds
 * along with stderr, not after 30 s of `connectWithRetry`; on any failure the process is killed.
 */
async function connectOrDie(child: ChildProcess, url: string, stderr: () => string): Promise<WebSocket> {
    const abort = new AbortController();
    const died = new Promise<never>((_, reject) => {
        child.once("error", (err) => {
            reject(new Error(`editor failed to start: ${err.message}`));
        });
        child.once("exit", (code, signal) => {
            const how = signal === null ? `with code ${String(code)}` : `on signal ${signal}`;
            reject(new Error(`editor exited ${how} before the inspector connected\n${stderr().slice(-4000)}`));
        });
    });
    try {
        return await Promise.race([connectWithRetry(url, CONNECT_TIMEOUT_MS, abort.signal), died]);
    } catch (err) {
        abort.abort();
        killGroup(child, "SIGKILL");
        throw err;
    }
}

/** A bare timeout, not {@link waitFor}: it races a shutdown reply that may never come. */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export { dumpFrame, frameToText };
