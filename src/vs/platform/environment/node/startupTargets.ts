import * as path from "node:path";

import { splitFileQuery } from "../../../base/common/lineColumnQuery.ts";
import { hasWorkspaceFileExtension, type IWorkspaceFileContents } from "../../workspace/common/workspaceFile.ts";

import type { ICliArgs } from "./cliArgs.ts";
import { CliArgsError } from "./cliArgs.ts";

/** Файл для открытия; `line`/`column` — 1-based, как их набирает человек. */
export interface IStartupFile {
    readonly path: string;
    readonly line?: number;
    readonly column?: number;
}

export interface IStartupWorkspace {
    readonly file: string;
    readonly contents: IWorkspaceFileContents;
}

export interface IStartupDiff {
    readonly original: string;
    readonly modified: string;
}

export interface IStartupTargets {
    readonly folder: string | undefined;
    readonly workspaceFile: string | undefined;
    /** Перебивают сохранённую сессию (как `code file.ts`). */
    readonly files: readonly IStartupFile[];
    readonly diff: IStartupDiff | undefined;
}

/** @param logicalCwd только для файла воркспейса ({@link logicalWorkingDirectory}); остальные позиционные — от `process.cwd()` */
export function resolveStartupTargets(
    cli: ICliArgs,
    isDirectory: (absolutePath: string) => boolean,
    logicalCwd: string = process.cwd(),
): IStartupTargets {
    if (cli.diff) {
        const [original, modified] = cli.positional.map((p) => path.resolve(p));
        return { folder: undefined, workspaceFile: undefined, files: [], diff: { original, modified } };
    }

    const parsed = cli.positional.map((raw) => parsePositional(raw, cli.goto, process.cwd()));
    // Папкой становится ТОЛЬКО первый позиционный, как в VS Code.
    const first = parsed.at(0);
    const folder = first !== undefined && isDirectory(first.path) ? first.path : undefined;
    // Путь — от логического cwd: относительные `folders` файла считаются от
    // каталога, который назвал человек, а не от цели симлинка.
    const isWorkspaceFile = first !== undefined && folder === undefined && hasWorkspaceFileExtension(first.path);
    const workspaceFile = isWorkspaceFile ? parsePositional(cli.positional[0], cli.goto, logicalCwd).path : undefined;
    const files = parsed.filter((entry) => !isDirectory(entry.path) && entry !== (isWorkspaceFile ? first : undefined));
    return { folder, workspaceFile, files, diff: undefined };
}

/** Без `--goto` двоеточие — обычный символ имени файла. */
function parsePositional(raw: string, gotoMode: boolean, cwd: string): IStartupFile {
    if (!gotoMode) return { path: path.resolve(cwd, raw) };

    const { filePart, goto } = splitFileQuery(raw);
    if (filePart.length === 0) {
        throw new CliArgsError(`--goto expects file[:line[:column]], got: ${raw}`);
    }
    const resolved = path.resolve(cwd, filePart);
    if (goto === null) return { path: resolved };
    return { path: resolved, line: goto.line, ...(goto.column !== undefined ? { column: goto.column } : {}) };
}

/**
 * `pwd -L`: Node отдаёт cwd с развёрнутыми симлинками, и `diode web.code-workspace`
 * из `~/link` считал бы папки файла от цели ссылки. `$PWD` проверяется на
 * устаревание — родитель мог сменить каталог без него.
 */
export function logicalWorkingDirectory(
    pwd: string | undefined,
    physicalCwd: string,
    sameDirectory: (a: string, b: string) => boolean,
): string {
    if (pwd === undefined || !path.isAbsolute(pwd)) return physicalCwd;
    const normalized = path.resolve(pwd);
    return sameDirectory(normalized, physicalCwd) ? normalized : physicalCwd;
}
