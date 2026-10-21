import type { ILogSink, LogEntry } from "./iLogService.ts";

export interface RingBufferSinkOptions {
    /** На канал; по умолчанию 1000. */
    readonly capacityPerChannel?: number;
    /** Зовётся ПОСЛЕ записи в буфер. */
    readonly onAppend?: (entry: LogEntry) => void;
}

export class RingBufferSink implements ILogSink {
    private readonly capacity: number;
    private readonly buffers = new Map<string, LogEntry[]>();
    private readonly onAppendCb: ((entry: LogEntry) => void) | undefined;

    public constructor(options: RingBufferSinkOptions = {}) {
        this.capacity = options.capacityPerChannel ?? 1000;
        this.onAppendCb = options.onAppend;
    }

    public append(entry: LogEntry): void {
        let buf = this.buffers.get(entry.channel);
        if (buf === undefined) {
            buf = [];
            this.buffers.set(entry.channel, buf);
        }
        buf.push(entry);
        if (buf.length > this.capacity) {
            buf.splice(0, buf.length - this.capacity);
        }
        this.onAppendCb?.(entry);
    }

    public getEntries(channel: string): readonly LogEntry[] {
        return this.buffers.get(channel) ?? [];
    }

    public getChannels(): readonly string[] {
        return [...this.buffers.keys()];
    }

    public clear(channel?: string): void {
        if (channel === undefined) {
            this.buffers.clear();
        } else {
            this.buffers.delete(channel);
        }
    }

    public dispose(): void {
        this.buffers.clear();
    }
}
