import type { IDisposable } from "@tuidom/core/common/disposable";

import type { FileClipboardEntry, FileClipboardMode, IFileClipboard } from "./iFileClipboard.ts";

export class InMemoryFileClipboard implements IFileClipboard {
    private entry: FileClipboardEntry | null = null;
    private listeners: ((entry: FileClipboardEntry | null) => void)[] = [];

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

    public onDidChange(listener: (entry: FileClipboardEntry | null) => void): IDisposable {
        this.listeners.push(listener);
        return {
            dispose: () => {
                const index = this.listeners.indexOf(listener);
                if (index >= 0) this.listeners.splice(index, 1);
            },
        };
    }

    private notify(): void {
        for (const listener of this.listeners) {
            listener(this.entry);
        }
    }
}
