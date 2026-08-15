import type { IDisposable } from "@tuidom/core/common/disposable";

/**
 * Тонкий «port» поверх host-реестра команд ({@link CommandRegistry}), нужный
 * {@link ExtensionHost} для двустороннего моста команд без прямой зависимости
 * на слой Workbench внутри runtime'а расширения.
 *
 * Паттерн повторяет {@link IEditorOptionsService} — адаптер живёт в слое
 * Extensions, ядро про host ничего не знает.
 */
export interface ICommandService {
    /**
     * Исполняет команду ядра по идентификатору. Бросает, если команды нет —
     * так reject доходит до сабпроцесса (семантика `vscode.commands.executeCommand`).
     */
    execute(id: string, args: readonly unknown[]): unknown;

    /**
     * Регистрирует прокси-команду расширения в host-реестре. `invoke` уводит
     * исполнение обратно в сабпроцесс (обратный RPC). `title` (из
     * `contributes.commands`) делает команду видимой в палитре — без него она
     * исполнима по id, но не показывается в списке. Возвращает Disposable,
     * снимающий регистрацию.
     */
    registerProxy(id: string, invoke: (args: readonly unknown[]) => unknown, title?: string): IDisposable;
}

/**
 * No-op реализация — для тестов/профилей, где мост команд не задействован.
 */
export const NULL_COMMAND_SERVICE: ICommandService = {
    execute: () => undefined,
    registerProxy: () => ({ dispose: () => undefined }),
};
