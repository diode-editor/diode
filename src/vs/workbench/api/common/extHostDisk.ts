import type * as vscode from "vscode";

import type { IFindFilesScanner } from "./findFiles.ts";

/** Ошибки ОС — в форме `FileSystemError` (`err.code === "FileNotFound"`). */
export type IDiskFileSystem = Pick<
    vscode.FileSystem,
    "stat" | "readFile" | "writeFile" | "createDirectory" | "readDirectory" | "delete" | "rename" | "copy"
>;

export interface IExtHostDisk {
    readonly fs: IDiskFileSystem;
    readonly findFilesScanner: IFindFilesScanner;
    /** Ошибки ОС — как есть. */
    readFile(fsPath: string): Promise<Buffer>;
}
