import { existsSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import WebSocket from "ws";

import { waitUntil } from "./waitFor.ts";

// Общее у тестов стокового Anthropic.claude-code (смоук магазина, e2e
// claudeCode, сценарий claude-code): окружение сессии и пробный клиент
// ide-сервера расширения вместо настоящего `claude` — тот требует подписку и
// сеть и в тестах не запускается (docs/TODO/ClaudeCode.md, «Живая проверка
// контекста»).

/** id записи в магазине. */
export const CLAUDE_CODE_ID = "Anthropic.claude-code";

/** Каталог с подставным `claude` (sh-скрипт): кладётся первым в PATH сессии. */
export const FAKE_CLAUDE_BIN = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "..",
    "fixtures",
    "fakeClaude",
    "bin",
);

/**
 * Env сессии: подставной `claude` первым в PATH (терминальный режим набирает
 * голое `claude`, а на машине разработчика настоящий CLI в PATH есть) и пустой
 * `CLAUDE_CONFIG_DIR` — расширение и CLI проверяют его на истинность, и лок
 * ложится в изолированный `$HOME/.claude`, а не в унаследованный каталог хоста.
 */
export function claudeCodeSessionEnv(): Record<string, string> {
    return { PATH: `${FAKE_CLAUDE_BIN}${delimiter}${process.env.PATH ?? ""}`, CLAUDE_CONFIG_DIR: "" };
}

/** Лок, который расширение пишет при старте ide-сервера (`~/.claude/ide/<port>.lock`). */
export interface IIdeLock {
    readonly port: number;
    readonly pid: number;
    readonly ideName: string;
    readonly workspaceFolders: readonly string[];
    readonly transport: string;
    readonly authToken: string;
}

/** Ждёт лок ide-сервера в изолированном HOME сессии. */
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

/** Результат `tools/call` по MCP: текстовые части ответа и флаг ошибки. */
export interface IToolResult {
    readonly isError: boolean;
    readonly text: string;
}

/**
 * Клиент ide-сервера так, как к нему ходит CLI: WebSocket на порт из лока,
 * `authToken` в заголовке `x-claude-code-ide-authorization`, MCP `initialize`.
 * Копит уведомления сервера (`selection_changed`, `at_mentioned`, …). Сервер
 * держит одного клиента: новое подключение выбивает прежнее.
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

    /** Подключается и проходит MCP-рукопожатие; отдаёт `serverInfo` ответа `initialize`. */
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

    /** Вызывает MCP-инструмент расширения (`getDiagnostics`, `openDiff`, …). */
    public async callTool(name: string, args: Record<string, unknown>): Promise<IToolResult> {
        const result = (await this.request("tools/call", { name, arguments: args })) as {
            content: { type: string; text?: string }[];
            isError?: boolean;
        };
        return { isError: result.isError === true, text: result.content.map((c) => c.text ?? "").join("") };
    }

    /** Ждёт уведомление `method`, удовлетворяющее `predicate`, среди пришедших с подключения. */
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
