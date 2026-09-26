import type { IClipboard } from "../../platform/clipboard/common/iClipboard.ts";
import type { IFileClipboard } from "../../platform/clipboard/common/iFileClipboard.ts";
import { InMemoryClipboard } from "../../platform/clipboard/common/inMemoryClipboard.ts";
import { InMemoryFileClipboard } from "../../platform/clipboard/common/inMemoryFileClipboard.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import type { IExternalOpener } from "../../platform/opener/common/iExternalOpener.ts";
import { ExternalOpenerDIToken } from "../../platform/opener/common/iExternalOpener.ts";
import { ClipboardDIToken, FileClipboardDIToken } from "../../workbench/common/coreTokens.ts";

/**
 * Открыватель, который ничего не открывает. Умолчание для тестов и headless:
 * запускать браузер там, где за экраном никого, нельзя — ссылка уедет тостом
 * (`OpenerService`), и её увидит тот, кто смотрит кадр.
 */
export const NULL_EXTERNAL_OPENER: IExternalOpener = {
    openExternal: () => Promise.resolve(false),
};

export interface BackendModuleContext {
    clipboard: IClipboard;
    /** Файловый буфер explorer. По умолчанию — in-memory; в будущем тут можно прокинуть нативную реализацию. */
    fileClipboard?: IFileClipboard;
    /** Системный открыватель ссылок. По умолчанию — {@link NULL_EXTERNAL_OPENER}. */
    externalOpener?: IExternalOpener;
}

/**
 * Внешние интеграции (clipboard, открыватель ссылок, в будущем — файловая
 * система и т.п.). `clipboard` передаётся явно. Если нужно умолчание — см.
 * `backendModuleDefault`.
 */
export const backendModule: ContainerModule<BackendModuleContext> = (
    container,
    { clipboard, fileClipboard, externalOpener },
) => {
    container.bind(ClipboardDIToken, () => clipboard);
    const files = fileClipboard ?? new InMemoryFileClipboard();
    container.bind(FileClipboardDIToken, () => files);
    const opener = externalOpener ?? NULL_EXTERNAL_OPENER;
    container.bind(ExternalOpenerDIToken, () => opener);
};

/** Shortcut: `backendModule` с дефолтным `InMemoryClipboard`. */
export const backendModuleDefault: ContainerModule = (container) => {
    const clipboard = new InMemoryClipboard();
    container.bind(ClipboardDIToken, () => clipboard);
    const fileClipboard = new InMemoryFileClipboard();
    container.bind(FileClipboardDIToken, () => fileClipboard);
    container.bind(ExternalOpenerDIToken, () => NULL_EXTERNAL_OPENER);
};
