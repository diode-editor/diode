import { spawnSync } from "node:child_process";

import { isSeaBinary } from "./isSea.ts";

/**
 * Перезапуск самого себя с теми же аргументами — «перезагрузка окна» (аналог
 * `workbench.action.reloadWindow` в VS Code). Мы одно-процессное TUI-приложение,
 * отдельного «main process» у нас нет, поэтому окно перезагружается только
 * заменой процесса.
 *
 * Наивный `spawn + exit` тут не работает: родитель, уйдя в exit, вернёт
 * терминал шеллу, и приглашение будет драться за экран с новым окном. Поэтому
 * первый reload превращает текущий процесс в **супервизор** — он держит
 * терминал и синхронно ждёт ребёнка (`spawnSync` со `stdio: "inherit"`), а
 * следующие reload'ы делает уже ребёнок, выходя со специальным кодом: цикл
 * супервизора поднимает следующее окно. Так висящих процессов всегда ровно два,
 * сколько бы раз пользователь ни перезагрузился.
 */

/** Код выхода supervised-процесса, означающий «подними меня заново». */
export const RELOAD_EXIT_CODE = 77;

/** Env-флаг: этим процессом уже управляет супервизор. */
export const SUPERVISED_ENV = "DIODE_SUPERVISED";

/** Всё, что о процессе нужно знать перезапуску (в тестах — литерал). */
export interface IProcessSnapshot {
    readonly execPath: string;
    readonly execArgv: readonly string[];
    readonly argv: readonly string[];
    /** SEA-бинарь: скрипта в `argv[1]` нет, там сам бинарь. */
    readonly isSea: boolean;
    readonly env: NodeJS.ProcessEnv;
}

/** Результат запуска ребёнка: `null` — убит сигналом. */
export interface ISpawnResult {
    readonly status: number | null;
}

/** Точки соприкосновения с ОС — подменяются в тестах. */
export interface IRestartHooks {
    spawnSync(
        command: string,
        args: readonly string[],
        options: { stdio: "inherit"; env: NodeJS.ProcessEnv },
    ): ISpawnResult;
    exit(code: number): never;
}

/**
 * Командная строка следующего окна. Пользовательские аргументы у нас всегда
 * начинаются с `argv[2]` (так их и разбирает `parseCliArgs`), а как добраться
 * до самой программы — зависит от сборки: у SEA-бинаря это `execPath`, в dev —
 * `node <execArgv> <main script>` (та же развилка, что у self-spawn extension
 * host'а, `defaultSpawnArgs`).
 */
export function restartArgs(snapshot: IProcessSnapshot): string[] {
    const userArgs = snapshot.argv.slice(2);
    if (snapshot.isSea) return [...userArgs];
    const mainScript = snapshot.argv[1];
    if (typeof mainScript !== "string" || mainScript === "") {
        throw new Error("reloadWindow: cannot determine main script to restart");
    }
    return [...snapshot.execArgv, mainScript, ...userArgs];
}

/**
 * Заменяет текущее окно новым процессом и не возвращается. Вызывать последним:
 * терминал, extension host и состояние сессии к этому моменту должны быть уже
 * отпущены владельцем приложения.
 */
export function restartProcess(snapshot: IProcessSnapshot, hooks: IRestartHooks): never {
    const args = restartArgs(snapshot);
    if (snapshot.env[SUPERVISED_ENV] === "1") {
        // Над нами уже есть супервизор — просто просим его о новом окне.
        return hooks.exit(RELOAD_EXIT_CODE);
    }
    const env = { ...snapshot.env, [SUPERVISED_ENV]: "1" };
    let status: number | null;
    do {
        status = hooks.spawnSync(snapshot.execPath, args, { stdio: "inherit", env }).status;
    } while (status === RELOAD_EXIT_CODE);
    // Ребёнок, убитый сигналом, не оставляет кода — отдаём шеллу общий отказ.
    return hooks.exit(status ?? 1);
}

/** Снимок настоящего процесса. */
export function currentProcessSnapshot(): IProcessSnapshot {
    return {
        execPath: process.execPath,
        execArgv: process.execArgv,
        argv: process.argv,
        isSea: isSeaBinary(),
        env: process.env,
    };
}

/** Боевые хуки: настоящие `spawnSync`/`process.exit`. */
export const realRestartHooks: IRestartHooks = {
    spawnSync: (command, args, options) => spawnSync(command, [...args], options),
    exit: (code) => process.exit(code),
};
