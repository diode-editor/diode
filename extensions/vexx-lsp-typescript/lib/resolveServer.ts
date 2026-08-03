/**
 * Резолв команды запуска language-сервера. Чистая логика (без vscode API) —
 * покрывается юнитами; entry `main.ts` остаётся тонкой прослойкой.
 *
 * Правило рантайма — «как VS Code»: JS-энтрипоинты запускаются НАШИМ
 * node-рантаймом (`runtime.command` = `process.execPath` субпроцесса: в dev и
 * self-extract это настоящий node, в SEA — vexx-бинарь + env
 * `VEXX_RUN_AS_NODE=1`, калька `ELECTRON_RUN_AS_NODE`). Системный node из PATH
 * не требуется. Бинарные кандидаты (шимы `.bin/…`, PATH-имя) — как есть.
 */

/** Описание одного языкового сервера в декларативной таблице клиента. */
export interface ILanguageServerSpec {
    /** id клиента (`LanguageClient(id, …)`) и владелец диагностик. */
    readonly id: string;
    readonly displayName: string;
    /** `documentSelector` строится из этих language id (scheme: file). */
    readonly languageIds: readonly string[];
    /**
     * Кандидаты на исполняемый файл сервера, по приоритету: настройка
     * (если непустая) → workspace `node_modules/.bin` (оверрайд версии) →
     * вшитый сервер из поставки (дефолт) → имя в PATH (последний фолбэк).
     */
    readonly resolveCandidates: (
        settingPath: string,
        workspaceRoots: readonly string[],
        bundledServerPath: string,
    ) => readonly string[];
}

/** Node-рантайм для JS-энтрипоинтов сервера (см. шапку). */
export interface IServerRuntime {
    /** Команда рантайма (обычно `process.execPath` субпроцесса). */
    readonly command: string;
    /** SEA: бинарь должен уйти в node-режим (`VEXX_RUN_AS_NODE=1` в env сервера). */
    readonly runAsNodeFlag: boolean;
}

/** Команда запуска: `command` + args + env-добавка (всегда stdio-транспорт). */
export interface IServerCommand {
    readonly command: string;
    readonly args: readonly string[];
    /**
     * Env-добавка поверх окружения субпроцесса. `VEXX_EXTENSION_HOST` снимается
     * ВСЕГДА: vscode-languageclient копирует весь env ext-host'а в сервер, и
     * унаследованный флаг увёл бы наш бинарь в ext-host-ветку (exit 2 без IPC).
     */
    readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Переводит путь-кандидат в команду запуска. JS-энтрипоинты (`.js`/`.mjs`/`.cjs`)
 * запускаются рантаймом из {@link IServerRuntime}; всё остальное —
 * исполняемый файл/шим как есть.
 */
export function commandFor(
    candidate: string,
    runtime: IServerRuntime,
    serverArgs: readonly string[] = ["--stdio"],
): IServerCommand {
    const env: Record<string, string | undefined> = { VEXX_EXTENSION_HOST: undefined };
    if (/\.(cjs|mjs|js)$/.test(candidate)) {
        if (runtime.runAsNodeFlag) env.VEXX_RUN_AS_NODE = "1";
        return { command: runtime.command, args: [candidate, ...serverArgs], env };
    }
    return { command: candidate, args: [...serverArgs], env };
}

/** Таблица серверов builtin-клиента. Новый язык = новая строка (правок ядра не требует). */
export const LANGUAGE_SERVERS: readonly ILanguageServerSpec[] = [
    {
        id: "vexxTypescript",
        displayName: "TypeScript (Vexx)",
        languageIds: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
        resolveCandidates: (settingPath, workspaceRoots, bundledServerPath) => [
            ...(settingPath !== "" ? [settingPath] : []),
            ...workspaceRoots.map((root) => `${root}/node_modules/.bin/typescript-language-server`),
            ...(bundledServerPath !== "" ? [bundledServerPath] : []),
            "typescript-language-server",
        ],
    },
];

/** Результат резолва: команда + признак «выбран вшитый сервер» (для ATA/tsserver.path). */
export interface IResolvedServer {
    readonly command: IServerCommand;
    readonly isBundled: boolean;
}

/**
 * Выбирает первый существующий кандидат (существование проверяет вызывающий
 * через `exists`); имя без разделителей пути (PATH-кандидат) существованием
 * не проверяется — spawn сам упадёт, если бинаря нет.
 */
export function resolveServerCommand(
    spec: ILanguageServerSpec,
    settingPath: string,
    workspaceRoots: readonly string[],
    bundledServerPath: string,
    runtime: IServerRuntime,
    exists: (path: string) => boolean,
): IResolvedServer | null {
    for (const candidate of spec.resolveCandidates(settingPath, workspaceRoots, bundledServerPath)) {
        const isPathLike = candidate.includes("/") || candidate.includes("\\");
        if (isPathLike && !exists(candidate)) continue;
        return { command: commandFor(candidate, runtime), isBundled: candidate === bundledServerPath };
    }
    return null;
}
