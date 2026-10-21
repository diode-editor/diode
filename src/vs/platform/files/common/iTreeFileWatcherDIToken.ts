import { token } from "../../instantiation/common/diContainer.ts";

import type { ITreeFileWatcher } from "./iTreeFileWatcher.ts";

export const ITreeFileWatcherDIToken = token<ITreeFileWatcher>("ITreeFileWatcher");
