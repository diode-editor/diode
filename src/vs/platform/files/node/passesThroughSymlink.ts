import * as fs from "node:fs";
import * as path from "node:path";

/**
 * On Windows, junctions too. A missing path is not a link: it will appear as a directory, and
 * the ancestor's traversal will see it. A separate module because the editor calls it too, and
 * importing from `sharedTreeWatcher.ts` would pull tree walking into `main.cjs`.
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
