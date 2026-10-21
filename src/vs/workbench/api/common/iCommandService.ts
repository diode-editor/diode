import type { IDisposable } from "../../../base/common/lifecycle.ts";

/** Port: command bridge that keeps the extension runtime independent of the Workbench layer. */
export interface ICommandService {
    /** Throws if the command is missing, so the rejection reaches the subprocess. */
    execute(id: string, args: readonly unknown[]): unknown;

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
    registerProxy: () => ({ dispose: () => undefined }),
};
