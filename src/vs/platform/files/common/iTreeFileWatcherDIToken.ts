import { token } from "../../instantiation/common/diContainer.ts";

import type { ITreeFileWatcher } from "./iTreeFileWatcher.ts";

/**
 * DI-токен наблюдателя за деревом каталогов. Интерфейс {@link ITreeFileWatcher}
 * и no-op `NULL_TREE_FILE_WATCHER` живут в Common (чистый IO-примитив); сам
 * токен — здесь, т.к. объявлять DI-токены можно только на уровнях Workbench/App.
 */
export const ITreeFileWatcherDIToken = token<ITreeFileWatcher>("ITreeFileWatcher");
