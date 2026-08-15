import type { IClipboard } from "../../platform/clipboard/common/iClipboard.ts";
import type { IFileClipboard } from "../../platform/clipboard/common/iFileClipboard.ts";
import { InMemoryClipboard } from "../../platform/clipboard/common/inMemoryClipboard.ts";
import { InMemoryFileClipboard } from "../../platform/clipboard/common/inMemoryFileClipboard.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { ClipboardDIToken, FileClipboardDIToken } from "../../workbench/common/coreTokens.ts";

export interface BackendModuleContext {
    clipboard: IClipboard;
    /** Файловый буфер explorer. По умолчанию — in-memory; в будущем тут можно прокинуть нативную реализацию. */
    fileClipboard?: IFileClipboard;
}

/**
 * Внешние интеграции (clipboard, в будущем — файловая система и т.п.).
 * `clipboard` передаётся явно. Если нужно умолчание — см. `backendModuleDefault`.
 */
export const backendModule: ContainerModule<BackendModuleContext> = (container, { clipboard, fileClipboard }) => {
    container.bind(ClipboardDIToken, () => clipboard);
    const files = fileClipboard ?? new InMemoryFileClipboard();
    container.bind(FileClipboardDIToken, () => files);
};

/** Shortcut: `backendModule` с дефолтным `InMemoryClipboard`. */
export const backendModuleDefault: ContainerModule = (container) => {
    const clipboard = new InMemoryClipboard();
    container.bind(ClipboardDIToken, () => clipboard);
    const fileClipboard = new InMemoryFileClipboard();
    container.bind(FileClipboardDIToken, () => fileClipboard);
};
