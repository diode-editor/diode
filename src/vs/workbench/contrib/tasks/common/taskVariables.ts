// Подстановка переменных в задачу (`variableResolver.ts` эталона,
// `services/configurationResolver/common/`) в объёме задач первой итерации.
// Неизвестная `${foo}` остаётся как есть — так ведёт себя эталон; известная,
// но не поддержанная (`${input:…}`, `${command:…}`) — ошибка: запуск с
// литералом вместо значения хуже явного отказа (docs/TODO/Tasks.md).

import * as paths from "node:path";

/** Откуда берутся значения: папка задачи, активный редактор, окружение, настройки. */
export interface ITaskVariableContext {
    /** Путь папки воркспейса задачи; `undefined` — папка не открыта. */
    readonly folderPath: string | undefined;
    /** Путь файла активного редактора; `undefined` — редактора нет. */
    readonly filePath: string | undefined;
    /** Строка каретки активного редактора, 1-based. */
    readonly lineNumber: number | undefined;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly userHome: string | undefined;
    readonly cwd: string;
    /** Значение настройки по ключу (`${config:…}`). */
    getConfiguration(key: string): unknown;
}

/** Отказ подстановки — текст уходит человеку и в лог, задача не запускается. */
export class TaskVariableError extends Error {}

const VARIABLE = /\$\{(.*?)\}/g;

/**
 * Подставляет переменные в строку. `resolved` копит то, что подставлено
 * (`${name}` → значение) — его отдаёт событие старта задачи.
 */
export function resolveVariables(value: string, context: ITaskVariableContext, resolved?: Map<string, string>): string {
    return value.replace(VARIABLE, (match: string, inner: string) => {
        const result = resolveOne(match, inner, context);
        if (result !== match) resolved?.set(match, result);
        return result;
    });
}

function resolveOne(match: string, inner: string, context: ITaskVariableContext): string {
    const colon = inner.indexOf(":");
    const name = colon === -1 ? inner : inner.slice(0, colon);
    const argument = colon === -1 ? undefined : inner.slice(colon + 1);

    const filePath = (): string => {
        if (context.filePath !== undefined) return context.filePath;
        throw new TaskVariableError(`Variable ${match} can not be resolved. Please open an editor.`);
    };
    const folderPath = (): string => {
        if (argument !== undefined && argument !== "") {
            if (context.folderPath !== undefined && paths.basename(context.folderPath) === argument) {
                return context.folderPath;
            }
            throw new TaskVariableError(`Variable ${name} can not be resolved. No such folder '${argument}'.`);
        }
        if (context.folderPath !== undefined) return context.folderPath;
        throw new TaskVariableError(`Variable ${name} can not be resolved. Please open a folder.`);
    };

    switch (name) {
        case "env":
            if (argument === undefined || argument === "") {
                throw new TaskVariableError(
                    `Variable ${match} can not be resolved because no environment variable name is given.`,
                );
            }
            return context.env[argument] ?? "";
        case "config":
            return configValue(match, argument, context);
        case "input":
        case "command":
            throw new TaskVariableError(`Variable ${match} is not supported in tasks yet.`);
        case "workspaceRoot":
        case "workspaceFolder":
            return folderPath();
        case "workspaceRootFolderName":
        case "workspaceFolderBasename":
            return paths.basename(folderPath());
        case "cwd":
            // Как у эталона: у задачи с папкой `${cwd}` — папка, без неё — каталог процесса.
            return context.folderPath === undefined && argument === undefined ? context.cwd : folderPath();
        case "userHome":
            if (context.userHome !== undefined) return context.userHome;
            throw new TaskVariableError(`Variable ${match} can not be resolved. UserHome path is not defined`);
        case "lineNumber":
            if (context.lineNumber !== undefined) return String(context.lineNumber);
            throw new TaskVariableError(
                `Variable ${match} can not be resolved. Make sure to have a line selected in the active editor.`,
            );
        case "file":
            return filePath();
        case "relativeFile":
            return context.folderPath === undefined ? filePath() : paths.relative(context.folderPath, filePath());
        case "relativeFileDirname": {
            const dirname = paths.dirname(filePath());
            if (context.folderPath === undefined) return dirname;
            const relative = paths.relative(context.folderPath, dirname);
            return relative.length === 0 ? "." : relative;
        }
        case "fileDirname":
            return paths.dirname(filePath());
        case "fileExtname":
            return paths.extname(filePath());
        case "fileBasename":
            return paths.basename(filePath());
        case "fileBasenameNoExtension": {
            const basename = paths.basename(filePath());
            return basename.slice(0, basename.length - paths.extname(basename).length);
        }
        case "pathSeparator":
        case "/":
            return paths.sep;
        default:
            return match;
    }
}

function configValue(match: string, key: string | undefined, context: ITaskVariableContext): string {
    if (key === undefined || key === "") {
        throw new TaskVariableError(`Variable ${match} can not be resolved because no settings name is given.`);
    }
    const value = context.getConfiguration(key);
    if (value === undefined || value === null) {
        throw new TaskVariableError(`Variable ${match} can not be resolved because setting '${key}' not found.`);
    }
    if (typeof value === "object") {
        throw new TaskVariableError(`Variable ${match} can not be resolved because '${key}' is a structured value.`);
    }
    return typeof value === "string" ? value : JSON.stringify(value);
}
