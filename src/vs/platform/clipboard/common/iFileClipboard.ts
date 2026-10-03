import type { IDisposable } from "../../../base/common/lifecycle.ts";

export type FileClipboardMode = "copy" | "cut";

export interface FileClipboardEntry {
    readonly paths: string[];
    readonly mode: FileClipboardMode;
}

/**
 * Внутренний буфер обмена для файловых операций (copy/cut/paste в explorer).
 * Намеренно отделён от текстового {@link IClipboard}: файловый буфер хранит набор
 * путей и режим, а не текст. Прячет состояние за интерфейсом, чтобы в будущем
 * можно было подменить на нативную интеграцию с буфером ОС, не трогая команды и UI.
 */
export interface IFileClipboard {
    read(): FileClipboardEntry | null;
    write(paths: string[], mode: FileClipboardMode): void;
    clear(): void;
    /** Подписка на изменения. Слушатель НЕ вызывается немедленно. */
    onDidChange(listener: (entry: FileClipboardEntry | null) => void): IDisposable;
}
