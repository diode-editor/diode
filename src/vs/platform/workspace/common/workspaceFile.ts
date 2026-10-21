import * as path from "node:path";

import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";

import { Uri } from "../../../base/common/uri.ts";

/**
 * `*.code-workspace` (upstream's `IStoredWorkspace`). Needed even without multi-root: one directory
 * may have several committed settings sets, each with its own project identity.
 * Exactly one folder: more is refused with a reason rather than silently taking the first. The
 * `extensions`, `launch` and `tasks` sections are not read.
 */

export const WORKSPACE_EXTENSION = "code-workspace";

export function hasWorkspaceFileExtension(filePath: string): boolean {
    return path.extname(filePath) === `.${WORKSPACE_EXTENSION}`;
}

/** Key of the settings block in a workspace file (upstream's `settings`). */
export const WORKSPACE_FILE_SETTINGS_KEY = "settings";

/** A parsed workspace file. */
export interface IWorkspaceFileContents {
    /** Absolute path of the single folder (a relative `path` resolves against the file's directory). */
    readonly folder: string;
    /** Folder name from `name`, if set (otherwise the folder is named by the path's basename). */
    readonly folderName: string | undefined;
}

/** The workspace file can't be opened: broken JSON, no folder, more than one folder. */
export class WorkspaceFileError extends Error {}

/**
 * Parses the contents of the workspace file `filePath` (an absolute path; relative folder
 * paths resolve against it, upstream's `toWorkspaceFolders`). A pure function: the caller
 * reads the file and checks that the folder exists.
 *
 * @throws {WorkspaceFileError} the file can't be opened; the message is fit to show a human as is
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

/** Disk access for {@link loadWorkspaceFile}: `fs` in the main process, `IFileService` in the command. */
export interface IWorkspaceFileReader {
    /** File text; rejects if the file is missing or unreadable. */
    readText(filePath: string): Promise<string>;
    /** The path exists and is a directory. */
    isDirectory(filePath: string): Promise<boolean>;
}

/**
 * Reads and parses a workspace file: everything needed to open it, and every
 * reason it can't be opened as a single {@link WorkspaceFileError}
 * (missing file, parse error, folder missing on disk). Shared by startup (`diode
 * web.code-workspace`) and the Open Workspace from File command.
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

/** Folder path from a `{ path }` or `{ uri }` entry (upstream's `isRawFileWorkspaceFolder` / `isRawUriWorkspaceFolder`). */
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
 * Display name of a workspace from its file: the basename without extension
 * (upstream's `getWorkspaceLabel`: `web.code-workspace` → `web`).
 */
export function workspaceFileLabel(filePath: string): string {
    return path.basename(filePath, `.${WORKSPACE_EXTENSION}`);
}

/**
 * A field of a parsed JSON value. `null` and primitives have no fields, so they give
 * `undefined`, like an object without that field; arrays have no named fields either.
 */
function field(value: unknown, key: string): unknown {
    return (value as Record<string, unknown> | null | undefined)?.[key];
}
