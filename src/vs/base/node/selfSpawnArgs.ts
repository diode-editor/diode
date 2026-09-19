import type { IProcessSnapshot } from "./restartProcess.ts";
import { currentProcessSnapshot } from "./restartProcess.ts";

/** Чем и с какими аргументами запускать копию самого себя. */
export interface ISelfSpawnSpec {
    readonly command: string;
    readonly args: string[];
}

/**
 * Аргументы для запуска **самого себя** ещё одним процессом — того же бинаря в
 * другой роли (extension host, watcher-процесс). Роль выбирается env-флагом,
 * который выставляет спавнящая сторона, а развилку по флагам держит `main.ts`.
 *
 * Как добраться до собственной программы, зависит от сборки: у SEA-бинаря это
 * сам `execPath` без аргументов (main-скрипта нет — он внутри), в dev —
 * `node <execArgv> <главный скрипт>` (`execArgv` несёт loader'ы вроде `tsx`,
 * без них ребёнок не прочитает наш TypeScript).
 *
 * Та же развилка, но с пользовательскими аргументами на хвосте, живёт в
 * `restartArgs` (там же, `restartProcess.ts`) — там это «перезапусти окно», здесь «заведи субпроцесс».
 *
 * Снимок процесса — параметр, а не чтение `process` внутри: так развилку можно
 * проверить обеими ветками, не подменяя глобальное окружение.
 */
export function selfSpawnArgs(snapshot: IProcessSnapshot = currentProcessSnapshot()): ISelfSpawnSpec {
    if (snapshot.isSea) return { command: snapshot.execPath, args: [] };
    const mainScript = snapshot.argv.at(1);
    if (mainScript === undefined || mainScript === "") {
        throw new Error("selfSpawnArgs: cannot determine main script for dev subprocess");
    }
    return { command: snapshot.execPath, args: [...snapshot.execArgv, mainScript] };
}
