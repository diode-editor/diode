import { token } from "../../instantiation/common/diContainer.ts";

import type { IFileWatcher } from "./iFileWatcher.ts";

export const IFileWatcherDIToken = token<IFileWatcher>("IFileWatcher");
