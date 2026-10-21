import * as path from "node:path";

import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";

import { Uri } from "../../../base/common/uri.ts";

/**
 * `*.code-workspace` (`IStoredWorkspace` эталона). Нужен и без мульти-рута: у одного каталога
 * бывает несколько закоммиченных наборов настроек, и у каждого — своя идентичность проекта.
 * Папка ровно одна: больше — отказ с причиной, а не молча первая. Секции `extensions`,
 * `launch`, `tasks` не читаются.
 */

export const WORKSPACE_EXTENSION = "code-workspace";

export function hasWorkspaceFileExtension(filePath: string): boolean {
    return path.extname(filePath) === `.${WORKSPACE_EXTENSION}`;
}

/** Ключ блока настроек в файле воркспейса (`settings` эталона). */
export const WORKSPACE_FILE_SETTINGS_KEY = "settings";

/** Разобранный файл воркспейса. */
export interface IWorkspaceFileContents {
    /** Абсолютный путь единственной папки (относительный `path` — от каталога файла). */
    readonly folder: string;
    /** Имя папки из `name`, если задано (иначе папку зовут базовым именем пути). */
    readonly folderName: string | undefined;
}

/** Файл воркспейса не открыть: битый JSON, нет папки, папок больше одной. */
export class WorkspaceFileError extends Error {}

/**
 * Разбирает содержимое файла воркспейса `filePath` (абсолютный путь — от него
 * считаются относительные пути папок, `toWorkspaceFolders` эталона). Чистая
 * функция: читает файл и проверяет, что папка существует, вызывающий.
 *
 * @throws {WorkspaceFileError} файл не открыть — текст годится человеку как есть
 */
export function parseWorkspaceFile(content: string, filePath: string): IWorkspaceFileContents {
    const errors: ParseError[] = [];
    const parsed: unknown = parseJsonc(content, errors, { allowTrailingComma: true });
    const firstError = errors.at(0);
    if (firstError !== undefined) {
        throw new WorkspaceFileError(
            `Invalid workspace file ${filePath}: ${printParseErrorCode(firstError.error)} at offset ${String(firstError.offset)}`,
        );
    }
    const folders = field(parsed, "folders");
    if (!Array.isArray(folders) || folders.length === 0) {
        throw new WorkspaceFileError(`Workspace file ${filePath} has no folders`);
    }
    if (folders.length > 1) {
        throw new WorkspaceFileError(
            `Workspace file ${filePath} lists ${String(folders.length)} folders: multi-root workspaces are not supported yet, a workspace file must have exactly one folder`,
        );
    }
    const entry: unknown = folders[0];
    const folder = resolveFolder(entry, path.dirname(filePath));
    if (folder === undefined) {
        throw new WorkspaceFileError(`Workspace file ${filePath}: a folder entry must have a "path" or a file "uri"`);
    }
    const name = field(entry, "name");
    return { folder, folderName: typeof name === "string" && name.length > 0 ? name : undefined };
}

/** Доступ к диску для {@link loadWorkspaceFile}: у главного процесса — `fs`, у команды — `IFileService`. */
export interface IWorkspaceFileReader {
    /** Текст файла; отказ — файла нет или он не читается. */
    readText(filePath: string): Promise<string>;
    /** Путь существует и это каталог. */
    isDirectory(filePath: string): Promise<boolean>;
}

/**
 * Читает и разбирает файл воркспейса: всё, что нужно, чтобы его открыть, и
 * все причины, по которым открыть нельзя, одним {@link WorkspaceFileError}
 * (файла нет, разбор, папки нет на диске). Общая точка старта (`diode
 * web.code-workspace`) и команды Open Workspace from File.
 */
export async function loadWorkspaceFile(
    filePath: string,
    reader: IWorkspaceFileReader,
): Promise<IWorkspaceFileContents> {
    let content: string;
    try {
        content = await reader.readText(filePath);
    } catch {
        throw new WorkspaceFileError(`Workspace file does not exist or cannot be read: ${filePath}`);
    }
    const contents = parseWorkspaceFile(content, filePath);
    if (!(await reader.isDirectory(contents.folder))) {
        throw new WorkspaceFileError(`Workspace folder does not exist: ${contents.folder} (from ${filePath})`);
    }
    return contents;
}

/** Путь папки из записи `{ path }` или `{ uri }` (`isRawFileWorkspaceFolder` / `isRawUriWorkspaceFolder` эталона). */
function resolveFolder(entry: unknown, baseDir: string): string | undefined {
    const folderPath = field(entry, "path");
    if (typeof folderPath === "string" && folderPath.length > 0) {
        return path.resolve(baseDir, folderPath);
    }
    const folderUri = field(entry, "uri");
    if (typeof folderUri === "string") {
        const uri = Uri.parse(folderUri);
        if (uri.scheme === "file") return path.resolve(uri.fsPath);
    }
    return undefined;
}

/**
 * Отображаемое имя воркспейса из файла: базовое имя без расширения
 * (`getWorkspaceLabel` эталона — `web.code-workspace` → `web`).
 */
export function workspaceFileLabel(filePath: string): string {
    return path.basename(filePath, `.${WORKSPACE_EXTENSION}`);
}

/**
 * Поле значения из разобранного JSON. У `null` и примитивов полей нет —
 * `undefined`, как у объекта без такого поля; у массива именованных полей тоже нет.
 */
function field(value: unknown, key: string): unknown {
    return (value as Record<string, unknown> | null | undefined)?.[key];
}
