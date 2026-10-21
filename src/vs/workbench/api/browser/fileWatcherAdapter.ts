import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { ITreeFileChange, ITreeFileWatcher } from "../../../platform/files/common/iTreeFileWatcher.ts";
import type { IExtensionFileWatcher } from "../common/iExtensionFileWatcher.ts";

/**
 * Excludes `files.watcherExclude` и корни `files.watcherInclude` (симлинки, за которые обход не
 * заходит) читаются на каждый `watch()`: настройка живая.
 */
export class FileWatcherAdapter implements IExtensionFileWatcher {
    public constructor(
        private readonly watcher: ITreeFileWatcher,
        private readonly excludes: () => readonly string[],
        private readonly includesUnder: (base: string) => readonly string[] = () => [],
    ) {}

    public watch(
        base: string,
        recursive: boolean,
        onChanges: (changes: readonly ITreeFileChange[]) => void,
    ): IDisposable {
        const options = { recursive, excludes: this.excludes() };
        const main = this.watcher.watchTree(base, options, onChanges);
        // Нерекурсивному watcher'у поддерево не нужно — и include тоже.
        if (!recursive) return main;
        const extra = this.includesUnder(base).map((include) => this.watcher.watchTree(include, options, onChanges));
        return {
            dispose: () => {
                main.dispose();
                for (const subscription of extra) subscription.dispose();
            },
        };
    }
}
