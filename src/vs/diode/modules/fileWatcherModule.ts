import { NULL_FILE_WATCHER } from "../../platform/files/common/iFileWatcher.ts";
import { IFileWatcherDIToken } from "../../platform/files/common/iFileWatcherDIToken.ts";
import { NULL_TREE_FILE_WATCHER } from "../../platform/files/common/iTreeFileWatcher.ts";
import { ITreeFileWatcherDIToken } from "../../platform/files/common/iTreeFileWatcherDIToken.ts";
import { ChokidarFileWatcher } from "../../platform/files/node/chokidarFileWatcher.ts";
import {
    SubprocessTreeWatcher,
    SubprocessTreeWatcherDIToken,
} from "../../platform/files/node/subprocessTreeWatcher.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";

/**
 * Продакшен: реальные watcher'ы — пофайловый на chokidar прямо здесь (следит за
 * открытыми файлами и сигналит контроллеру о внешних изменениях) и по дереву
 * (`workspace.createFileSystemWatcher` расширений, встроенный git) — в
 * **отдельном процессе**: полный обход дерева с подпиской на каждый каталог
 * измеряется секундами и в главном цикле стоил редактору отзывчивости на
 * старте. Здесь остаётся прокси, за границей — `ChokidarTreeWatcher` под
 * `SharedTreeWatcher` (см. `treeWatcherMain.ts`).
 *
 * Ошибки watcher'а (ENOSPC и прочие отказы ОС) приезжают из того процесса
 * в тот же канал `files.watcher`, а не роняют редактор.
 *
 * Два токена на один объект — осознанно: потребители видят интерфейс, а `main.ts`
 * нужен сам владелец процесса, чтобы синхронно снять его при перезагрузке окна.
 */
export const fileWatcherModule: ContainerModule = (container) => {
    container.bind(
        IFileWatcherDIToken,
        () => new ChokidarFileWatcher(container.get(ILogServiceDIToken).createLogger("files.watcher")),
    );
    container.bind(
        SubprocessTreeWatcherDIToken,
        () => new SubprocessTreeWatcher({ logger: container.get(ILogServiceDIToken).createLogger("files.watcher") }),
    );
    container.bind(ITreeFileWatcherDIToken, () => container.get(SubprocessTreeWatcherDIToken));
};

/** Тесты/дефолт: no-op watcher'ы (live-watch выключен, если фейк не подставлен). */
export const fileWatcherModuleDefault: ContainerModule = (container) => {
    container.bind(IFileWatcherDIToken, () => NULL_FILE_WATCHER);
    container.bind(ITreeFileWatcherDIToken, () => NULL_TREE_FILE_WATCHER);
};
