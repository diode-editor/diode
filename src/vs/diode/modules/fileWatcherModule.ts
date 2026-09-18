import { NULL_FILE_WATCHER } from "../../platform/files/common/iFileWatcher.ts";
import { IFileWatcherDIToken } from "../../platform/files/common/iFileWatcherDIToken.ts";
import { NULL_TREE_FILE_WATCHER } from "../../platform/files/common/iTreeFileWatcher.ts";
import { ITreeFileWatcherDIToken } from "../../platform/files/common/iTreeFileWatcherDIToken.ts";
import { ChokidarFileWatcher } from "../../platform/files/node/chokidarFileWatcher.ts";
import { ChokidarTreeWatcher } from "../../platform/files/node/chokidarTreeWatcher.ts";
import { SharedTreeWatcher } from "../../platform/files/node/sharedTreeWatcher.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";

/**
 * Продакшен: реальные watcher'ы поверх chokidar — пофайловый (следит за
 * открытыми файлами и сигналит контроллеру о внешних изменениях) и по дереву
 * (`workspace.createFileSystemWatcher` расширений, встроенный git); второй —
 * за общей прослойкой {@link SharedTreeWatcher}, чтобы запросы на
 * пересекающиеся поддеревья не поднимали по независимому обходу каждый.
 * Ошибки watcher'а (ENOSPC и прочие отказы ОС) уходят в канал
 * `files.watcher`, а не роняют процесс.
 */
export const fileWatcherModule: ContainerModule = (container) => {
    container.bind(
        IFileWatcherDIToken,
        () => new ChokidarFileWatcher(container.get(ILogServiceDIToken).createLogger("files.watcher")),
    );
    container.bind(ITreeFileWatcherDIToken, () => {
        const logger = container.get(ILogServiceDIToken).createLogger("files.watcher");
        // SharedTreeWatcher поверх chokidar'а: запросы git'а и LSP-клиентов на
        // пересекающиеся поддеревья едут одним обходом, а не каждый своим.
        return new SharedTreeWatcher(new ChokidarTreeWatcher(logger), logger);
    });
};

/** Тесты/дефолт: no-op watcher'ы (live-watch выключен, если фейк не подставлен). */
export const fileWatcherModuleDefault: ContainerModule = (container) => {
    container.bind(IFileWatcherDIToken, () => NULL_FILE_WATCHER);
    container.bind(ITreeFileWatcherDIToken, () => NULL_TREE_FILE_WATCHER);
};
