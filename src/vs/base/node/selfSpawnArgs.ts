import { type ChildProcess, spawn } from "node:child_process";

import type { IProcessSnapshot } from "./restartProcess.ts";
import { currentProcessSnapshot } from "./restartProcess.ts";

export interface ISelfSpawnSpec {
    readonly command: string;
    readonly args: string[];
}

/** В dev `execArgv` несёт loader'ы вроде `tsx` — без них ребёнок не прочитает наш TypeScript. */
export function selfSpawnArgs(snapshot: IProcessSnapshot = currentProcessSnapshot()): ISelfSpawnSpec {
    if (snapshot.isSea) return { command: snapshot.execPath, args: [] };
    const mainScript = snapshot.argv.at(1);
    if (mainScript === undefined || mainScript === "") {
        throw new Error("selfSpawnArgs: cannot determine main script for dev subprocess");
    }
    return { command: snapshot.execPath, args: [...snapshot.execArgv, mainScript] };
}

/** Развилку по флагу держит `main.ts`. */
export type SelfProcessRole = "DIODE_FILE_WATCHER" | "DIODE_EXTENSION_HOST";

export interface ISpawnSelfAsRoleOptions {
    /** Без `"inherit"`: печать ребёнка в общий терминал испортила бы кадр TUI. */
    readonly stdout?: "ignore" | "pipe";
    readonly stderr: "ignore" | "pipe";
    readonly spec?: ISelfSpawnSpec;
    readonly env?: NodeJS.ProcessEnv;
    /**
     * Своя группа процессов (posix): сигнал выключения достаёт внуков — языковые
     * серверы расширений, иначе они остаются сиротами. Плата: SIGINT терминала
     * ребёнку больше не приходит, снимать его обязан владелец.
     */
    readonly ownProcessGroup?: boolean;
}

export function spawnSelfAsRole(role: SelfProcessRole, options: ISpawnSelfAsRoleOptions): ChildProcess {
    const spec = options.spec ?? selfSpawnArgs();
    return spawn(spec.command, spec.args, {
        stdio: ["ignore", options.stdout ?? "ignore", options.stderr, "ipc"],
        env: { ...(options.env ?? process.env), [role]: "1" },
        // Stryker disable next-line ConditionalExpression,StringLiteral: на posix-раннере `platform !== "win32"` всегда истинно — мутант эквивалентен; ветку win32 закрывает e2e на windows
        detached: options.ownProcessGroup === true && process.platform !== "win32",
    });
}
