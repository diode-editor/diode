import { readFileSync } from "node:fs";

import type { IRandomAccessFile, IRandomAccessFileOpener } from "../vs/platform/files/common/iRandomAccessFile.ts";

export interface IMemoryRandomAccessFileOptions {
    /**
     * The size the file reports, when it is not the bytes' length: a "huge" file whose reads end early, so the
     * indexing pass has a tail to wait for (or a size no string can hold) without the bytes on disk.
     */
    readonly size?: number;
    /** Async reads wait for {@link MemoryRandomAccessFile.release}: the test steps the indexing pass by hand. */
    readonly gated?: boolean;
}

/** An in-memory `IRandomAccessFile`: async reads resolve on a later tick, as `fs.read` does. */
export class MemoryRandomAccessFile implements IRandomAccessFile {
    public readonly size: number;
    public syncReads = 0;
    public asyncReads = 0;
    public disposed = false;
    public disposals = 0;
    /** When set, every async read rejects with it. */
    public failAsync: Error | null = null;
    /** Truncation under the indexing pass: reads past this many bytes return nothing. */
    public visibleSize: number;
    private gated: boolean;
    private waiting: (() => void)[] = [];

    public constructor(
        private bytes: Buffer,
        options: IMemoryRandomAccessFileOptions = {},
    ) {
        this.size = options.size ?? bytes.length;
        this.visibleSize = bytes.length;
        this.gated = options.gated ?? false;
    }

    public readSync(target: Uint8Array, position: number): number {
        this.syncReads++;
        const count = Math.max(0, Math.min(target.length, this.visibleSize - position));
        // Past the end of the bytes: `copy` would throw on the source offset, a file just reads nothing.
        if (count > 0) this.bytes.copy(target, 0, position, position + count);
        return count;
    }

    public async read(target: Uint8Array, position: number): Promise<number> {
        this.asyncReads++;
        if (this.gated) {
            await new Promise<void>((resolve) => this.waiting.push(resolve));
        } else {
            await new Promise((resolve) => setImmediate(resolve));
        }
        if (this.failAsync !== null) throw this.failAsync;
        return this.readSync(target, position);
    }

    /** All the bytes, the hidden tail included. */
    public get length(): number {
        return this.bytes.length;
    }

    /** The file grows under the open document (follow): the new text is readable at once. */
    public append(more: string): void {
        this.bytes = Buffer.concat([this.bytes, Buffer.from(more)]);
        this.visibleSize = this.bytes.length;
    }

    /** The file is truncated and rewritten in place (same inode): the old bytes are gone. */
    public rewrite(content: string): void {
        this.bytes = Buffer.from(content);
        this.visibleSize = this.bytes.length;
    }

    /** How many async reads are waiting for {@link release}. */
    public get pendingReads(): number {
        return this.waiting.length;
    }

    /** Lets the oldest waiting read proceed. */
    public release(): void {
        this.waiting.shift()?.();
    }

    /** From now on reads go through on their own; the waiting ones too. */
    public openGate(): void {
        this.gated = false;
        for (const resolve of this.waiting.splice(0)) resolve();
    }

    public dispose(): void {
        this.disposed = true;
        this.disposals++;
        for (const resolve of this.waiting.splice(0)) resolve();
    }
}

/** Opens the file's bytes from disk into a {@link MemoryRandomAccessFile}; the opened files are kept for the test to inspect. */
export function memoryFileOpener(options: IMemoryRandomAccessFileOptions = {}): IRandomAccessFileOpener & {
    readonly opened: MemoryRandomAccessFile[];
} {
    const opened: MemoryRandomAccessFile[] = [];
    return {
        opened,
        open: (path) => {
            const file = new MemoryRandomAccessFile(readFileSync(path), options);
            opened.push(file);
            return file;
        },
    };
}
