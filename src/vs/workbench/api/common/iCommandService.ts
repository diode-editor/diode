import type { IDisposable } from "../../../base/common/lifecycle.ts";

/** Port: command bridge that keeps the extension runtime independent of the Workbench layer. */
export interface ICommandService {
    /** Throws if the command is missing, so the rejection reaches the subprocess. */
    execute(id: string, args: readonly unknown[]): unknown;

    /** Keys wait for `done`, then run in order: an extension's text editor command must not be overtaken. */
    holdInputUntil(done: PromiseLike<unknown>): void;

    /** Every registered id, hidden from the palette or not. */
    listCommandIds(): readonly string[];

    /**
     * Without `title` the command runs by id but is hidden from the palette. `category` is
     * the label prefix in the palette ("Java: Clean Workspace"), not part of the title.
     */
    registerProxy(
        id: string,
        invoke: (args: readonly unknown[]) => unknown,
        title?: string,
        category?: string,
    ): IDisposable;
}

export const NULL_COMMAND_SERVICE: ICommandService = {
    execute: () => undefined,
    holdInputUntil: () => undefined,
    listCommandIds: () => [],
    registerProxy: () => ({ dispose: () => undefined }),
};
