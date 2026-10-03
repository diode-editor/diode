import { Emitter } from "../../../base/common/event.ts";

import type { FileClipboardEntry, FileClipboardMode, IFileClipboard } from "./iFileClipboard.ts";

export class InMemoryFileClipboard implements IFileClipboard {
    private entry: FileClipboardEntry | null = null;
    private readonly onDidChangeEmitter = new Emitter<FileClipboardEntry | null>();
    public readonly onDidChange = this.onDidChangeEmitter.event;

    public read(): FileClipboardEntry | null {
        return this.entry;
    }

    public write(paths: string[], mode: FileClipboardMode): void {
        this.entry = { paths: [...paths], mode };
        this.notify();
    }

    public clear(): void {
        if (this.entry === null) return;
        this.entry = null;
        this.notify();
    }

    private notify(): void {
        this.onDidChangeEmitter.fire(this.entry);
    }
}
