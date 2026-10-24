import * as fs from "node:fs";
import { promisify } from "node:util";

import type { IRandomAccessFile, IRandomAccessFileOpener } from "../common/iRandomAccessFile.ts";

/** `fs.promises` reads want a `FileHandle`; the descriptor is shared with the synchronous reads, so the callback form is promisified. */
const readAsync = promisify(fs.read);

/**
 * One descriptor per open document, closed with it. Positional reads do not move a file offset, so the
 * synchronous page reads of a frame and the asynchronous reads of the indexing pass share the descriptor.
 */
export class NodeRandomAccessFile implements IRandomAccessFile {
    public readonly size: number;
    private fd: number | null;

    public constructor(path: string) {
        this.fd = fs.openSync(path, "r");
        // fstat of a descriptor just opened fails only with the filesystem; closing it on that path is a branch no test reaches.
        this.size = fs.fstatSync(this.fd).size;
    }

    public readSync(target: Uint8Array, position: number): number {
        return fs.readSync(this.requireFd(), target, 0, target.length, position);
    }

    public async read(target: Uint8Array, position: number): Promise<number> {
        const { bytesRead } = await readAsync(this.requireFd(), target, 0, target.length, position);
        return bytesRead;
    }

    public dispose(): void {
        if (this.fd === null) return;
        fs.closeSync(this.fd);
        this.fd = null;
    }

    private requireFd(): number {
        if (this.fd === null) throw new Error("NodeRandomAccessFile: the file is closed");
        return this.fd;
    }
}

export const nodeRandomAccessFileOpener: IRandomAccessFileOpener = {
    open: (path) => new NodeRandomAccessFile(path),
};
