import * as fs from "node:fs";
import * as path from "node:path";

/**
 * На Windows — и junction. Пути нет — не ссылка: появится каталогом, и обход
 * предка его увидит. Отдельным модулем: её зовёт и редактор, а импорт из
 * `sharedTreeWatcher.ts` тянул бы обход дерева в `main.cjs`.
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
