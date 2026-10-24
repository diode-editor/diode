import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { token } from "../../instantiation/common/diContainer.ts";

/**
 * Positional reads of one open file (`pread`): the document on disk (`editor/common/model/diskTextBuffer.ts`)
 * indexes the file in the background and reads pages on demand. Not part of `IFileService`: that one has no
 * synchronous methods by decision (docs/ARCHITECTURE.md, the file service section), while a frame needs the page of the
 * lines it paints right away.
 */
export interface IRandomAccessFile extends IDisposable {
    /** Size at open time, in bytes. */
    readonly size: number;
    /** Fills `target` from `position`; returns the bytes read, 0 at the end of the file. */
    readSync(target: Uint8Array, position: number): number;
    /** The same off the main thread, for the background pass. */
    read(target: Uint8Array, position: number): Promise<number>;
}

export interface IRandomAccessFileOpener {
    /** Synchronous: a model is born in the registry synchronously, with its first screen. Throws like `fs.openSync`. */
    open(path: string): IRandomAccessFile;
}

export const IRandomAccessFileOpenerDIToken = token<IRandomAccessFileOpener>("IRandomAccessFileOpener");
