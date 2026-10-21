import { existsSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import WebSocket from "ws";

import { waitUntil } from "./waitFor.ts";

// A probe client of the ide server instead of the real `claude`, which needs a subscription and network
// (docs/TESTING.md, the paragraph on Claude Code without the real CLI).

export const CLAUDE_CODE_ID = "Anthropic.claude-code";

export const FAKE_CLAUDE_BIN = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "..",
    "fixtures",
    "fakeClaude",
    "bin",
);

/**
 * A fake `claude` first in PATH: on a developer machine the real CLI is in PATH. An empty
 * `CLAUDE_CONFIG_DIR` (it is checked for truthiness) sends the lock to the isolated `$HOME/.claude`.
 */
export function claudeCodeSessionEnv(): Record<string, string> {
    return { PATH: `${FAKE_CLAUDE_BIN}${delimiter}${process.env.PATH ?? ""}`, CLAUDE_CONFIG_DIR: "" };
}

/** The lock the extension writes when the ide server starts (`~/.claude/ide/<port>.lock`). */
export interface IIdeLock {
    readonly port: number;
    readonly pid: number;
    readonly ideName: string;
    readonly workspaceFolders: readonly string[];
    readonly transport: string;
    readonly authToken: string;
}

export async function waitForIdeLock(home: string, timeoutMs = 60_000): Promise<IIdeLock> {
    const dir = join(home, ".claude", "ide");
    const file = await waitUntil(
        () => (existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith(".lock")) : undefined),
        (found) => found !== undefined,
        { describe: `лок ide-сервера в ${dir}`, timeoutMs, intervalMs: 250 },
    );
    const name = file ?? "";
    const body = JSON.parse(readFileSync(join(dir, name), "utf8")) as Omit<IIdeLock, "port">;
    return { ...body, port: Number(name.slice(0, -".lock".length)) };
}

interface IRpcMessage {
    readonly id?: number;
    readonly method?: string;
    readonly params?: Record<string, unknown>;
    readonly result?: unknown;
    readonly error?: unknown;
}

export interface IToolResult {
    readonly isError: boolean;
    readonly text: string;
}

/**
 * Connects like the CLI: port from the lock, `authToken` in `x-claude-code-ide-authorization`, MCP `initialize`.
 * The server holds a single client — a new connection kicks out the previous one.
 */
export class IdeProbe {
    public readonly notifications: { method: string; params: Record<string, unknown> }[] = [];
    private readonly pending = new Map<number, (message: IRpcMessage) => void>();
    private nextId = 0;

    private constructor(private readonly ws: WebSocket) {
        ws.on("message", (data: Buffer) => {
            const message = JSON.parse(data.toString()) as IRpcMessage;
            if (message.id !== undefined && this.pending.has(message.id)) {
                this.pending.get(message.id)?.(message);
                this.pending.delete(message.id);
            } else if (message.method !== undefined) {
                this.notifications.push({ method: message.method, params: message.params ?? {} });
            }
        });
    }

    public static async connect(
        lock: IIdeLock,
    ): Promise<{ probe: IdeProbe; serverInfo: { name: string; version: string } }> {
        const ws = new WebSocket(`ws://127.0.0.1:${String(lock.port)}`, {
            headers: { "x-claude-code-ide-authorization": lock.authToken },
        });
        await new Promise<void>((resolveOpen, reject) => {
            ws.once("open", () => {
                resolveOpen();
            });
            ws.once("error", reject);
        });
        const probe = new IdeProbe(ws);
        const init = (await probe.request("initialize", {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "diode-e2e-probe", version: "0" },
        })) as { serverInfo: { name: string; version: string } };
        ws.send(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
        return { probe, serverInfo: init.serverInfo };
    }

    public async request(method: string, params: unknown): Promise<unknown> {
        const id = ++this.nextId;
        const reply = new Promise<IRpcMessage>((resolveReply) => this.pending.set(id, resolveReply));
        this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
        const message = await reply;
        if (message.error !== undefined) throw new Error(`${method}: ${JSON.stringify(message.error)}`);
        return message.result;
    }

    public async callTool(name: string, args: Record<string, unknown>): Promise<IToolResult> {
        const result = (await this.request("tools/call", { name, arguments: args })) as {
            content: { type: string; text?: string }[];
            isError?: boolean;
        };
        return { isError: result.isError === true, text: result.content.map((c) => c.text ?? "").join("") };
    }

    /** Also searches notifications already received since connecting. */
    public async waitForNotification(
        method: string,
        predicate: (params: Record<string, unknown>) => boolean,
        timeoutMs = 10_000,
    ): Promise<Record<string, unknown>> {
        const found = await waitUntil(
            () => this.notifications.find((n) => n.method === method && predicate(n.params)),
            (n) => n !== undefined,
            {
                describe: `уведомление ${method} от ide-сервера`,
                timeoutMs,
                diagnose: () => `пришли: ${JSON.stringify(this.notifications)}`,
            },
        );
        return found?.params ?? {};
    }

    public close(): void {
        this.ws.close();
    }
}
