import { token } from "../../instantiation/common/diContainer.ts";

export interface ITrashEntry {
    /** Where to restore to. */
    readonly originalPath: string;
    readonly trashedPath: string;
    /** The `.trashinfo` file on freedesktop. */
    readonly infoPath: string;
}

/** Wider than upstream: Undo brings a file back from the trash, so there is also "restore" (#480). */
export interface ITrashService {
    /** Cheap, doesn't wait. */
    isAvailable(): boolean;
    trash(filePath: string): Promise<ITrashEntry>;
    /** If the spot is taken, restores next to it. Returns the final path. */
    restore(entry: ITrashEntry): Promise<string>;
}

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it; the string inside is just a debug label
export const ITrashServiceDIToken = token<ITrashService>("TrashService");
