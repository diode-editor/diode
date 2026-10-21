import type { IDisposable } from "../../../base/common/lifecycle.ts";

export interface IFileWatcher {
    /** Doesn't say what happened: the consumer checks stat itself. */
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
