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
    /** Слушатель НЕ вызывается немедленно. */
    onDidChange(listener: (entry: FileClipboardEntry | null) => void): IDisposable;
}

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const FileClipboardDIToken = token<IFileClipboard>("FileClipboard");
