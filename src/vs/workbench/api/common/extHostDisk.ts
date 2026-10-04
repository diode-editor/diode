import type * as vscode from "vscode";

import type { IFindFilesScanner } from "./findFiles.ts";

/**
 * Операции `workspace.fs` над схемой `file`: схема уже проверена роутером
 * ({@link createFileSystemNamespace}), ошибки ОС отдаются в форме
 * `FileSystemError` (`err.code === "FileNotFound"` и т.п.).
 */
export type IDiskFileSystem = Pick<
    vscode.FileSystem,
    "stat" | "readFile" | "writeFile" | "createDirectory" | "readDirectory" | "delete" | "rename" | "copy"
>;

/**
 * Локальный диск глазами extension host'а — шов между `api/common` (роутинг по
 * схеме, обход `findFiles`, сборка документов) и привязкой к `node:fs` в
 * `api/node` (`createNodeExtHostDisk`).
 */
export interface IExtHostDisk {
    /** `workspace.fs` для схемы `file`. */
    readonly fs: IDiskFileSystem;
    /** Чтение каталогов для `workspace.findFiles`. */
    readonly findFilesScanner: IFindFilesScanner;
    /** Байты файла для `openTextDocument` по промаху реестра; ошибки ОС — как есть. */
    readFile(fsPath: string): Promise<Buffer>;
}
