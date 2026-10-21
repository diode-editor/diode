import * as fs from "node:fs";

import type { ILogSink, LogEntry } from "../common/iLogService.ts";
import { logLevelName } from "../common/logLevel.ts";

export interface FileSinkOptions {
    /** `"w"`: each run overwrites the file, `"a"`: history accumulates. */
    readonly flags?: "w" | "a";
}

/** Write errors are swallowed: the sink doesn't crash the process. */
export class FileSink implements ILogSink {
    private stream: fs.WriteStream | null;
    private disposed = false;

    public constructor(filePath: string, options: FileSinkOptions = {}) {
        try {
            this.stream = fs.createWriteStream(filePath, { flags: options.flags ?? "w" });
            this.stream.on("error", () => {
                // silently: the sink must not crash the process
            });
        } catch {
            this.stream = null;
        }
    }

    public append(entry: LogEntry): void {
        if (this.disposed) return;
        const stream = this.stream;
        if (stream === null) return;
        const line = formatEntry(entry);
        try {
            stream.write(line);
        } catch {
            // ignore
        }
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        const stream = this.stream;
        this.stream = null;
        if (stream !== null) {
            try {
                stream.end();
            } catch {
                // ignore
            }
        }
    }
}

function formatEntry(entry: LogEntry): string {
    const ts = new Date(entry.timestamp).toISOString();
    const lvl = logLevelName(entry.level).toUpperCase().padEnd(5, " ");
    let line = `[${ts}] [${lvl}] [${entry.channel}] ${entry.message}`;
    if (entry.args.length > 0) {
        for (const arg of entry.args) {
            line += "\t" + safeStringify(arg);
        }
    }
    return line + "\n";
}

function safeStringify(v: unknown): string {
    if (v instanceof Error) {
        return v.stack ?? `${v.name}: ${v.message}`;
    }
    if (typeof v === "string") return v;
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
}
