import type { ITreeFileChange, ITreeFileWatchOptions } from "../common/iTreeFileWatcher.ts";

// Транспорт — node IPC, то есть JSON. Только уведомления, без request/response:
// round-trip на старте — та задержка главного цикла, от которой обход и уехал
// в свой процесс.
//
// Проверяются дискриминант и поля маршрутизации, пачка событий — как есть: на
// том конце наш `ChokidarTreeWatcher`, а поэлементная проверка тысяч путей
// вернула бы работу на главный цикл.

export type TreeWatcherLogLevel = "trace" | "debug" | "info" | "warn" | "error";

export type ITreeWatcherRequest =
    | {
          readonly t: "watch";
          /** Не переиспользуется. */
          readonly id: number;
          readonly rootPath: string;
          readonly options: ITreeFileWatchOptions;
      }
    | { readonly t: "unwatch"; readonly id: number };

export type ITreeWatcherResponse =
    | { readonly t: "changes"; readonly id: number; readonly changes: readonly ITreeFileChange[] }
    | {
          readonly t: "log";
          readonly level: TreeWatcherLogLevel;
          readonly message: string;
          /** Уже проведённый через JSON. */
          readonly args: readonly unknown[];
      };

// `Set<unknown>`: не-строку отсеивает сам `has`.
const LOG_LEVELS = new Set<unknown>(["trace", "debug", "info", "warn", "error"]);

/** `null` — не наше сообщение. */
export function parseTreeWatcherRequest(raw: unknown): ITreeWatcherRequest | null {
    const message = asRecord(raw);
    if (message === null || typeof message.id !== "number") return null;
    if (message.t === "unwatch") return { t: "unwatch", id: message.id };
    if (message.t !== "watch" || typeof message.rootPath !== "string") return null;
    const options = asRecord(message.options);
    if (options === null || typeof options.recursive !== "boolean" || !Array.isArray(options.excludes)) return null;
    return {
        t: "watch",
        id: message.id,
        rootPath: message.rootPath,
        options: { recursive: options.recursive, excludes: options.excludes as readonly string[] },
    };
}

/** `null` — не наше сообщение. */
export function parseTreeWatcherResponse(raw: unknown): ITreeWatcherResponse | null {
    const message = asRecord(raw);
    if (message === null) return null;
    if (message.t === "changes") {
        if (typeof message.id !== "number" || !Array.isArray(message.changes)) return null;
        return { t: "changes", id: message.id, changes: message.changes as readonly ITreeFileChange[] };
    }
    if (message.t !== "log") return null;
    if (!LOG_LEVELS.has(message.level)) return null;
    if (typeof message.message !== "string" || !Array.isArray(message.args)) return null;
    return {
        t: "log",
        level: message.level as TreeWatcherLogLevel,
        message: message.message,
        args: message.args as readonly unknown[],
    };
}

// Проверки на `null` нет намеренно: `typeof null === "object"`, и вернётся тот же `null`.
function asRecord(raw: unknown): Record<string, unknown> | null {
    return typeof raw === "object" ? (raw as Record<string, unknown> | null) : null;
}
