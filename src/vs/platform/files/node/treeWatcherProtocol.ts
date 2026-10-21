import type { ITreeFileChange, ITreeFileWatchOptions } from "../common/iTreeFileWatcher.ts";

// The transport is node IPC, i.e. JSON. Notifications only, no request/response:
// a round-trip at startup is exactly the main-loop delay the walk moved to its own
// process to avoid.
//
// The discriminant and routing fields are validated, the event batch is taken as is:
// the other end is our `ChokidarTreeWatcher`, and validating thousands of paths one by
// one would put the work back on the main loop.

export type TreeWatcherLogLevel = "trace" | "debug" | "info" | "warn" | "error";

export type ITreeWatcherRequest =
    | {
          readonly t: "watch";
          /** Never reused. */
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
          /** Already passed through JSON. */
          readonly args: readonly unknown[];
      };

// `Set<unknown>`: `has` itself rejects non-strings.
const LOG_LEVELS = new Set<unknown>(["trace", "debug", "info", "warn", "error"]);

/** `null` means not our message. */
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

/** `null` means not our message. */
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

// No `null` check on purpose: `typeof null === "object"`, and the same `null` is returned.
function asRecord(raw: unknown): Record<string, unknown> | null {
    return typeof raw === "object" ? (raw as Record<string, unknown> | null) : null;
}
