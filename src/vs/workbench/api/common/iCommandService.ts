import type { IDisposable } from "../../../base/common/lifecycle.ts";

/** Порт: мост команд без зависимости runtime'а расширений на слой Workbench. */
export interface ICommandService {
    /** Бросает, если команды нет: так reject доходит до субпроцесса. */
    execute(id: string, args: readonly unknown[]): unknown;

    /**
     * Без `title` команда исполнима по id, но в палитре не видна. `category` —
     * префикс подписи в палитре («Java: Clean Workspace»), в заголовок не входит.
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
