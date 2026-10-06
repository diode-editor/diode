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
import WebSocket from "ws";

import { connectWithRetry } from "../../e2e/helpers/inspectorClient.ts";
import { $, focusedLeaf } from "../../e2e/helpers/query.ts";
import { DiodeInspectorMethod } from "../../src/vs/diode/diodeInspectorMethods.ts";

/**
 * Клиент инспектора для одного вызова `npm run drive`: подключился к порту
 * живой сессии, сделал своё, отключился. Процесс редактора им не владеет (в
 * отличие от `HeadlessSession` из e2e) — сессия живёт между вызовами, сервер
 * инспектора держит любое число сокетов.
 */
export class DriveClient {
    private nextId = 1;
    private isClosed = false;
    private readonly pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();

    private constructor(private readonly ws: WebSocket) {
        ws.on("message", (data: WebSocket.RawData) => {
            const raw = Array.isArray(data)
                ? Buffer.concat(data)
                : Buffer.isBuffer(data)
                  ? data
                  : Buffer.from(new Uint8Array(data));
            const res = JSON.parse(raw.toString("utf8")) as InspectorResponse;
            const waiter = this.pending.get(res.id);
            if (waiter === undefined) return;
            this.pending.delete(res.id);
            if ("error" in res) waiter.reject(new Error(res.error.message));
            else waiter.resolve(res.result);
        });
        const failAll = (reason: string): void => {
            for (const [id, waiter] of this.pending) {
                this.pending.delete(id);
                waiter.reject(new Error(reason));
            }
        };
        ws.on("close", () => {
            this.isClosed = true;
            failAll("сокет инспектора закрылся посреди запроса (процесс вышел или перезагружается)");
        });
        ws.on("error", (err: Error) => {
            failAll(`сокет инспектора: ${err.message}`);
        });
    }

    public static async connect(port: number, timeoutMs: number, signal?: AbortSignal): Promise<DriveClient> {
        return new DriveClient(await connectWithRetry(`ws://127.0.0.1:${String(port)}`, timeoutMs, signal));
    }

    /** Сокет закрыт сервером: процесс вышел или окно перезагружается. */
    public get closed(): boolean {
        return this.isClosed;
    }

    public close(): void {
        this.ws.close();
    }

    public rpc<T>(method: string, params?: unknown): Promise<T> {
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            this.pending.set(id, { resolve: resolve as (r: unknown) => void, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    // ── TUIDom.* ──

    public async sendKey(name: string): Promise<void> {
        await this.rpc("TUIDom.sendKey", { name });
    }

    public async sendText(text: string): Promise<void> {
        await this.rpc("TUIDom.sendText", { text });
    }

    public async sendMouse(params: SendMouseParams): Promise<void> {
        await this.rpc("TUIDom.sendMouse", params);
    }

    public async resize(cols: number, rows: number): Promise<void> {
        await this.rpc("TUIDom.resize", { cols, rows });
    }

    public waitForIdle(params: WaitForIdleParams = {}): Promise<WaitForIdleResult> {
        return this.rpc<WaitForIdleResult>("TUIDom.waitForIdle", params);
    }

    public async captureFrame(): Promise<GridSnapshot> {
        return (await this.rpc<CaptureFrameResult>("TUIDom.captureFrame")).frame;
    }

    public async document(): Promise<NodeSnapshot | null> {
        return (await this.rpc<GetDocumentResult>("TUIDom.getDocument")).root;
    }

    public async node(selector: string): Promise<NodeSnapshot | null> {
        return $(await this.document(), selector);
    }

    public async focused(): Promise<NodeSnapshot | null> {
        return focusedLeaf(await this.document());
    }

    public async shutdown(): Promise<void> {
        await this.rpc("TUIDom.shutdown");
    }

    // ── Diode.* ──

    public whenReady(timeoutMs: number): Promise<{ ready: boolean; pid: number }> {
        return this.rpc(DiodeInspectorMethod.whenReady, { timeoutMs });
    }

    public executeCommand(
        id: string,
        args: unknown[],
        timeoutMs?: number,
    ): Promise<{ settled: boolean; result?: unknown }> {
        return this.rpc(DiodeInspectorMethod.executeCommand, {
            id,
            args,
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        });
    }

    public listCommands(): Promise<{ commands: { id: string; title: string; category?: string }[] }> {
        return this.rpc(DiodeInspectorMethod.listCommands);
    }

    public listOutputChannels(): Promise<{ channels: { id: string; label: string }[] }> {
        return this.rpc(DiodeInspectorMethod.listOutputChannels);
    }

    public getOutput(channel: string): Promise<{ id: string; label: string; text: string }> {
        return this.rpc(DiodeInspectorMethod.getOutput, { channel });
    }

    public getContextKey(key: string): Promise<{ value: unknown }> {
        return this.rpc(DiodeInspectorMethod.getContextKey, { key });
    }

    public evaluateWhen(expr: string): Promise<{ value: boolean }> {
        return this.rpc(DiodeInspectorMethod.evaluateWhen, { expr });
    }
}
