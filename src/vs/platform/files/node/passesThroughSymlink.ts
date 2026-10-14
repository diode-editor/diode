import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Лежит ли путь `root/relative` за симлинком (на Windows — и junction): сам он
 * или каталог по пути к нему от `root`. За ссылку обход `root` не заходит.
 * Синхронно: зовётся при заведении подписки, по `lstat` на сегмент. Пути нет —
 * не ссылка: появится каталогом, и обход предка его увидит.
 *
 * Отдельным модулем, а не в `sharedTreeWatcher.ts`: её зовёт и редактор
 * (`watcherIncludes.ts`), а сам `SharedTreeWatcher` живёт только в watcher-процессе
 * (кусок `roles/file-watcher`) — импорт из него тянул бы обход дерева в `main.js`.
 */
export function passesThroughSymlink(root: string, relative: string): boolean {
    let current = root;
    for (const segment of relative.split(path.sep)) {
        current = path.join(current, segment);
        let stat: fs.Stats;
        try {
            stat = fs.lstatSync(current);
        } catch {
            return false;
        }
        if (stat.isSymbolicLink()) return true;
    }
    return false;
}
