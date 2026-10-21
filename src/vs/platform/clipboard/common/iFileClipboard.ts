import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { token } from "../../instantiation/common/diContainer.ts";

export type FileClipboardMode = "copy" | "cut";

export interface FileClipboardEntry {
    readonly paths: string[];
    readonly mode: FileClipboardMode;
}

export interface IFileClipboard {
    read(): FileClipboardEntry | null;
    write(paths: string[], mode: FileClipboardMode): void;
    clear(): void;
    /** The listener is NOT called immediately. */
    onDidChange(listener: (entry: FileClipboardEntry | null) => void): IDisposable;
}

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by its reference; the string inside is only a debug label
export const FileClipboardDIToken = token<IFileClipboard>("FileClipboard");
