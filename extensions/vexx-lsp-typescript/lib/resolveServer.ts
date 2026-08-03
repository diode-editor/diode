/**
 * Резолв команды запуска language-сервера. Чистая логика (без vscode API) —
 * покрывается юнитами; entry `main.ts` остаётся тонкой прослойкой.
 *
 * Правило спавна: строго `{ command }`-форма. НИКОГДА не `process.execPath` —
 * под SEA это сам vexx-бинарь, а не node; `TransportKind.ipc`/fork ломаются
 * по той же причине.
 */

/** Описание одного языкового сервера в декларативной таблице клиента. */
export interface ILanguageServerSpec {
    /** id клиента (`LanguageClient(id, …)`) и владелец диагностик. */
    readonly id: string;
    readonly displayName: string;
    /** `documentSelector` строится из этих language id (scheme: file). */
    readonly languageIds: readonly string[];
    /**
     * Кандидаты на исполняемый файл сервера, по приоритету: значение настройки
     * (если непустое), затем workspace-относительные пути, затем имя в PATH.
     */
    readonly resolveCandidates: (settingPath: string, workspaceRoots: readonly string[]) => readonly string[];
}

/** Команда запуска: `command` + args (всегда stdio-транспорт). */
export interface IServerCommand {
    readonly command: string;
    readonly args: readonly string[];
}

/**
 * Переводит путь-кандидат в команду запуска. JS-энтрипоинты (`.js`/`.mjs`/`.cjs`)
 * запускаются через `node` из PATH (не `process.execPath` — см. шапку);
 * всё остальное — исполняемый файл/шим как есть.
 */
export function commandFor(candidate: string, serverArgs: readonly string[] = ["--stdio"]): IServerCommand {
    if (/\.(cjs|mjs|js)$/.test(candidate)) {
        return { command: "node", args: [candidate, ...serverArgs] };
    }
    return { command: candidate, args: [...serverArgs] };
}

/** Таблица серверов builtin-клиента. Новый язык = новая строка (правок ядра не требует). */
export const LANGUAGE_SERVERS: readonly ILanguageServerSpec[] = [
    {
        id: "vexxTypescript",
        displayName: "TypeScript (Vexx)",
        languageIds: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
        resolveCandidates: (settingPath, workspaceRoots) => [
            ...(settingPath !== "" ? [settingPath] : []),
            ...workspaceRoots.map((root) => `${root}/node_modules/.bin/typescript-language-server`),
            "typescript-language-server",
        ],
    },
];

/**
 * Выбирает первый существующий кандидат (существование проверяет вызывающий
 * через `exists`); имя без разделителей пути (PATH-кандидат) существованием
 * не проверяется — spawn сам упадёт, если бинаря нет.
 */
export function resolveServerCommand(
    spec: ILanguageServerSpec,
    settingPath: string,
    workspaceRoots: readonly string[],
    exists: (path: string) => boolean,
): IServerCommand | null {
    for (const candidate of spec.resolveCandidates(settingPath, workspaceRoots)) {
        const isPathLike = candidate.includes("/") || candidate.includes("\\");
        if (!isPathLike) return commandFor(candidate);
        if (exists(candidate)) return commandFor(candidate);
    }
    return null;
}
