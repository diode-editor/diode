import type { ITreeFileChange, ITreeFileWatchOptions } from "../common/iTreeFileWatcher.ts";

/**
 * Протокол между редактором и watcher-процессом (`SubprocessTreeWatcher` ↔
 * `treeWatcherMain`). Транспорт — node IPC-канал субпроцесса, то есть JSON:
 * всё, что здесь описано, обязано переживать `JSON.stringify`.
 *
 * Сообщений четыре, и request/response среди них нет — обе стороны говорят
 * только уведомлениями. Так и должно быть: ответа здесь ждать не от чего
 * (`watchTree` синхронно возвращает disposable, а события идут потоком), а
 * лишний round-trip на старте — ровно та задержка главного цикла, ради ухода
 * от которой обход и переехал в свой процесс.
 *
 * Глубина валидации выбрана сознательно: проверяются дискриминант и поля, по
 * которым сообщение маршрутизируется, а содержимое пачки событий принимается
 * как есть. На том конце не расширение, а наш же `ChokidarTreeWatcher`, зато
 * пачка бывает в тысячи путей — поэлементная проверка вернула бы на главный
 * цикл ту самую работу, которую мы с него сняли.
 */

/** Уровень записи лога, пересылаемой из watcher-процесса. */
export type TreeWatcherLogLevel = "trace" | "debug" | "info" | "warn" | "error";

/** Редактор → watcher-процесс. */
export type ITreeWatcherRequest =
    | {
          readonly t: "watch";
          /** Идентификатор запроса; уникален в пределах хоста и не переиспользуется. */
          readonly id: number;
          readonly rootPath: string;
          readonly options: ITreeFileWatchOptions;
      }
    | { readonly t: "unwatch"; readonly id: number };

/** Watcher-процесс → редактор. */
export type ITreeWatcherResponse =
    | { readonly t: "changes"; readonly id: number; readonly changes: readonly ITreeFileChange[] }
    | {
          readonly t: "log";
          readonly level: TreeWatcherLogLevel;
          readonly message: string;
          /** Хвост аргументов `ILogger` — уже проведённый через JSON. */
          readonly args: readonly unknown[];
      };

// `Set<unknown>`, а не `Set<string>`: тогда не-строка отсеивается самим `has`,
// и отдельная проверка типа не нужна.
const LOG_LEVELS = new Set<unknown>(["trace", "debug", "info", "warn", "error"]);

/** Разбирает сообщение редактора; `null` — не наше сообщение. */
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

/** Разбирает сообщение watcher-процесса; `null` — не наше сообщение. */
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

/**
 * `raw` как объект с полями, либо `null`. Отдельной проверки на `null` нет
 * намеренно: `typeof null === "object"`, но полей у него нет — и вернуть его
 * как «нет объекта» это ровно то же самое `null`.
 */
function asRecord(raw: unknown): Record<string, unknown> | null {
    return typeof raw === "object" ? (raw as Record<string, unknown> | null) : null;
}
