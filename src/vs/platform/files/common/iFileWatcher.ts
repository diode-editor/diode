import type { IDisposable } from "../../../base/common/lifecycle.ts";

export interface IFileWatcher {
    /** Без разбора, что случилось: потребитель сверяется со stat сам. */
    watchFile(filePath: string, onChange: () => void): IDisposable;
}

export const NULL_FILE_WATCHER: IFileWatcher = {
    watchFile(): IDisposable {
        return {
            dispose: () => {
                /* no-op */
            },
        };
    },
};
