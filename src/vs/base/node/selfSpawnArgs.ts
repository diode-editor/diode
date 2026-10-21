import { type ChildProcess, spawn } from "node:child_process";

import type { IProcessSnapshot } from "./restartProcess.ts";
import { currentProcessSnapshot } from "./restartProcess.ts";

export interface ISelfSpawnSpec {
    readonly command: string;
    readonly args: string[];
}

/** In dev `execArgv` carries loaders like `tsx`; without them the child can't read our TypeScript. */
export function selfSpawnArgs(snapshot: IProcessSnapshot = currentProcessSnapshot()): ISelfSpawnSpec {
    if (snapshot.isSea) return { command: snapshot.execPath, args: [] };
    const mainScript = snapshot.argv.at(1);
    if (mainScript === undefined || mainScript === "") {
        throw new Error("selfSpawnArgs: cannot determine main script for dev subprocess");
    }
    return { command: snapshot.execPath, args: [...snapshot.execArgv, mainScript] };
}

/** `main.ts` owns the branching on the flag. */
export type SelfProcessRole = "DIODE_FILE_WATCHER" | "DIODE_EXTENSION_HOST";

export interface ISpawnSelfAsRoleOptions {
    /** Not `"inherit"`: the child printing to the shared terminal would corrupt the TUI frame. */
    readonly stdout?: "ignore" | "pipe";
    readonly stderr: "ignore" | "pipe";
    readonly spec?: ISelfSpawnSpec;
    readonly env?: NodeJS.ProcessEnv;
    /**
     * Its own process group (posix): the shutdown signal reaches grandchildren, the extensions'
     * language servers, otherwise they are left orphaned. The cost: the terminal's SIGINT
     * no longer reaches the child, the owner must handle it.
     */
    readonly ownProcessGroup?: boolean;
}

export function spawnSelfAsRole(role: SelfProcessRole, options: ISpawnSelfAsRoleOptions): ChildProcess {
    const spec = options.spec ?? selfSpawnArgs();
    return spawn(spec.command, spec.args, {
        stdio: ["ignore", options.stdout ?? "ignore", options.stderr, "ipc"],
        env: { ...(options.env ?? process.env), [role]: "1" },
        // Stryker disable next-line ConditionalExpression,StringLiteral: on a posix runner `platform !== "win32"` is always true, the mutant is equivalent; e2e on windows covers the win32 branch
        detached: options.ownProcessGroup === true && process.platform !== "win32",
    });
}
