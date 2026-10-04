import { type ChildProcess, spawn } from "node:child_process";

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

/** Роль, в которой редактор запускает сам себя; развилку по флагу держит `main.ts`. */
export type SelfProcessRole = "DIODE_FILE_WATCHER" | "DIODE_EXTENSION_HOST";

export interface ISpawnSelfAsRoleOptions {
    /**
     * stdout ребёнка: закрыт (`"ignore"`) или читается нами (`"pipe"`).
     * `"inherit"` типом не допускается — ребёнок делит терминал с редактором, и
     * любая его печать испортила бы кадр TUI.
     */
    readonly stdout?: "ignore" | "pipe";
    /** stderr ребёнка — по тем же причинам без `"inherit"`. */
    readonly stderr: "ignore" | "pipe";
    /** Чем запускать; по умолчанию {@link selfSpawnArgs} (шов для тестов). */
    readonly spec?: ISelfSpawnSpec;
    /** Окружение ребёнка до флага роли; по умолчанию `process.env`. */
    readonly env?: NodeJS.ProcessEnv;
}

/**
 * Запуск себя ещё одним процессом в роли (watcher, extension host): тот же
 * бинарь, флаг роли в env, IPC-канал четвёртым stdio. Аналог upstream
 * `base/parts/ipc/node/ipc.cp.ts` `Client` по обязанностям спавна; жизненный
 * цикл (error/exit/stdio) — `GuardedChildProcess`.
 */
export function spawnSelfAsRole(role: SelfProcessRole, options: ISpawnSelfAsRoleOptions): ChildProcess {
    const spec = options.spec ?? selfSpawnArgs();
    return spawn(spec.command, spec.args, {
        stdio: ["ignore", options.stdout ?? "ignore", options.stderr, "ipc"],
        env: { ...(options.env ?? process.env), [role]: "1" },
    });
}
