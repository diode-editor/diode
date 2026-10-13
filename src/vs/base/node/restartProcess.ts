import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { isSeaBinary } from "./isSea.ts";

/**
 * Перезапуск самого себя — «перезагрузка окна» (аналог
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
 *
 * Аргументы следующего окна — не всегда те же: переключение профиля и смена
 * воркспейса (Open Folder в другом профиле) поднимают окно с другим
 * `--profile` и другой папкой. Супервизор сам в окно не заглядывает, поэтому
 * окно оставляет ему аргументы в файле ({@link RELAUNCH_FILE_ENV}) перед
 * выходом с {@link RELOAD_EXIT_CODE}; нет файла — окно поднимается с прежними.
 */

/** Код выхода supervised-процесса, означающий «подними меня заново». */
export const RELOAD_EXIT_CODE = 77;

/** Env-флаг: этим процессом уже управляет супервизор. */
export const SUPERVISED_ENV = "DIODE_SUPERVISED";

/** Env: путь файла, в который supervised-окно кладёт аргументы следующего окна. */
export const RELAUNCH_FILE_ENV = "DIODE_RELAUNCH_FILE";

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
    /** Файл аргументов следующего окна — один на всю жизнь супервизора. */
    relaunchFilePath(): string;
    /** Окно пишет аргументы следующего окна перед выходом с {@link RELOAD_EXIT_CODE}. */
    writeRelaunchFile(filePath: string, userArgs: readonly string[]): void;
    /** Супервизор читает и снимает файл; нет файла (или он битый) — `null`: аргументы не менялись. */
    readRelaunchFile(filePath: string): readonly string[] | null;
}

/**
 * Командная строка следующего окна. Пользовательские аргументы у нас всегда
 * начинаются с `argv[2]` (так их и разбирает `parseCliArgs`) — либо приходят
 * явно (`userArgs`: перезапуск с другим профилем или воркспейсом), — а как
 * добраться до самой программы — зависит от сборки: у SEA-бинаря это
 * `execPath`, в dev — `node <execArgv> <main script>` (та же развилка, что у
 * self-spawn extension host'а, `defaultSpawnArgs`).
 */
export function restartArgs(
    snapshot: IProcessSnapshot,
    userArgs: readonly string[] = snapshot.argv.slice(2),
): string[] {
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
 * отпущены владельцем приложения. `userArgs` — аргументы следующего окна, если
 * они отличаются от нынешних (иначе — те же, что у этого процесса).
 */
export function restartProcess(snapshot: IProcessSnapshot, hooks: IRestartHooks, userArgs?: readonly string[]): never {
    if (snapshot.env[SUPERVISED_ENV] === "1") {
        // Над нами уже есть супервизор — оставляем ему аргументы (если они
        // другие) и просим о новом окне.
        const relaunchFile = snapshot.env[RELAUNCH_FILE_ENV];
        if (userArgs !== undefined && relaunchFile !== undefined && relaunchFile !== "") {
            hooks.writeRelaunchFile(relaunchFile, userArgs);
        }
        return hooks.exit(RELOAD_EXIT_CODE);
    }
    const relaunchFile = hooks.relaunchFilePath();
    const env = { ...snapshot.env, [SUPERVISED_ENV]: "1", [RELAUNCH_FILE_ENV]: relaunchFile };
    let args = restartArgs(snapshot, userArgs);
    let status: number | null;
    do {
        status = hooks.spawnSync(snapshot.execPath, args, { stdio: "inherit", env }).status;
        if (status === RELOAD_EXIT_CODE) {
            const next = hooks.readRelaunchFile(relaunchFile);
            if (next !== null) args = restartArgs(snapshot, next);
        }
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

/** Боевые хуки: настоящие `spawnSync`/`process.exit` и файл аргументов в `os.tmpdir()`. */
export const realRestartHooks: IRestartHooks = {
    spawnSync: (command, args, options) => spawnSync(command, [...args], options),
    exit: (code) => process.exit(code),
    relaunchFilePath: () => path.join(os.tmpdir(), `diode-relaunch-${String(process.pid)}.json`),
    writeRelaunchFile: (filePath, userArgs) => {
        // Stryker disable next-line StringLiteral: пустая кодировка у writeFileSync — та же utf-8 по умолчанию
        fs.writeFileSync(filePath, JSON.stringify(userArgs), "utf-8");
    },
    readRelaunchFile: (filePath) => {
        let content: string;
        // Stryker disable BlockStatement: без раннего выхода parseRelaunchArgs(undefined) всё равно даёт null — эквивалентный мутант
        try {
            // Stryker disable next-line StringLiteral: без кодировки readFileSync отдаёт Buffer, и JSON.parse читает его той же utf-8
            content = fs.readFileSync(filePath, "utf-8");
        } catch {
            return null;
        }
        // Stryker restore BlockStatement
        // Stryker disable next-line ObjectLiteral,BooleanLiteral: `force` — на гонку с чужим удалением между чтением и снятием; из теста не воспроизводится
        fs.rmSync(filePath, { force: true });
        return parseRelaunchArgs(content);
    },
};

/** Содержимое файла аргументов: массив строк, иначе `null` (битый файл — как отсутствующий). */
export function parseRelaunchArgs(content: string): readonly string[] | null {
    let parsed: unknown;
    // Stryker disable BlockStatement: без раннего выхода `parsed` остаётся undefined и отсеивается Array.isArray — эквивалентный мутант
    try {
        parsed = JSON.parse(content);
    } catch {
        return null;
    }
    // Stryker restore BlockStatement
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) return null;
    return parsed;
}
