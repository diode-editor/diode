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
import { LifecycleServiceDIToken } from "../../workbench/services/lifecycle/browser/lifecycleService.ts";

/**
 * Дерево — в отдельном процессе: полный обход с подпиской на каждый каталог занимает секунды и в главном
 * цикле стоил отзывчивости на старте. Два токена на один объект осознанно: владельцу процесса нужен сам
 * `SubprocessTreeWatcher`. Снимается он в синхронной фазе прощания: при перезагрузке окна event loop дальше
 * блокируется, и процесс пережил бы окно со всеми inotify-подписками.
 */
export const fileWatcherModule: ContainerModule = (container) => {
    container.bind(
        IFileWatcherDIToken,
        () =>
            new ChokidarFileWatcher(
                container.get(ILogServiceDIToken).createLogger("files.watcher", { label: "File Watcher" }),
            ),
    );
    container.bind(SubprocessTreeWatcherDIToken, () => {
        const watcher = new SubprocessTreeWatcher({
            logger: container.get(ILogServiceDIToken).createLogger("files.watcher", { label: "File Watcher" }),
        });
        container.get(LifecycleServiceDIToken).onShutdownSync(() => {
            watcher.dispose();
        });
        return watcher;
    });
    container.bind(ITreeFileWatcherDIToken, () => container.get(SubprocessTreeWatcherDIToken));
};

export const fileWatcherModuleDefault: ContainerModule = (container) => {
    container.bind(IFileWatcherDIToken, () => NULL_FILE_WATCHER);
    container.bind(ITreeFileWatcherDIToken, () => NULL_TREE_FILE_WATCHER);
};
