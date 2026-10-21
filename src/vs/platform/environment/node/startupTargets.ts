import * as path from "node:path";

import { splitFileQuery } from "../../../base/common/lineColumnQuery.ts";
import { hasWorkspaceFileExtension, type IWorkspaceFileContents } from "../../workspace/common/workspaceFile.ts";

import type { ICliArgs } from "./cliArgs.ts";
import { CliArgsError } from "./cliArgs.ts";

/** File to open; `line`/`column` are 1-based, as the user types them. */
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
    /** Override the saved session (like `code file.ts`). */
    readonly files: readonly IStartupFile[];
    readonly diff: IStartupDiff | undefined;
}

/** @param logicalCwd only for a workspace file ({@link logicalWorkingDirectory}); other positionals resolve against `process.cwd()` */
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
    // ONLY the first positional becomes the folder, as in VS Code.
    const first = parsed.at(0);
    const folder = first !== undefined && isDirectory(first.path) ? first.path : undefined;
    // Resolve against the logical cwd: the file's relative `folders` are relative to
    // the directory the user named, not to the symlink target.
    const isWorkspaceFile = first !== undefined && folder === undefined && hasWorkspaceFileExtension(first.path);
    const workspaceFile = isWorkspaceFile ? parsePositional(cli.positional[0], cli.goto, logicalCwd).path : undefined;
    const files = parsed.filter((entry) => !isDirectory(entry.path) && entry !== (isWorkspaceFile ? first : undefined));
    return { folder, workspaceFile, files, diff: undefined };
}

/** Without `--goto` a colon is an ordinary file name character. */
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
 * `pwd -L`: Node returns cwd with symlinks resolved, so `diode web.code-workspace`
 * run from `~/link` would resolve the file's folders against the link target. `$PWD` is checked for
 * staleness: the parent may have changed directory without updating it.
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
