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

/** Сколько ждём ответа на `TUIDom.shutdown`, прежде чем перейти к SIGKILL. */
const SHUTDOWN_REPLY_TIMEOUT_MS = 5000;
const CONNECT_TIMEOUT_MS = 30_000;
/** Сколько ждать самостоятельного выхода процесса после shutdown (до SIGKILL). */
const EXIT_GRACE_MS = 3000;

export type MouseModifiers = Pick<SendMouseParams, "shiftKey" | "altKey" | "ctrlKey">;

/** `settle: false` — без авто-ожидания покоя (тесты на гонки); объект — параметры `waitForIdle`. */
export type SettleOption = { settle?: boolean | WaitForIdleParams };

export type WaitOpts = { timeoutMs?: number; intervalMs?: number };

/** От левого-верхнего угла box'а узла, а не от центра. */
export type NodeClickOffset = { dx?: number; dy?: number };

export interface HeadlessSessionOptions {
    /** Positional args (files/dirs to open) and any flags except headless/inspect-tui. */
    args?: string[];
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
    /** Например self-extract-сборка; по умолчанию — SEA из getBinaryPath(). */
    binary?: string;
}

/** Настоящий SEA-бинарь в `--headless`, управление через инспектор — без pty и ANSI. */
export class HeadlessSession {
    public readonly cols: number;
    public readonly rows: number;
    /**
     * `DIODE_E2E_SESSION`: её наследует всё, что поднял редактор, включая языковые серверы в чужой
     * группе процессов, — по ней `appSession` добивает переживших `dispose`.
     */
    public readonly sessionTag: string;
    private readonly child: ChildProcess;
    /** Не readonly: перезагрузка окна поднимает новый процесс на том же порту. */
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
            // Своя группа процессов (posix): `dispose` сигналит всей группе, а не
            // одному редактору, — его прямые помощники не остаются сиротами.
            detached: process.platform !== "win32",
        });
        // stderr копим с самого спавна: если процесс умрёт до подключения, его
        // последние слова — единственная диагностика.
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
     * Процесс заменяет себя новым на том же порту. Прежний сокет закрывается не сразу (прощание
     * сперва останавливает extension host) — его закрытие и есть признак перезапуска.
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
                reject(new Error("окно не ушло на перезапуск: сокет инспектора всё ещё открыт"));
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
        // Мёртвый сокет ответа не принесёт: на `TUIDom.shutdown` процесс уходит в exit синхронно, и
        // без этого `dispose()` не возвращался никогда.
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
            // Колбэк обязателен: без него `ws` молча выбрасывает отправку в закрытый сокет, и запрос
            // после `dispose` висел бы вечно — событие `close` уже прошло.
            this.ws.send(JSON.stringify({ id, method, params }), (error) => {
                if (error === undefined || error === null) return;
                this.pending.delete(id);
                reject(new Error(`inspector request ${method} not sent: ${error.message}`));
            });
        });
    }


    /** Без ожидания покоя — для тестов на гонки. */
    public async sendKey(name: string): Promise<void> {
        await this.rpc("TUIDom.sendKey", { name });
    }

    /** Без ожидания покоя — для тестов на гонки. */
    public async sendText(text: string): Promise<void> {
        await this.rpc("TUIDom.sendText", { text });
    }

    /** 0-based экранные координаты — те же, что `box` узла в `TUIDom.getDocument`. Без ожидания покоя. */
    public async sendMouse(params: SendMouseParams): Promise<void> {
        await this.rpc("TUIDom.sendMouse", params);
    }


    /**
     * Ждёт покоя *рендера*, а не асинхронных хвостов (ext-host, debounce StateService) — для них
     * предикат ({@link waitForDocument} и т.п.).
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
     * Готовности не ждёт: методы поднимаются с инспектором, до активации расширений, — для тестов
     * «человек успел раньше старта».
     */
    public async executeCommand(id: string, ...args: unknown[]): Promise<void> {
        await this.rpc("Diode.executeCommand", { id, args });
    }

    /**
     * Extension host активирован (`*`, `workspaceContains:`, `onStartupFinished`) и фаза `eventually`.
     * Текст на экране готовности не означает: расширения поднимаются позже, как у эталона.
     */
    public async waitForReady(timeoutMs = 60_000): Promise<void> {
        const { ready } = await this.rpc<{ ready: boolean }>("Diode.whenReady", { timeoutMs });
        if (!ready) throw new Error(`Diode.whenReady: редактор не готов за ${String(timeoutMs)} мс`);
    }

    /** Текст канала Output (id или подпись). */
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
            // Именно просьба: ответа может не быть ни от сокета, ни от зависшего процесса, а дальше
            // всё равно SIGKILL — ждём ограниченно.
            await Promise.race([this.rpc("TUIDom.shutdown"), sleep(SHUTDOWN_REPLY_TIMEOUT_MS)]);
        } catch {
            // socket may drop as the process exits — ignore
        }
        try {
            this.ws.close();
        } catch {
            // already closed
        }
        // Дать процессу выйти самому: мгновенный SIGKILL режет flushSync стора в process.on("exit") на
        // медленных раннерах (терялся черновик commit-сообщения между рестартами).
        const exitDeadline = Date.now() + EXIT_GRACE_MS;
        while (this.child.exitCode === null && Date.now() < exitDeadline) {
            await sleep(50);
        }
        // Группе — всегда, даже если лидер вышел: помощники в группе сами не уходят. Субпроцесс
        // расширений живёт в СВОЕЙ группе и прощается сам (languageServerTeardown.test.ts).
        killGroup(this.child, "SIGKILL");
    }

    /** Captured stderr (diagnostics only — headless writes nothing there normally). */
    public getStderr(): string {
        return this.stderr;
    }

    /** Для тестов на ДЕРЕВО процессов (субпроцесс расширений, языковые серверы), а не на кадр. */
    public get pid(): number | undefined {
        return this.child.pid;
    }
}

/**
 * Наперегонки со смертью процесса: ранний выход (ENOENT, падение на старте) виден за миллисекунды
 * вместе со stderr, а не через 30 с `connectWithRetry`; при любой неудаче процесс добивается.
 */
async function connectOrDie(child: ChildProcess, url: string, stderr: () => string): Promise<WebSocket> {
    const abort = new AbortController();
    const died = new Promise<never>((_, reject) => {
        child.once("error", (err) => {
            reject(new Error(`редактор не запустился: ${err.message}`));
        });
        child.once("exit", (code, signal) => {
            const how = signal === null ? `кодом ${String(code)}` : `сигналом ${signal}`;
            reject(new Error(`редактор вышел ${how} до подключения инспектора\n${stderr().slice(-4000)}`));
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

/** Голый таймаут, а не {@link waitFor}: гонимся с ответом на shutdown, которого может и не быть. */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export { dumpFrame, frameToText };
