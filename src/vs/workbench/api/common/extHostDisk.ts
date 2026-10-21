import type * as vscode from "vscode";

import type { IFindFilesScanner } from "./findFiles.ts";

/** OS errors come as `FileSystemError` (`err.code === "FileNotFound"`). */
export type IDiskFileSystem = Pick<
    vscode.FileSystem,
    "stat" | "readFile" | "writeFile" | "createDirectory" | "readDirectory" | "delete" | "rename" | "copy"
>;

export interface IExtHostDisk {
    readonly fs: IDiskFileSystem;
    readonly findFilesScanner: IFindFilesScanner;
    /** OS errors are passed through as is. */
    readFile(fsPath: string): Promise<Buffer>;
}
